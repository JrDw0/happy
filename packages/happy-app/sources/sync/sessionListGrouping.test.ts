import { describe, expect, it } from 'vitest';
import { splitSessionsForList, groupSessionsByDate } from './sessionListGrouping';

function session(
    id: string,
    opts: { active?: boolean; lifecycleState?: string; isSideChat?: boolean } = {},
) {
    return {
        id,
        active: opts.active ?? false,
        metadata: {
            isSideChat: opts.isSideChat,
            lifecycleState: opts.lifecycleState,
        },
    };
}

describe('splitSessionsForList', () => {
    it('splits sessions into active, offline and archived groups', () => {
        const running = session('running', { active: true });
        const offline = session('offline');
        const archived = session('archived', { lifecycleState: 'archived' });
        const archiveRequested = session('archive-requested', { lifecycleState: 'archiveRequested' });

        const result = splitSessionsForList([running, offline, archived, archiveRequested]);

        expect(result.active.map(s => s.id)).toEqual(['running']);
        expect(result.offline.map(s => s.id)).toEqual(['offline']);
        expect(result.archived.map(s => s.id)).toEqual(['archived', 'archive-requested']);
    });

    it('treats inactive sessions without archive intent as offline, not archived', () => {
        const crashed = session('crashed', { lifecycleState: 'running' });
        const noMetadata = { id: 'no-metadata', active: false, metadata: null };

        const result = splitSessionsForList([crashed, noMetadata]);

        expect(result.offline.map(s => s.id)).toEqual(['crashed', 'no-metadata']);
        expect(result.archived).toEqual([]);
    });

    it('keeps active sessions in the active group even when archive was requested', () => {
        const result = splitSessionsForList([
            session('still-running', { active: true, lifecycleState: 'archiveRequested' }),
        ]);

        expect(result.active.map(s => s.id)).toEqual(['still-running']);
        expect(result.archived).toEqual([]);
    });

    it('excludes side chats from every group', () => {
        const result = splitSessionsForList([
            session('side-active', { active: true, isSideChat: true }),
            session('side-offline', { isSideChat: true }),
        ]);

        expect(result.active).toEqual([]);
        expect(result.offline).toEqual([]);
        expect(result.archived).toEqual([]);
    });
});

describe('groupSessionsByDate', () => {
    it('groups consecutive sessions sharing a calendar day', () => {
        const day1a = { id: 'day1a', at: new Date(2026, 6, 30, 10).getTime() };
        const day1b = { id: 'day1b', at: new Date(2026, 6, 30, 8).getTime() };
        const day2 = { id: 'day2', at: new Date(2026, 6, 29, 23).getTime() };

        const groups = groupSessionsByDate([day1a, day1b, day2], s => s.at);

        expect(groups).toHaveLength(2);
        expect(groups[0].sessions.map(s => s.id)).toEqual(['day1a', 'day1b']);
        expect(groups[1].sessions.map(s => s.id)).toEqual(['day2']);
        expect(groups[0].dateString).not.toEqual(groups[1].dateString);
    });

    it('returns no groups for an empty list', () => {
        expect(groupSessionsByDate([], () => 0)).toEqual([]);
    });
});
