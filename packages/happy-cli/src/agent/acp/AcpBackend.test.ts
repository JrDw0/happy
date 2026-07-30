import { describe, expect, it } from 'vitest';

import { AcpBackend } from './AcpBackend';
import type { AgentMessage } from '@/agent/core';

/**
 * Unit tests for the session/load replay suppression. The ACP spec replays
 * the whole conversation as session/update notifications while a
 * `session/load` request is in flight; AcpBackend must drop those
 * message-shaped updates (the resume backfill pushes the history from local
 * storage instead) while still letting config/mode updates through.
 *
 * The backend is exercised without spawning a process: the constructor is
 * side-effect free, so we drive the private handleSessionUpdate directly.
 */

function createBackend(): { backend: AcpBackend; messages: AgentMessage[] } {
    const backend = new AcpBackend({
        agentName: 'opencode',
        cwd: '/tmp',
        command: 'opencode',
        args: ['acp'],
    });
    const messages: AgentMessage[] = [];
    backend.onMessage((message) => messages.push(message));
    return { backend, messages };
}

function dispatchUpdate(backend: AcpBackend, update: Record<string, unknown>): void {
    (backend as any).handleSessionUpdate({ sessionId: 'acp-session-1', update });
}

describe('AcpBackend session/load replay suppression', () => {
    it('drops message-shaped updates while suppressingReplay is set', () => {
        const { backend, messages } = createBackend();
        (backend as any).suppressingReplay = true;

        dispatchUpdate(backend, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'replayed answer' } });
        dispatchUpdate(backend, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'replayed thought' } });
        dispatchUpdate(backend, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'replayed question' } });
        dispatchUpdate(backend, { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Read', status: 'pending' });
        dispatchUpdate(backend, { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed' });

        expect(messages).toEqual([]);
    });

    it('still forwards config and mode updates during replay suppression', () => {
        const { backend, messages } = createBackend();
        (backend as any).suppressingReplay = true;

        dispatchUpdate(backend, { sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
        dispatchUpdate(backend, {
            sessionUpdate: 'config_options_update',
            configOptions: [{ type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: 'a', options: [] }],
        });

        expect(messages.map((m) => (m as any).name)).toEqual(['current_mode_update', 'config_options_update']);
    });

    it('emits message chunks normally once suppression is cleared', () => {
        const { backend, messages } = createBackend();
        (backend as any).suppressingReplay = false;

        dispatchUpdate(backend, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'live answer' } });

        expect(messages).toEqual([
            { type: 'model-output', textDelta: 'live answer' },
        ]);
    });
});
