import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanClaudeSessions } from './scanClaude';
import { scanCodexSessions } from './scanCodex';
import { scanOpenCodeSessions } from './scanOpenCode';

/**
 * Fixture-based tests for the provider session scanners. Each scanner
 * resolves its root directory from an environment variable, so tests
 * point them at temp directories populated with fixture files.
 */

let testDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
    testDir = join(tmpdir(), `session-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('scanClaudeSessions', () => {
    async function writeClaudeSession(fileName: string, content: string): Promise<string> {
        const projectDir = join(testDir, 'claude', 'projects', '-Users-test-project');
        await mkdir(projectDir, { recursive: true });
        const filePath = join(projectDir, fileName);
        await writeFile(filePath, content);
        return filePath;
    }

    it('parses session metadata, title, and summary from a normal session', async () => {
        await writeClaudeSession('11111111-1111-1111-1111-111111111111.jsonl', jsonl([
            { sessionId: '11111111-1111-1111-1111-111111111111', cwd: '/Users/test/project', timestamp: '2024-06-01T10:00:00Z', type: 'user', message: { role: 'user', content: '<local-command-caveat>injected</local-command-caveat>' } },
            { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
            { type: 'user', message: { role: 'user', content: 'Fix the login bug' } },
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Sure, looking into it.' }] }, timestamp: '2024-06-01T10:01:00Z' },
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done, the login bug is fixed.' }] }, timestamp: '2024-06-01T11:00:00Z' },
        ]));

        const sessions = await scanClaudeSessions();
        expect(sessions).toHaveLength(1);
        const session = sessions[0];
        expect(session.provider).toBe('claude');
        expect(session.sessionId).toBe('11111111-1111-1111-1111-111111111111');
        expect(session.projectDir).toBe('/Users/test/project');
        expect(session.title).toBe('Fix the login bug');
        expect(session.summary).toBe('Done, the login bug is fixed.');
        expect(session.createdAt).toBe(Date.parse('2024-06-01T10:00:00Z'));
        expect(session.lastActiveAt).toBe(Date.parse('2024-06-01T11:00:00Z'));
        expect(session.resumable).toBe(true);
    });

    it('prefers custom-title over the first user message', async () => {
        await writeClaudeSession('22222222-2222-2222-2222-222222222222.jsonl', jsonl([
            { sessionId: '22222222-2222-2222-2222-222222222222', cwd: '/Users/test/project', timestamp: '2024-06-01T10:00:00Z', type: 'user', message: { role: 'user', content: 'hello' } },
            { type: 'custom-title', customTitle: 'My Renamed Session', timestamp: '2024-06-01T10:05:00Z' },
        ]));

        const sessions = await scanClaudeSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].title).toBe('My Renamed Session');
    });

    it('skips agent- prefixed subagent sessions', async () => {
        await writeClaudeSession('agent-33333333-3333-3333-3333-333333333333.jsonl', jsonl([
            { sessionId: '33333333-3333-3333-3333-333333333333', cwd: '/Users/test/project', timestamp: '2024-06-01T10:00:00Z' },
        ]));

        const sessions = await scanClaudeSessions();
        expect(sessions).toHaveLength(0);
    });

    it('tolerates corrupted lines and falls back to filename for sessionId', async () => {
        await writeClaudeSession('44444444-4444-4444-4444-444444444444.jsonl',
            'not json at all\n{"broken": \n' + jsonl([{ cwd: '/Users/test/project', timestamp: '2024-06-01T10:00:00Z' }]));

        const sessions = await scanClaudeSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].sessionId).toBe('44444444-4444-4444-4444-444444444444');
        expect(sessions[0].projectDir).toBe('/Users/test/project');
    });

    it('parses oversized sessions (> 16KB) using head/tail reads only', async () => {
        const filler = Array.from({ length: 300 }, (_, i) => ({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: `filler-${i}-${'x'.repeat(80)}` }] },
            timestamp: '2024-06-01T10:30:00Z',
        }));
        await writeClaudeSession('55555555-5555-5555-5555-555555555555.jsonl', jsonl([
            { sessionId: '55555555-5555-5555-5555-555555555555', cwd: '/Users/test/project', timestamp: '2024-06-01T10:00:00Z', type: 'user', message: { role: 'user', content: 'big session start' } },
            ...filler,
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] }, timestamp: '2024-06-02T09:00:00Z' },
        ]));

        const sessions = await scanClaudeSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].sessionId).toBe('55555555-5555-5555-5555-555555555555');
        expect(sessions[0].title).toBe('big session start');
        expect(sessions[0].summary).toBe('final answer');
        expect(sessions[0].lastActiveAt).toBe(Date.parse('2024-06-02T09:00:00Z'));
    });

    it('returns empty list when the projects dir does not exist', async () => {
        const sessions = await scanClaudeSessions();
        expect(sessions).toEqual([]);
    });
});

describe('scanCodexSessions', () => {
    async function writeCodexSession(subdir: string, fileName: string, content: string): Promise<void> {
        const dir = join(testDir, 'codex', subdir, '2024', '06', '01');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, fileName), content);
    }

    it('parses session_meta and first user message', async () => {
        await writeCodexSession('sessions', 'rollout-2024-06-01-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl', jsonl([
            { type: 'session_meta', timestamp: '2024-06-01T08:00:00Z', payload: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', cwd: '/Users/test/codex-proj', timestamp: '2024-06-01T08:00:00Z' } },
            { type: 'response_item', timestamp: '2024-06-01T08:00:01Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions blah' }] } },
            { type: 'response_item', timestamp: '2024-06-01T08:00:02Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>stuff</environment_context>' }] } },
            { type: 'response_item', timestamp: '2024-06-01T08:00:03Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Refactor the parser' }] } },
            { type: 'response_item', timestamp: '2024-06-01T09:30:00Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Parser refactored.' }] } },
        ]));

        const sessions = await scanCodexSessions();
        expect(sessions).toHaveLength(1);
        const session = sessions[0];
        expect(session.provider).toBe('codex');
        expect(session.sessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        expect(session.projectDir).toBe('/Users/test/codex-proj');
        expect(session.title).toBe('Refactor the parser');
        expect(session.summary).toBe('Parser refactored.');
        expect(session.createdAt).toBe(Date.parse('2024-06-01T08:00:00Z'));
        expect(session.lastActiveAt).toBe(Date.parse('2024-06-01T09:30:00Z'));
        expect(session.resumable).toBe(true);
    });

    it('excludes subagent sessions', async () => {
        await writeCodexSession('sessions', 'rollout-2024-06-01-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl', jsonl([
            { type: 'session_meta', timestamp: '2024-06-01T08:00:00Z', payload: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', cwd: '/tmp', source: { subagent: { name: 'reviewer' } } } },
        ]));

        const sessions = await scanCodexSessions();
        expect(sessions).toHaveLength(0);
    });

    it('scans archived_sessions and uses session_index.jsonl thread names as titles', async () => {
        await writeCodexSession('archived_sessions', 'rollout-2024-06-01-cccccccc-cccc-cccc-cccc-cccccccccccc.jsonl', jsonl([
            { type: 'session_meta', timestamp: '2024-06-01T08:00:00Z', payload: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', cwd: '/Users/test/archived-proj' } },
            { type: 'response_item', timestamp: '2024-06-01T08:00:03Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first message' }] } },
        ]));
        await writeFile(join(testDir, 'codex', 'session_index.jsonl'), jsonl([
            { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', thread_name: 'Indexed Thread Title' },
        ]));

        const sessions = await scanCodexSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].title).toBe('Indexed Thread Title');
    });

    it('falls back to filename UUID when session_meta is missing', async () => {
        await writeCodexSession('sessions', 'rollout-2024-06-01-dddddddd-dddd-dddd-dddd-dddddddddddd.jsonl',
            'garbage line\n' + jsonl([
                { type: 'response_item', timestamp: '2024-06-01T08:00:03Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
            ]));

        const sessions = await scanCodexSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].sessionId).toBe('dddddddd-dddd-dddd-dddd-dddddddddddd');
    });

    it('returns empty list when codex home does not exist', async () => {
        const sessions = await scanCodexSessions();
        expect(sessions).toEqual([]);
    });
});

describe('scanOpenCodeSessions', () => {
    async function writeOpenCodeSession(fileName: string, value: unknown): Promise<void> {
        const dir = join(testDir, 'xdg', 'opencode', 'storage', 'session', 'proj');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, fileName), JSON.stringify(value));
    }

    it('parses flat-file session JSON', async () => {
        await writeOpenCodeSession('ses_abc123.json', {
            id: 'ses_abc123',
            title: 'Build a CLI tool',
            directory: '/Users/test/oc-proj',
            time: { created: 1717228800000, updated: 1717232400000 },
        });

        const sessions = await scanOpenCodeSessions();
        expect(sessions).toHaveLength(1);
        const session = sessions[0];
        expect(session.provider).toBe('opencode');
        expect(session.sessionId).toBe('ses_abc123');
        expect(session.title).toBe('Build a CLI tool');
        expect(session.projectDir).toBe('/Users/test/oc-proj');
        expect(session.createdAt).toBe(1717228800000);
        expect(session.lastActiveAt).toBe(1717232400000);
        expect(session.resumable).toBe(true);
    });

    it('derives title from directory basename when title is missing', async () => {
        await writeOpenCodeSession('ses_notitle.json', {
            id: 'ses_notitle',
            directory: '/Users/test/my-project',
            time: { created: 1717228800000 },
        });

        const sessions = await scanOpenCodeSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].title).toBe('my-project');
        expect(sessions[0].lastActiveAt).toBe(1717228800000);
    });

    it('skips corrupted or id-less session files', async () => {
        const dir = join(testDir, 'xdg', 'opencode', 'storage', 'session', 'proj');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'broken.json'), '{not json');
        await writeOpenCodeSession('ses_noid.json', { title: 'no id here' });

        const sessions = await scanOpenCodeSessions();
        expect(sessions).toEqual([]);
    });

    it('returns empty list when opencode data dir does not exist', async () => {
        const sessions = await scanOpenCodeSessions();
        expect(sessions).toEqual([]);
    });
});
