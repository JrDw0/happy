/**
 * Read the full transcript of a single on-disk provider session and return
 * a normalized, chronologically ordered list of user/assistant messages.
 *
 * Used by the `read-provider-session` machine RPC so the app can show a
 * read-only timeline of any Claude/Codex/OpenCode session without resuming
 * it. Pagination is offset-from-newest so the app can lazily load older
 * messages as the user scrolls up (mirrors the chat UI's inverted list).
 *
 * The daemon re-derives file locations from the provider + sessionId; it
 * never trusts a path supplied by the app.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { logger } from '@/ui/logger';
import { collectFilesWithExtension, extractText, parseTimestampToMs } from './utils';
import type {
    ProviderSessionMessage,
    ReadProviderSessionRequest,
    ReadProviderSessionResult,
    SessionHistoryProvider,
} from './types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Guard against enormous single messages blowing up the RPC payload. */
const MESSAGE_TEXT_MAX_CHARS = 4000;

function clampText(text: string): string {
    const trimmed = text.trim();
    if (trimmed.length <= MESSAGE_TEXT_MAX_CHARS) {
        return trimmed;
    }
    return trimmed.slice(0, MESSAGE_TEXT_MAX_CHARS) + '\n...[truncated]';
}

function pushMessage(
    out: ProviderSessionMessage[],
    role: 'user' | 'assistant',
    rawText: string,
    timestamp: number | undefined,
): void {
    const text = clampText(rawText);
    if (text.length === 0) {
        return;
    }
    out.push({ role, text, timestamp });
}

// --- Claude -----------------------------------------------------------------

function getClaudeProjectsDir(): string {
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    return join(claudeConfigDir, 'projects');
}

async function locateClaudeFile(sessionId: string): Promise<string | undefined> {
    const target = `${sessionId}.jsonl`;
    const files = await collectFilesWithExtension(getClaudeProjectsDir(), '.jsonl');
    return files.find((filePath) => basename(filePath) === target);
}

async function readClaudeMessages(sessionId: string): Promise<ProviderSessionMessage[]> {
    const filePath = await locateClaudeFile(sessionId);
    if (!filePath) {
        return [];
    }
    const content = await readFile(filePath, 'utf8');
    const messages: ProviderSessionMessage[] = [];
    for (const line of content.split('\n')) {
        if (line.trim().length === 0) continue;
        let value: any;
        try {
            value = JSON.parse(line);
        } catch {
            continue;
        }
        if (!value || typeof value !== 'object' || value.isMeta === true) {
            continue;
        }
        const role: string | undefined = value.type === 'user' || value.message?.role === 'user'
            ? 'user'
            : value.type === 'assistant' || value.message?.role === 'assistant'
                ? 'assistant'
                : undefined;
        if (role !== 'user' && role !== 'assistant') {
            continue;
        }
        if (!value.message) {
            continue;
        }
        const text = extractText(value.message.content);
        // Skip system-injected command caveats / slash-command envelopes
        if (
            text.includes('<local-command-caveat>') ||
            text.trimStart().startsWith('<command-name>')
        ) {
            continue;
        }
        pushMessage(messages, role, text, parseTimestampToMs(value.timestamp));
    }
    return messages;
}

// --- Codex ------------------------------------------------------------------

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function getCodexHome(): string {
    return process.env.CODEX_HOME || join(homedir(), '.codex');
}

