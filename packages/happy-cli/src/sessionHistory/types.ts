/**
 * Types for the provider session history scanner.
 *
 * The daemon scans on-disk session stores of supported AI providers
 * (Claude Code, Codex, OpenCode) and exposes them to the app via the
 * `list-provider-sessions` machine RPC so any session can be resumed
 * as a Happy session remotely.
 */

export type SessionHistoryProvider = 'claude' | 'codex' | 'opencode';

export const ALL_SESSION_HISTORY_PROVIDERS: SessionHistoryProvider[] = ['claude', 'codex', 'opencode'];

export interface ProviderSessionMeta {
    provider: SessionHistoryProvider;
    /** claude sessionId / codex threadId / opencode ses_ id */
    sessionId: string;
    title?: string;
    summary?: string;
    /** Working directory of the session; used as spawn directory when resuming */
    projectDir?: string;
    /** Unix epoch millis */
    createdAt?: number;
    /** Unix epoch millis */
    lastActiveAt?: number;
    resumable: boolean;
}

/** Field to sort the merged session list by. */
export type SessionSortBy = 'lastActiveAt' | 'createdAt' | 'projectDir';

export type SessionSortOrder = 'asc' | 'desc';

export interface ListProviderSessionsRequest {
    /** Subset of providers to scan; defaults to all */
    providers?: string[];
    /** Case-insensitive filter over title/summary/projectDir/sessionId */
    query?: string;
    /** Sort key; defaults to lastActiveAt */
    sortBy?: SessionSortBy;
    /** Sort direction; defaults to desc (projectDir sorts ascending by name) */
    sortOrder?: SessionSortOrder;
    /** Lower bound (inclusive, unix millis) over lastActiveAt ?? createdAt */
    dateFrom?: number;
    /** Upper bound (inclusive, unix millis) over lastActiveAt ?? createdAt */
    dateTo?: number;
    /** Page size, defaults to 100 */
    limit?: number;
    /** Page offset, defaults to 0 */
    offset?: number;
}

export type ListProviderSessionsResult =
    | { type: 'success'; sessions: ProviderSessionMeta[]; total: number; hasMore: boolean }
    | { type: 'error'; errorMessage: string };

/** A single normalized message in a provider session transcript. */
export interface ProviderSessionMessage {
    role: 'user' | 'assistant';
    text: string;
    /** Unix epoch millis, when available */
    timestamp?: number;
}

export interface ReadProviderSessionRequest {
    provider: string;
    sessionId: string;
    /** Page offset counted from the newest message; defaults to 0 */
    offset?: number;
    /** Page size, defaults to 50 */
    limit?: number;
}

export type ReadProviderSessionResult =
    | { type: 'success'; messages: ProviderSessionMessage[]; total: number; hasMore: boolean }
    | { type: 'error'; errorMessage: string };
