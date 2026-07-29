/**
 * Scan Claude Code session history from `$CLAUDE_CONFIG_DIR || ~/.claude`.
 *
 * Session transcripts live in `projects/<encoded-cwd>/<sessionId>.jsonl`.
 * Ported from cc-switch `session_manager/providers/claude.rs`: only the
 * head 10 / tail 30 lines of each file are read.
 */

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

function getClaudeProjectsDir(): string {
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    return join(claudeConfigDir, 'projects');
}

export async function scanClaudeSessions(): Promise<ProviderSessionMeta[]> {
    const files = await collectFilesWithExtension(getClaudeProjectsDir(), '.jsonl');
    const sessions: ProviderSessionMeta[] = [];
    for (const filePath of files) {
        const meta = await parseSession(filePath).catch(() => null);
        if (meta) {
            sessions.push(meta);
        }
    }
    return sessions;
}

function isAgentSession(filePath: string): boolean {
    return basename(filePath).startsWith('agent-');
}

function inferSessionIdFromFilename(filePath: string): string | undefined {
    const name = basename(filePath).replace(/\.jsonl$/, '');
    return name.length > 0 ? name : undefined;
}

async function parseSession(filePath: string): Promise<ProviderSessionMeta | null> {
    if (isAgentSession(filePath)) {
        return null;
    }

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
        if (sessionId === undefined && typeof value.sessionId === 'string') {
            sessionId = value.sessionId;
        }
        if (projectDir === undefined && typeof value.cwd === 'string') {
            projectDir = value.cwd;
        }
        if (createdAt === undefined) {
            createdAt = parseTimestampToMs(value.timestamp);
        }
        // Extract first real user message as title candidate.
        // Skip system-injected caveats and slash commands (e.g. /clear, /compact)
        if (firstUserMessage === undefined) {
            const isUser = value.type === 'user' || value.message?.role === 'user';
            if (isUser && value.message) {
                const text = extractText(value.message.content).trim();
                if (
                    text.length > 0 &&
                    !text.includes('<local-command-caveat>') &&
                    !text.startsWith('<command-name>')
                ) {
                    firstUserMessage = text;
                }
            }
        }
        if (sessionId !== undefined && projectDir !== undefined && createdAt !== undefined && firstUserMessage !== undefined) {
            break;
        }
    }

    // Extract lastActiveAt, summary, and custom-title from tail lines (reverse order)
    let lastActiveAt: number | undefined;
    let summary: string | undefined;
    let customTitle: string | undefined;

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
        // Look for custom-title entry (take the last one, i.e. first in reverse)
        if (customTitle === undefined && value.type === 'custom-title' && typeof value.customTitle === 'string') {
            const trimmed = value.customTitle.trim();
            if (trimmed.length > 0) {
                customTitle = trimmed;
            }
        }
        if (summary === undefined) {
            if (value.isMeta === true) {
                continue;
            }
            if (value.message) {
                const text = extractText(value.message.content);
                if (text.trim().length > 0) {
                    summary = text;
                }
            }
        }
        if (lastActiveAt !== undefined && summary !== undefined && customTitle !== undefined) {
            break;
        }
    }

    const resolvedSessionId = sessionId ?? inferSessionIdFromFilename(filePath);
    if (!resolvedSessionId) {
        return null;
    }

    // Title priority: custom-title > first user message > directory basename
    const title = customTitle !== undefined
        ? truncateSummary(customTitle, TITLE_MAX_CHARS)
        : firstUserMessage !== undefined
            ? truncateSummary(firstUserMessage, TITLE_MAX_CHARS)
            : projectDir !== undefined
                ? pathBasename(projectDir)
                : undefined;

    return {
        provider: 'claude',
        sessionId: resolvedSessionId,
        title,
        summary: summary !== undefined ? truncateSummary(summary, SUMMARY_MAX_CHARS) : undefined,
        projectDir,
        createdAt,
        lastActiveAt,
        resumable: true,
    };
}