async function locateCodexFile(sessionId: string): Promise<string | undefined> {
    const codexHome = getCodexHome();
    const roots = [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')];
    for (const root of roots) {
        const files = await collectFilesWithExtension(root, '.jsonl');
        const match = files.find((filePath) => basename(filePath).includes(sessionId));
        if (match) {
            return match;
        }
    }
    return undefined;
}

async function readCodexMessages(sessionId: string): Promise<ProviderSessionMessage[]> {
    // Guard: only accept a UUID to avoid matching unrelated files by substring
    if (!UUID_RE.test(sessionId)) {
        return [];
    }
    const filePath = await locateCodexFile(sessionId);
    if (!filePath) {
        return [];
    }
    const content = await readFile(filePath, 'utf8');
    const messages: ProviderSessionMessage[] = [];
    for (const line of content.split('\n')) {
        if (line.trim().length === 0) continue;
        let value: any;
        try {
            value = JSON.parse(line);
        } catch {
            continue;
        }
        if (!value || typeof value !== 'object' || value.type !== 'response_item') {
            continue;
        }
        const payload = value.payload;
        if (!payload || payload.type !== 'message') {
            continue;
        }
        const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : undefined;
        if (role !== 'user' && role !== 'assistant') {
            continue;
        }
        pushMessage(messages, role, extractText(payload.content), parseTimestampToMs(value.timestamp));
    }
    return messages;
}

// --- OpenCode ---------------------------------------------------------------

function getOpenCodeBaseDir(): string {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg && xdg.length > 0) {
        return join(xdg, 'opencode');
    }
    return join(homedir(), '.local', 'share', 'opencode');
}

/** Extract text from a single OpenCode part JSON value. */
function extractPartText(part: any): string | undefined {
    if (!part || typeof part !== 'object') {
        return undefined;
    }
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0) {
        return part.text;
    }
    if (part.type === 'tool') {
        const tool = typeof part.tool === 'string' ? part.tool : 'unknown';
        return `[Tool: ${tool}]`;
    }
    return undefined;
}

async function collectPartsText(partDir: string): Promise<string> {
    const files = await collectFilesWithExtension(partDir, '.json');
    const texts: string[] = [];
    for (const filePath of files) {
        try {
            const part = JSON.parse(await readFile(filePath, 'utf8'));
            const text = extractPartText(part);
            if (text) {
                texts.push(text);
            }
        } catch {
            // ignore unreadable/invalid part files
        }
    }
    return texts.join('\n');
}

function normalizeOpenCodeRole(role: unknown): 'user' | 'assistant' | undefined {
    return role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : undefined;
}

async function readOpenCodeMessagesJson(sessionId: string): Promise<ProviderSessionMessage[]> {
    // Guard against path traversal via sessionId
    if (/[\/\\]/.test(sessionId) || sessionId.includes('..')) {
        return [];
    }
    const baseDir = getOpenCodeBaseDir();
    const messageDir = join(baseDir, 'storage', 'message', sessionId);
    try {
        await stat(messageDir);
    } catch {
        return [];
    }
    const files = await collectFilesWithExtension(messageDir, '.json');
    const entries: { ts: number; role: 'user' | 'assistant'; text: string }[] = [];
    for (const filePath of files) {
        let value: any;
        try {
            value = JSON.parse(await readFile(filePath, 'utf8'));
        } catch {
            continue;
        }
        if (!value || typeof value !== 'object' || typeof value.id !== 'string') {
            continue;
        }
        // Guard against path traversal via part id
        if (/[\/\\]/.test(value.id) || value.id.includes('..')) {
            continue;
        }
        const role = normalizeOpenCodeRole(value.role);
        if (!role) {
            continue;
        }
        const ts = parseTimestampToMs(value.time?.created) ?? 0;
        const text = await collectPartsText(join(baseDir, 'storage', 'part', value.id));
        if (text.trim().length === 0) {
            continue;
        }
        entries.push({ ts, role, text });
    }
    entries.sort((a, b) => a.ts - b.ts);
    const messages: ProviderSessionMessage[] = [];
    for (const entry of entries) {
        pushMessage(messages, entry.role, entry.text, entry.ts > 0 ? entry.ts : undefined);
    }
    return messages;
}

