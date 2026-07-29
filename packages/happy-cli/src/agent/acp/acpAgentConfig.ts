export type AcpAgentConfig = {
  command: string;
  args: string[];
};

export const KNOWN_ACP_AGENTS: Record<string, AcpAgentConfig> = {
  gemini: { command: 'gemini', args: ['--experimental-acp'] },
  opencode: { command: 'opencode', args: ['acp'] },
};

export type ResolvedAcpAgentConfig = {
  agentName: string;
  command: string;
  args: string[];
};

export type ParsedAcpCliFlags = {
  startedBy?: 'daemon' | 'terminal';
  verbose: boolean;
  resumeSessionId?: string;
  /** Remaining args to feed into resolveAcpAgentConfig */
  acpArgs: string[];
};

/**
 * Strip happy-specific flags (--started-by, --verbose, --resume) from the
 * `happy acp` argument list. Flags after a `--` separator are passed through
 * untouched so custom agent commands keep their own flags.
 */
export function parseAcpCliFlags(args: string[]): ParsedAcpCliFlags {
  let startedBy: 'daemon' | 'terminal' | undefined = undefined;
  let verbose = false;
  let resumeSessionId: string | undefined = undefined;
  const acpArgs: string[] = [];
  let customCommandMode = false;
  for (let i = 0; i < args.length; i++) {
    if (!customCommandMode && args[i] === '--started-by') {
      startedBy = args[++i] as 'daemon' | 'terminal';
      continue;
    }
    if (!customCommandMode && args[i] === '--verbose') {
      verbose = true;
      continue;
    }
    if (!customCommandMode && args[i] === '--resume') {
      resumeSessionId = args[++i];
      continue;
    }
    if (args[i] === '--') {
      customCommandMode = true;
    }
    acpArgs.push(args[i]);
  }
  return { startedBy, verbose, resumeSessionId, acpArgs };
}

export function resolveAcpAgentConfig(cliArgs: string[]): ResolvedAcpAgentConfig {
  if (cliArgs.length === 0) {
    throw new Error('Usage: happy acp <agent-name> or happy acp -- <command> [args]');
  }

  if (cliArgs[0] === '--') {
    const command = cliArgs[1];
    if (!command) {
      throw new Error('Missing command after "--". Usage: happy acp -- <command> [args]');
    }
    return {
      agentName: command,
      command,
      args: cliArgs.slice(2),
    };
  }

  const agentName = cliArgs[0];
  const known = KNOWN_ACP_AGENTS[agentName];
  if (known) {
    const passthroughArgs = cliArgs
      .slice(1)
      // Backward-compatible with old OpenCode docs/flags.
      .filter((arg) => !(agentName === 'opencode' && arg === '--acp'));
    return {
      agentName,
      command: known.command,
      args: [...known.args, ...passthroughArgs],
    };
  }

  return {
    agentName,
    command: agentName,
    args: cliArgs.slice(1),
  };
}
