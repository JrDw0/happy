/**
 * Scan Codex session history from `$CODEX_HOME || ~/.codex`.
 *
 * Rollout transcripts live in `sessions/**.jsonl` and
 * `archived_sessions/**.jsonl`. Thread titles are looked up from
 * `session_index.jsonl` (plain JSONL, no SQLite dependency).
 * Ported from cc-switch `session_manager/providers/codex.rs`.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { readHeadTailLines } from './readHeadTail';
import type { ProviderSessionMeta } from './types';
import {
    collectFilesWithExtension,
    extractText,
    parseTimestampToMs,
    pathBasename,
    truncateSummary,
    SUMMARY_MAX_CHARS,
    TITLE_MAX_CHARS,
} from './utils';

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function getCodexHome(): string {
    return process.env.CODEX_HOME || join(homedir(), '.codex');
}

export async function scanCodexSessions(): Promise<ProviderSessionMeta[]> {
    const codexHome = getCodexHome();
    const roots = [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')];
    const threadTitles = await loadThreadTitles(join(codexHome, 'session_index.jsonl'));

    const files: string[] = [];
    for (const root of roots) {
        files.push(...(await collectFilesWithExtension(root, '.jsonl')));
    }

    const sessions: ProviderSessionMeta[] = [];
    for (const filePath of files) {
        const meta = await parseSession(filePath, threadTitles).catch(() => null);
        if (meta) {
            sessions.push(meta);
        }
    }
    return sessions;
}

/** Load `{id, thread_name}` entries from `~/.codex/session_index.jsonl`. */
async function loadThreadTitles(indexPath: string): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    let content: string;
    try {
        content = await readFile(indexPath, 'utf8');
    } catch {
        return titles;
    }
    for (const line of content.split('\n')) {
        let entry: any;
        try {
            entry = JSON.parse(line.trim());
        } catch {
            continue;
        }
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        const title = typeof entry.thread_name === 'string' ? entry.thread_name.trim() : '';
        if (id.length > 0 && title.length > 0) {
            titles.set(id, title);
        }
    }
    return titles;
}

function isSubagentSource(source: unknown): boolean {
    return !!source && typeof source === 'object' && !Array.isArray(source) && 'subagent' in (source as object);
}

function titleCandidateFromUserMessage(text: string): string | undefined {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.startsWith('# AGENTS.md') || trimmed.startsWith('<environment_context>')) {
        return undefined;
    }
    return trimmed;
}

function inferSessionIdFromFilename(filePath: string): string | undefined {
    const match = basename(filePath).match(UUID_RE);
    return match ? match[0] : undefined;
}

async function parseSession(filePath: string, threadTitles: Map<string, string>): Promise<ProviderSessionMeta | null> {
    const { head, tail } = await readHeadTailLines(filePath, 10, 30);

    let sessionId: string | undefined;
    let projectDir: string | undefined;
    let createdAt: number | undefined;
    let firstUserMessage: string | undefined;

    // Extract metadata and first user message from head lines
    for (const line of head) {
        let value: any;
        try {
            value = JSON.parse(line);
        } catch {
            continue;
        }
        if (!value || typeof value !== 'object') {
            continue;
        }
        if (createdAt === undefined) {
            createdAt = parseTimestampToMs(value.timestamp);
        }
        if (value.type === 'session_meta' && value.payload && typeof value.payload === 'object') {
            const payload = value.payload;
            if (isSubagentSource(payload.source)) {
                return null;
            }
            if (sessionId === undefined && typeof payload.id === 'string') {
                sessionId = payload.id;
            }
            if (projectDir === undefined && typeof payload.cwd === 'string') {
                projectDir = payload.cwd;
            }
            if (createdAt === undefined) {
                createdAt = parseTimestampToMs(payload.timestamp);
            }
        }
        // Extract first user message as title candidate
        if (firstUserMessage === undefined && value.type === 'response_item' && value.payload) {
            const payload = value.payload;
            if (payload.type === 'message' && payload.role === 'user') {
                const text = extractText(payload.content);
                const candidate = titleCandidateFromUserMessage(text);
                if (candidate !== undefined) {
                    firstUserMessage = candidate;
                }
            }
        }
        if (sessionId !== undefined && projectDir !== undefined && createdAt !== undefined && firstUserMessage !== undefined) {
            break;
        }
    }

    // Extract lastActiveAt and summary from tail lines (reverse order)
    let lastActiveAt: number | undefined;
    let summary: string | undefined;

    for (let i = tail.length - 1; i >= 0; i--) {
        let value: any;
        try {
            value = JSON.parse(tail[i]);
        } catch {
            continue;
        }
        if (!value || typeof value !== 'object') {
            continue;
        }
        if (lastActiveAt === undefined) {
            lastActiveAt = parseTimestampToMs(value.timestamp);
        }
        if (summary === undefined && value.type === 'response_item' && value.payload?.type === 'message') {
            const text = extractText(value.payload.content);
            if (text.trim().length > 0) {
                summary = text;
            }
        }
        if (lastActiveAt !== undefined && summary !== undefined) {
            break;
        }
    }

    const resolvedSessionId = sessionId ?? inferSessionIdFromFilename(filePath);
    if (!resolvedSessionId) {
        return null;
    }

    // Title priority: session index thread name > first user message > directory basename
    const indexTitle = threadTitles.get(resolvedSessionId);
    const title = indexTitle !== undefined
        ? truncateSummary(indexTitle, TITLE_MAX_CHARS)
        : firstUserMessage !== undefined
            ? truncateSummary(firstUserMessage, TITLE_MAX_CHARS)
            : projectDir !== undefined
                ? pathBasename(projectDir)
                : undefined;

    return {
        provider: 'codex',
        sessionId: resolvedSessionId,
        title,
        summary: summary !== undefined ? truncateSummary(summary, SUMMARY_MAX_CHARS) : undefined,
        projectDir,
        createdAt,
        lastActiveAt,
        resumable: true,
    };
}
