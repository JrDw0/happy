import { describe, expect, it } from 'vitest';
import { KNOWN_ACP_AGENTS, parseAcpCliFlags, resolveAcpAgentConfig } from './acpAgentConfig';

describe('KNOWN_ACP_AGENTS', () => {
  it('defines built-in Gemini and OpenCode command mappings', () => {
    expect(KNOWN_ACP_AGENTS).toEqual({
      gemini: { command: 'gemini', args: ['--experimental-acp'] },
      opencode: { command: 'opencode', args: ['acp'] },
    });
  });
});

describe('resolveAcpAgentConfig', () => {
  it('resolves known agent names to predefined command + args', () => {
    expect(resolveAcpAgentConfig(['gemini'])).toEqual({
      agentName: 'gemini',
      command: 'gemini',
      args: ['--experimental-acp'],
    });
  });

  it('appends extra CLI args for known agent aliases', () => {
    expect(resolveAcpAgentConfig(['opencode', '--foo'])).toEqual({
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp', '--foo'],
    });
  });

  it('strips legacy --acp for opencode compatibility', () => {
    expect(resolveAcpAgentConfig(['opencode', '--acp', '--foo'])).toEqual({
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp', '--foo'],
    });
  });

  it('resolves custom command form with -- separator', () => {
    expect(resolveAcpAgentConfig(['--', 'custom-agent', '--flag'])).toEqual({
      agentName: 'custom-agent',
      command: 'custom-agent',
      args: ['--flag'],
    });
  });

  it('treats unknown agent names as direct commands', () => {
    expect(resolveAcpAgentConfig(['my-agent', '--x'])).toEqual({
      agentName: 'my-agent',
      command: 'my-agent',
      args: ['--x'],
    });
  });

  it('throws with helpful usage when no args are provided', () => {
    expect(() => resolveAcpAgentConfig([])).toThrow('Usage: happy acp <agent-name> or happy acp -- <command> [args]');
  });

  it('throws when separator form omits command', () => {
    expect(() => resolveAcpAgentConfig(['--'])).toThrow('Missing command after "--". Usage: happy acp -- <command> [args]');
  });
});

describe('parseAcpCliFlags', () => {
  it('returns defaults for a plain agent invocation', () => {
    expect(parseAcpCliFlags(['opencode'])).toEqual({
      startedBy: undefined,
      verbose: false,
      resumeSessionId: undefined,
      acpArgs: ['opencode'],
    });
  });

  it('strips --started-by, --verbose, and --resume from acp args', () => {
    expect(parseAcpCliFlags(['opencode', '--started-by', 'daemon', '--verbose', '--resume', 'ses_abc123'])).toEqual({
      startedBy: 'daemon',
      verbose: true,
      resumeSessionId: 'ses_abc123',
      acpArgs: ['opencode'],
    });
  });

  it('handles --resume before the agent name', () => {
    expect(parseAcpCliFlags(['--resume', 'ses_abc123', 'opencode'])).toEqual({
      startedBy: undefined,
      verbose: false,
      resumeSessionId: 'ses_abc123',
      acpArgs: ['opencode'],
    });
  });

  it('passes happy flags through untouched after the -- separator', () => {
    expect(parseAcpCliFlags(['--', 'custom-agent', '--resume', 'x', '--verbose'])).toEqual({
      startedBy: undefined,
      verbose: false,
      resumeSessionId: undefined,
      acpArgs: ['--', 'custom-agent', '--resume', 'x', '--verbose'],
    });
  });

  it('strips happy flags before -- but not after', () => {
    expect(parseAcpCliFlags(['--resume', 'ses_1', '--', 'custom-agent', '--resume', 'other'])).toEqual({
      startedBy: undefined,
      verbose: false,
      resumeSessionId: 'ses_1',
      acpArgs: ['--', 'custom-agent', '--resume', 'other'],
    });
  });
});