async function readOpenCodeMessagesSqlite(sessionId: string): Promise<ProviderSessionMessage[]> {
    const dbPath = join(getOpenCodeBaseDir(), 'opencode.db');
    try {
        await stat(dbPath);
    } catch {
        return [];
    }

    let DatabaseSync: any;
    try {
        // @ts-ignore -- node:sqlite typings are missing from the pinned @types/node
        ({ DatabaseSync } = await import('node:sqlite'));
    } catch {
        logger.debug('[sessionHistory] node:sqlite unavailable, skipping OpenCode SQLite read');
        return [];
    }

    let db: any;
    try {
        db = new DatabaseSync(dbPath, { readOnly: true });
    } catch (error) {
        logger.debug('[sessionHistory] Failed to open OpenCode database for read', error);
        return [];
    }

    try {
        const msgRows = db
            .prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC')
            .all(sessionId) as { id: string; time_created: number; data: string }[];
        const partRows = db
            .prepare('SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created ASC')
            .all(sessionId) as { message_id: string; data: string }[];

        const partsByMessage = new Map<string, string[]>();
        for (const row of partRows) {
            let text: string | undefined;
            try {
                text = extractPartText(JSON.parse(row.data));
            } catch {
                text = undefined;
            }
            if (text) {
                const list = partsByMessage.get(row.message_id) ?? [];
                list.push(text);
                partsByMessage.set(row.message_id, list);
            }
        }

        const messages: ProviderSessionMessage[] = [];
        for (const row of msgRows) {
            let role: 'user' | 'assistant' | undefined;
            try {
                role = normalizeOpenCodeRole(JSON.parse(row.data)?.role);
            } catch {
                role = undefined;
            }
            if (!role) {
                continue;
            }
            const text = (partsByMessage.get(row.id) ?? []).join('\n');
            pushMessage(messages, role, text, parseTimestampToMs(row.time_created));
        }
        return messages;
    } catch (error) {
        logger.debug('[sessionHistory] Failed to read OpenCode database messages', error);
        return [];
    } finally {
        try {
            db.close();
        } catch {
            // ignore
        }
    }
}

async function readOpenCodeMessages(sessionId: string): Promise<ProviderSessionMessage[]> {
    // If the JSON message directory exists, use JSON results (even if empty);
    // only fall back to SQLite when the directory doesn't exist at all.
    const baseDir = getOpenCodeBaseDir();
    const messageDir = join(baseDir, 'storage', 'message', sessionId);
    try {
        await stat(messageDir);
        return await readOpenCodeMessagesJson(sessionId);
    } catch {
        return readOpenCodeMessagesSqlite(sessionId);
    }
}

// --- Entry point ------------------------------------------------------------

const READERS: Record<SessionHistoryProvider, (sessionId: string) => Promise<ProviderSessionMessage[]>> = {
    claude: readClaudeMessages,
    codex: readCodexMessages,
    opencode: readOpenCodeMessages,
};

function isProvider(value: string): value is SessionHistoryProvider {
    return value === 'claude' || value === 'codex' || value === 'opencode';
}

export async function readProviderSession(request: ReadProviderSessionRequest): Promise<ReadProviderSessionResult> {
    try {
        const provider = request.provider;
        if (!isProvider(provider)) {
            return { type: 'error', errorMessage: `Unknown provider: ${provider}` };
        }
        const sessionId = request.sessionId?.trim();
        if (!sessionId) {
            return { type: 'error', errorMessage: 'sessionId is required' };
        }

        const all = await READERS[provider](sessionId);
        const total = all.length;

        // Offset counts from the newest message so the app can lazily page
        // older history as it scrolls up. Return the slice in chronological
        // (oldest -> newest) order.
        const offset = Math.max(0, Math.trunc(request.offset ?? 0));
        const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(request.limit ?? DEFAULT_LIMIT)));
        const end = Math.max(0, total - offset);
        const start = Math.max(0, end - limit);
        const page = all.slice(start, end);

        return {
            type: 'success',
            messages: page,
            total,
            hasMore: start > 0,
        };
    } catch (error) {
        logger.debug('[sessionHistory] readProviderSession failed', error);
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to read provider session',
        };
    }
}
