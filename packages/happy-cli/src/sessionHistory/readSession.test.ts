import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readProviderSession, readOpenCodeMessagesForBackfill } from './readSession';

/**
 * Fixture-based tests for the on-disk session transcript reader. Each
 * provider resolves its root directory from an environment variable, so
 * tests point them at temp directories populated with fixture files.
 */

let testDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
    testDir = join(tmpdir(), `read-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    savedEnv.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
    savedEnv.CODEX_HOME = process.env.CODEX_HOME;
    savedEnv.XDG_DATA_HOME = process.env.XDG_DATA_HOME;
    process.env.CLAUDE_CONFIG_DIR = join(testDir, 'claude');
    process.env.CODEX_HOME = join(testDir, 'codex');
    process.env.XDG_DATA_HOME = join(testDir, 'xdg');
});

afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    await rm(testDir, { recursive: true, force: true });
});

function jsonl(entries: unknown[]): string {
    return entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

const CLAUDE_ID = '11111111-1111-1111-1111-111111111111';
const CODEX_ID = '22222222-2222-2222-2222-222222222222';

async function writeClaudeSession(content: string): Promise<void> {
    const projectDir = join(testDir, 'claude', 'projects', '-Users-test-project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_ID}.jsonl`), content);
}

async function writeCodexSession(content: string): Promise<void> {
    const dir = join(testDir, 'codex', 'sessions', '2024', '06', '01');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `rollout-2024-06-01T10-00-00-${CODEX_ID}.jsonl`), content);
}

describe('readProviderSession - claude', () => {
    it('normalizes user/assistant messages, skipping meta and command envelopes', async () => {
        await writeClaudeSession(jsonl([
            { sessionId: CLAUDE_ID, cwd: '/Users/test/project', timestamp: '2024-06-01T10:00:00Z', type: 'user', message: { role: 'user', content: '<local-command-caveat>injected</local-command-caveat>' } },
            { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
            { type: 'user', message: { role: 'user', content: 'Fix the login bug' }, timestamp: '2024-06-01T10:00:10Z' },
            { isMeta: true, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'meta noise' }] } },
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }, timestamp: '2024-06-01T10:01:00Z' },
        ]));

        const result = await readProviderSession({ provider: 'claude', sessionId: CLAUDE_ID });
        if (result.type !== 'success') throw new Error('expected success');
        expect(result.messages).toEqual([
            { role: 'user', text: 'Fix the login bug', timestamp: Date.parse('2024-06-01T10:00:10Z') },
            { role: 'assistant', text: 'Done.', timestamp: Date.parse('2024-06-01T10:01:00Z') },
        ]);
        expect(result.total).toBe(2);
        expect(result.hasMore).toBe(false);
    });

    it('paginates from the newest message with hasMore', async () => {
        await writeClaudeSession(jsonl(
            Array.from({ length: 5 }, (_, i) => ({
                type: 'user',
                message: { role: 'user', content: `m${i}` },
                timestamp: `2024-06-01T10:0${i}:00Z`,
            })),
        ));

        const page1 = await readProviderSession({ provider: 'claude', sessionId: CLAUDE_ID, offset: 0, limit: 2 });
        if (page1.type !== 'success') throw new Error('expected success');
        // Newest two, returned oldest -> newest
        expect(page1.messages.map((m) => m.text)).toEqual(['m3', 'm4']);
        expect(page1.total).toBe(5);
        expect(page1.hasMore).toBe(true);

        const page3 = await readProviderSession({ provider: 'claude', sessionId: CLAUDE_ID, offset: 4, limit: 2 });
        if (page3.type !== 'success') throw new Error('expected success');
        expect(page3.messages.map((m) => m.text)).toEqual(['m0']);
        expect(page3.hasMore).toBe(false);
    });

    it('returns empty when the session file does not exist', async () => {
        const result = await readProviderSession({ provider: 'claude', sessionId: CLAUDE_ID });
        if (result.type !== 'success') throw new Error('expected success');
        expect(result.messages).toEqual([]);
        expect(result.total).toBe(0);
    });
});

