/**
 * Scan OpenCode session history from `$XDG_DATA_HOME || ~/.local/share`/opencode.
 *
 * Two storage backends exist:
 * - Legacy flat files: `storage/session/**.json` with
 *   `{ id, title, directory, time: { created, updated } }`.
 * - Newer SQLite database: `opencode.db` with a `session` table.
 *   Read only when the runtime provides `node:sqlite` (Node >= 22.5);
 *   otherwise SQLite sessions are skipped gracefully.
 *
 * Ported from cc-switch `session_manager/providers/opencode.rs`.
 */

import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { logger } from '@/ui/logger';
import type { ProviderSessionMeta } from './types';
import { collectFilesWithExtension, parseTimestampToMs, pathBasename, truncateSummary, TITLE_MAX_CHARS } from './utils';

function getOpenCodeBaseDir(): string {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg && xdg.length > 0) {
        return join(xdg, 'opencode');
    }
    return join(homedir(), '.local', 'share', 'opencode');
}

export async function scanOpenCodeSessions(): Promise<ProviderSessionMeta[]> {
    const baseDir = getOpenCodeBaseDir();
    const [jsonSessions, sqliteSessions] = await Promise.all([
        scanSessionsJson(join(baseDir, 'storage', 'session')),
        scanSessionsSqlite(join(baseDir, 'opencode.db')),
    ]);

    // Deduplicate: keep SQLite version when the same sessionId exists in both
    if (sqliteSessions.length === 0) {
        return jsonSessions;
    }
    const sqliteIds = new Set(sqliteSessions.map((s) => s.sessionId));
    return [...sqliteSessions, ...jsonSessions.filter((s) => !sqliteIds.has(s.sessionId))];
}

async function scanSessionsJson(sessionDir: string): Promise<ProviderSessionMeta[]> {
    const files = await collectFilesWithExtension(sessionDir, '.json');
    const sessions: ProviderSessionMeta[] = [];
    for (const filePath of files) {
        const meta = await parseSessionJson(filePath).catch(() => null);
        if (meta) {
            sessions.push(meta);
        }
    }
    return sessions;
}

async function parseSessionJson(filePath: string): Promise<ProviderSessionMeta | null> {
    const value = JSON.parse(await readFile(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || typeof value.id !== 'string') {
        return null;
    }

    const title = typeof value.title === 'string' && value.title.length > 0 ? value.title : undefined;
    const directory = typeof value.directory === 'string' && value.directory.length > 0 ? value.directory : undefined;
    const createdAt = parseTimestampToMs(value.time?.created);
    const updatedAt = parseTimestampToMs(value.time?.updated);

    // Derive title from directory basename if no explicit title
    const displayTitle = title !== undefined
        ? truncateSummary(title, TITLE_MAX_CHARS)
        : directory !== undefined
            ? pathBasename(directory)
            : undefined;

    return {
        provider: 'opencode',
        sessionId: value.id,
        title: displayTitle,
        summary: displayTitle,
        projectDir: directory,
        createdAt,
        lastActiveAt: updatedAt ?? createdAt,
        resumable: true,
    };
}

async function scanSessionsSqlite(dbPath: string): Promise<ProviderSessionMeta[]> {
    try {
        await stat(dbPath);
    } catch {
        return [];
    }

    // node:sqlite is only available on Node >= 22.5; fall back gracefully
    let DatabaseSync: any;
    try {
        // @ts-ignore -- node:sqlite typings are missing from the pinned @types/node
        ({ DatabaseSync } = await import('node:sqlite'));
    } catch {
        logger.debug('[sessionHistory] node:sqlite unavailable, skipping OpenCode SQLite sessions');
        return [];
    }

    let db: any;
    try {
        db = new DatabaseSync(dbPath, { readOnly: true });
    } catch (error) {
        logger.debug('[sessionHistory] Failed to open OpenCode database', error);
        return [];
    }

    try {
        const rows = db
            .prepare('SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC')
            .all() as { id: string; title: string; directory: string; time_created: number; time_updated: number }[];

        const sessions: ProviderSessionMeta[] = [];
        for (const row of rows) {
            if (typeof row.id !== 'string' || row.id.length === 0) {
                continue;
            }
            const displayTitle = row.title && row.title.length > 0
                ? truncateSummary(row.title, TITLE_MAX_CHARS)
                : row.directory
                    ? pathBasename(row.directory)
                    : undefined;
            sessions.push({
                provider: 'opencode',
                sessionId: row.id,
                title: displayTitle,
                summary: displayTitle,
                projectDir: row.directory && row.directory.length > 0 ? row.directory : undefined,
                createdAt: parseTimestampToMs(row.time_created),
                lastActiveAt: parseTimestampToMs(row.time_updated),
                resumable: true,
            });
        }
        return sessions;
    } catch (error) {
        logger.debug('[sessionHistory] Failed to query OpenCode database', error);
        return [];
    } finally {
        try {
            db.close();
        } catch {
            // ignore
        }
    }
}
