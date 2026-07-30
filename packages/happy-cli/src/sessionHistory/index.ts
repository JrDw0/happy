/**
 * Aggregated provider session history listing.
 *
 * Scans all requested providers in parallel with per-provider failure
 * isolation, merges results sorted by recency, and applies query
 * filtering + pagination on the daemon side so responses stay well
 * within the 30s machine RPC timeout and payload limits.
 */

import { logger } from '@/ui/logger';
import { scanClaudeSessions } from './scanClaude';
import { scanCodexSessions } from './scanCodex';
import { scanOpenCodeSessions } from './scanOpenCode';
import {
    ALL_SESSION_HISTORY_PROVIDERS,
    type ListProviderSessionsRequest,
    type ListProviderSessionsResult,
    type ProviderSessionMeta,
    type SessionHistoryProvider,
    type SessionSortBy,
    type SessionSortOrder,
} from './types';

export * from './types';
export { readProviderSession, readOpenCodeMessagesForBackfill } from './readSession';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const PROVIDER_SCANNERS: Record<SessionHistoryProvider, () => Promise<ProviderSessionMeta[]>> = {
    claude: scanClaudeSessions,
    codex: scanCodexSessions,
    opencode: scanOpenCodeSessions,
};

function resolveProviders(requested: string[] | undefined): SessionHistoryProvider[] {
    if (!requested || requested.length === 0) {
        return ALL_SESSION_HISTORY_PROVIDERS;
    }
    return ALL_SESSION_HISTORY_PROVIDERS.filter((provider) => requested.includes(provider));
}

function matchesQuery(session: ProviderSessionMeta, query: string): boolean {
    const haystack = [session.title, session.summary, session.projectDir, session.sessionId];
    return haystack.some((field) => field !== undefined && field.toLowerCase().includes(query));
}

/** Recency used for date filtering and the time-based sorts. */
function sessionTime(session: ProviderSessionMeta): number {
    return session.lastActiveAt ?? session.createdAt ?? 0;
}

function compareSessions(a: ProviderSessionMeta, b: ProviderSessionMeta, sortBy: SessionSortBy, sortOrder: SessionSortOrder): number {
    if (sortBy === 'projectDir') {
        const dirA = a.projectDir ?? '';
        const dirB = b.projectDir ?? '';
        const cmp = dirA.localeCompare(dirB);
        if (cmp !== 0) {
            return sortOrder === 'asc' ? cmp : -cmp;
        }
        // Secondary: most recently active first within the same project
        return sessionTime(b) - sessionTime(a);
    }

    const timeA = sortBy === 'createdAt' ? (a.createdAt ?? a.lastActiveAt ?? 0) : sessionTime(a);
    const timeB = sortBy === 'createdAt' ? (b.createdAt ?? b.lastActiveAt ?? 0) : sessionTime(b);
    return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
}

export async function listProviderSessions(request: ListProviderSessionsRequest = {}): Promise<ListProviderSessionsResult> {
    try {
        const providers = resolveProviders(request.providers);

        // Scan providers in parallel; a failing provider must not break the rest
        const results = await Promise.allSettled(providers.map((provider) => PROVIDER_SCANNERS[provider]()));
        const sessions: ProviderSessionMeta[] = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
                sessions.push(...result.value);
            } else {
                logger.debug(`[sessionHistory] Failed to scan ${providers[i]} sessions`, result.reason);
            }
        }

        // Sort by the requested key (defaults to most recently active first).
        // projectDir sorts ascending by name unless an order is given.
        const sortBy: SessionSortBy = request.sortBy ?? 'lastActiveAt';
        const sortOrder: SessionSortOrder = request.sortOrder ?? (sortBy === 'projectDir' ? 'asc' : 'desc');
        sessions.sort((a, b) => compareSessions(a, b, sortBy, sortOrder));

        const query = request.query?.trim().toLowerCase();
        let filtered = query ? sessions.filter((session) => matchesQuery(session, query)) : sessions;

        // Date range filter over lastActiveAt ?? createdAt (inclusive bounds)
        const { dateFrom, dateTo } = request;
        if (typeof dateFrom === 'number' || typeof dateTo === 'number') {
            filtered = filtered.filter((session) => {
                const time = sessionTime(session);
                if (typeof dateFrom === 'number' && time < dateFrom) {
                    return false;
                }
                if (typeof dateTo === 'number' && time > dateTo) {
                    return false;
                }
                return true;
            });
        }

        const offset = Math.max(0, Math.trunc(request.offset ?? 0));
        const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(request.limit ?? DEFAULT_LIMIT)));
        const page = filtered.slice(offset, offset + limit);

        return {
            type: 'success',
            sessions: page,
            total: filtered.length,
            hasMore: offset + page.length < filtered.length,
        };
    } catch (error) {
        logger.debug('[sessionHistory] listProviderSessions failed', error);
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to list provider sessions',
        };
    }
}