describe('readProviderSession - codex', () => {
    it('reads response_item messages from a rollout file matched by UUID', async () => {
        await writeCodexSession(jsonl([
            { type: 'session_meta', payload: { id: CODEX_ID, cwd: '/Users/test/project' }, timestamp: '2024-06-01T10:00:00Z' },
            { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello codex' }] }, timestamp: '2024-06-01T10:00:05Z' },
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi there' }] }, timestamp: '2024-06-01T10:00:10Z' },
        ]));

        const result = await readProviderSession({ provider: 'codex', sessionId: CODEX_ID });
        if (result.type !== 'success') throw new Error('expected success');
        expect(result.messages).toEqual([
            { role: 'user', text: 'Hello codex', timestamp: Date.parse('2024-06-01T10:00:05Z') },
            { role: 'assistant', text: 'Hi there', timestamp: Date.parse('2024-06-01T10:00:10Z') },
        ]);
    });

    it('rejects a non-UUID sessionId without scanning', async () => {
        const result = await readProviderSession({ provider: 'codex', sessionId: 'not-a-uuid' });
        if (result.type !== 'success') throw new Error('expected success');
        expect(result.messages).toEqual([]);
    });
});

describe('readProviderSession - opencode (json backend)', () => {
    it('joins message + part files sorted by creation time', async () => {
        const sessionId = 'ses_abc';
        const base = join(testDir, 'xdg', 'opencode', 'storage');
        const msgDir = join(base, 'message', sessionId);
        await mkdir(msgDir, { recursive: true });
        await writeFile(join(msgDir, 'msg_1.json'), JSON.stringify({ id: 'msg_1', role: 'user', time: { created: 1_700_000_001_000 } }));
        await writeFile(join(msgDir, 'msg_2.json'), JSON.stringify({ id: 'msg_2', role: 'assistant', time: { created: 1_700_000_002_000 } }));

        const part1 = join(base, 'part', 'msg_1');
        const part2 = join(base, 'part', 'msg_2');
        await mkdir(part1, { recursive: true });
        await mkdir(part2, { recursive: true });
        await writeFile(join(part1, 'prt_1.json'), JSON.stringify({ id: 'prt_1', type: 'text', text: 'Hello' }));
        await writeFile(join(part2, 'prt_2.json'), JSON.stringify({ id: 'prt_2', type: 'tool', tool: 'bash' }));
        await writeFile(join(part2, 'prt_3.json'), JSON.stringify({ id: 'prt_3', type: 'text', text: 'Done' }));

        const result = await readProviderSession({ provider: 'opencode', sessionId });
        if (result.type !== 'success') throw new Error('expected success');
        expect(result.messages[0]).toEqual({ role: 'user', text: 'Hello', timestamp: 1_700_000_001_000 });
        expect(result.messages[1].role).toBe('assistant');
        expect(result.messages[1].text).toContain('[Tool: bash]');
        expect(result.messages[1].text).toContain('Done');
    });
});

describe('readOpenCodeMessagesForBackfill', () => {
    async function writeOpenCodeMessage(sessionId: string, id: string, role: string, created: number, partText?: string): Promise<void> {
        const base = join(testDir, 'xdg', 'opencode', 'storage');
        const msgDir = join(base, 'message', sessionId);
        await mkdir(msgDir, { recursive: true });
        await writeFile(join(msgDir, `${id}.json`), JSON.stringify({ id, role, time: { created } }));
        if (partText !== undefined) {
            const partDir = join(base, 'part', id);
            await mkdir(partDir, { recursive: true });
            await writeFile(join(partDir, `prt_${id}.json`), JSON.stringify({ id: `prt_${id}`, type: 'text', text: partText }));
        }
    }

    it('returns only the most recent maxMessages in chronological order', async () => {
        const sessionId = 'ses_backfill';
        for (let i = 0; i < 5; i++) {
            await writeOpenCodeMessage(sessionId, `msg_${i}`, i % 2 === 0 ? 'user' : 'assistant', 1_700_000_000_000 + i * 1000, `text ${i}`);
        }

        const messages = await readOpenCodeMessagesForBackfill(sessionId, 2);
        expect(messages.map((m) => m.text)).toEqual(['text 3', 'text 4']);
        expect(messages.map((m) => m.role)).toEqual(['assistant', 'user']);
        expect(messages.map((m) => m.timestamp)).toEqual([1_700_000_003_000, 1_700_000_004_000]);
    });

    it('does not require part files for messages outside the window', async () => {
        const sessionId = 'ses_window';
        // Older messages have no part directories at all; only the newest
        // two do. The windowed reader must not depend on the older parts.
        await writeOpenCodeMessage(sessionId, 'msg_old_1', 'user', 1_700_000_001_000);
        await writeOpenCodeMessage(sessionId, 'msg_old_2', 'assistant', 1_700_000_002_000);
        await writeOpenCodeMessage(sessionId, 'msg_new_1', 'user', 1_700_000_003_000, 'recent question');
        await writeOpenCodeMessage(sessionId, 'msg_new_2', 'assistant', 1_700_000_004_000, 'recent answer');

        const messages = await readOpenCodeMessagesForBackfill(sessionId, 2);
        expect(messages.map((m) => m.text)).toEqual(['recent question', 'recent answer']);
    });

    it('truncates oversized message text', async () => {
        const sessionId = 'ses_clamp';
        await writeOpenCodeMessage(sessionId, 'msg_big', 'user', 1_700_000_001_000, 'x'.repeat(5000));

        const messages = await readOpenCodeMessagesForBackfill(sessionId, 10);
        expect(messages).toHaveLength(1);
        expect(messages[0].text.length).toBeLessThan(5000);
        expect(messages[0].text.endsWith('...[truncated]')).toBe(true);
    });

    it('returns empty instead of throwing when the session has no storage', async () => {
        await expect(readOpenCodeMessagesForBackfill('ses_missing', 10)).resolves.toEqual([]);
    });

    it('returns empty for a blank sessionId', async () => {
        await expect(readOpenCodeMessagesForBackfill('   ', 10)).resolves.toEqual([]);
    });
});

describe('readProviderSession - validation', () => {
    it('errors on an unknown provider', async () => {
        const result = await readProviderSession({ provider: 'nope', sessionId: 'x' });
        expect(result.type).toBe('error');
    });

    it('errors on an empty sessionId', async () => {
        const result = await readProviderSession({ provider: 'claude', sessionId: '   ' });
        expect(result.type).toBe('error');
    });
});
