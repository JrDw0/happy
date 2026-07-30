// Pure session-list grouping helpers, extracted from storage.ts so they can
// be unit-tested without pulling in the zustand store and its RN dependencies.

export interface GroupableSession {
    active: boolean;
    metadata?: {
        isSideChat?: boolean;
        lifecycleState?: string;
    } | null;
}

// Split into active / offline (inactive but recoverable) / archived (explicit
// user or CLI intent). Side chats are hidden children of another session —
// they render only inside the parent's sidebar panel, never in this list.
export function splitSessionsForList<T extends GroupableSession>(sessions: T[]): {
    active: T[];
    offline: T[];
    archived: T[];
} {
    const active: T[] = [];
    const offline: T[] = [];
    const archived: T[] = [];
    for (const session of sessions) {
        if (session.metadata?.isSideChat) {
            continue;
        }
        if (session.active) {
            active.push(session);
        } else if (session.metadata?.lifecycleState === 'archived' || session.metadata?.lifecycleState === 'archiveRequested') {
            archived.push(session);
        } else {
            offline.push(session);
        }
    }
    return { active, offline, archived };
}

// Group consecutive sessions that share a calendar day (input is expected to
// already be sorted newest-first by sortKey).
export function groupSessionsByDate<T>(
    sessions: T[],
    sortKey: (session: T) => number,
): { dateString: string; sessions: T[] }[] {
    const groups: { dateString: string; sessions: T[] }[] = [];
    for (const session of sessions) {
        const dateString = new Date(sortKey(session)).toDateString();
        const last = groups[groups.length - 1];
        if (last && last.dateString === dateString) {
            last.sessions.push(session);
        } else {
            groups.push({ dateString, sessions: [session] });
        }
    }
    return groups;
}
