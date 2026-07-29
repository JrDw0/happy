import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listProviderSessions } from './index';
import type { ProviderSessionMeta } from './types';
import { scanClaudeSessions } from './scanClaude';
import { scanCodexSessions } from './scanCodex';
import { scanOpenCodeSessions } from './scanOpenCode';

vi.mock('./scanClaude', () => ({ scanClaudeSessions: vi.fn() }));
vi.mock('./scanCodex', () => ({ scanCodexSessions: vi.fn() }));
vi.mock('./scanOpenCode', () => ({ scanOpenCodeSessions: vi.fn() }));

const mockClaude = vi.mocked(scanClaudeSessions);
const mockCodex = vi.mocked(scanCodexSessions);
const mockOpenCode = vi.mocked(scanOpenCodeSessions);

function meta(overrides: Partial<ProviderSessionMeta> & { sessionId: string }): ProviderSessionMeta {
    return {
        provider: 'claude',
        resumable: true,
        ...overrides,
    };
}

beforeEach(() => {
    mockClaude.mockReset().mockResolvedValue([]);
    mockCodex.mockReset().mockResolvedValue([]);
    mockOpenCode.mockReset().mockResolvedValue([]);
});

describe('listProviderSessions', () => {
    it('merges all providers sorted by recency', async () => {
        mockClaude.mockResolvedValue([meta({ sessionId: 'c1', lastActiveAt: 100 })]);
        mockCodex.mockResolvedValue([meta({ provider: 'codex', sessionId: 'x1', lastActiveAt: 300 })]);
        mockOpenCode.mockResolvedValue([meta({ provider: 'opencode', sessionId: 'o1', createdAt: 200 })]);

        const result = await listProviderSessions();
        expect(result.type).toBe('success');
        if (result.type !== 'success') return;
        expect(result.sessions.map((s) => s.sessionId)).toEqual(['x1', 'o1', 'c1']);
        expect(result.total).toBe(3);
        expect(result.hasMore).toBe(false);
    });

    it('sinks sessions without timestamps to the end', async () => {
        mockClaude.mockResolvedValue([
            meta({ sessionId: 'no-time' }),
            meta({ sessionId: 'recent', lastActiveAt: 500 }),
        ]);

        const result = await listProviderSessions();
        if (result.type !== 'success') throw new Error('expected success');
        expect(result.sessions.map((s) => s.sessionId)).toEqual(['recent', 'no-time']);
    });

    it('isolates a failing provider without breaking the rest', async () => {
        mockClaude.mockRejectedValue(new Error('claude scan exploded'));
        mockCodex.mockResolvedValue([meta({ provider: 'codex', sessionId: 'x1', lastActiveAt: 1 })]);

        const result = await listProviderSessions();
        expect(result.type).toBe('success');
        if (result.type !== 'success') return;
        expect(result.sessions.map((s) => s.sessionId)).toEqual(['x1']);
    });

    it('scans only the requested providers', async () => {
        mockCodex.mockResolvedValue([meta({ provider: 'codex', sessionId: 'x1' })]);

        const result = await listProviderSessions({ providers: ['codex'] });
        expect(result.type).toBe('success');
        expect(mockClaude).not.toHaveBeenCalled();
        expect(mockOpenCode).not.toHaveBeenCalled();
        expect(mockCodex).toHaveBeenCalledTimes(1);
    });

    it('ignores unknown provider names', async () => {
        const result = await listProviderSessions({ providers: ['unknown-provider'] });
        if (result.type !== 'success') throw new Error('expected success');
        expect(result.sessions).toEqual([]);
        expect(mockClaude).not.toHaveBeenCalled();
    });

    it('filters by case-insensitive query over title/summary/projectDir/sessionId', async () => {
        mockClaude.mockResolvedValue([
            meta({ sessionId: 's1', title: 'Fix Login Bug', lastActiveAt: 4 }),
            meta({ sessionId: 's2', summary: 'about the LOGIN page', lastActiveAt: 3 }),
            meta({ sessionId: 's3', projectDir: '/Users/test/login-service', lastActiveAt: 2 }),
            meta({ sessionId: 'login-4', lastActiveAt: 1 }),
            meta({ sessionId: 's5', title: 'Unrelated', lastActiveAt: 5 }),
        ]);

        const result = await listProviderSessions({ query: '  Login ' });
        if (result.type !== 'success') throw new Error('expected success');
        expect(result.sessions.map((s) => s.sessionId)).toEqual(['s1', 's2', 's3', 'login-4']);
        expect(result.total).toBe(4);
    });

    it('applies offset/limit pagination with hasMore', async () => {
        mockClaude.mockResolvedValue(
            Array.from({ length: 10 }, (_, i) => meta({ sessionId: `s${i}`, lastActiveAt: 1000 - i })),
        );

        const page1 = await listProviderSessions({ limit: 4 });
        if (page1.type !== 'success') throw new Error('expected success');
        expect(page1.sessions.map((s) => s.sessionId)).toEqual(['s0', 's1', 's2', 's3']);
        expect(page1.total).toBe(10);
        expect(page1.hasMore).toBe(true);

        const page3 = await listProviderSessions({ limit: 4, offset: 8 });
        if (page3.type !== 'success') throw new Error('expected success');
        expect(page3.sessions.map((s) => s.sessionId)).toEqual(['s8', 's9']);
        expect(page3.hasMore).toBe(false);
    });

    it('clamps invalid offset and limit values', async () => {
        mockClaude.mockResolvedValue(
            Array.from({ length: 5 }, (_, i) => meta({ sessionId: `s${i}`, lastActiveAt: 100 - i })),
        );

        const result = await listProviderSessions({ offset: -10, limit: 0 });
        if (result.type !== 'success') throw new Error('expected success');
        // Negative offset clamps to 0, limit clamps up to at least 1
        expect(result.sessions[0].sessionId).toBe('s0');
        expect(result.sessions.length).toBe(1);
    });
});
