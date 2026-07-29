import { Modal } from '@/modal';
import { t } from '@/text';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import {
    machineSpawnNewSession,
    type ProviderSessionMeta,
} from '@/sync/ops';

export interface ResumeProviderSessionOptions {
    machineId: string;
    item: ProviderSessionMeta;
    /** Machine home directory, used to resolve manually entered relative paths. */
    homeDir?: string;
    navigateToSession: (sessionId: string) => void;
}

async function spawnResumedSession(
    options: ResumeProviderSessionOptions,
    directory: string,
    approvedNewDirectoryCreation: boolean,
): Promise<void> {
    const { machineId, item, navigateToSession } = options;
    const result = await machineSpawnNewSession({
        machineId,
        directory,
        approvedNewDirectoryCreation,
        agent: item.provider,
        resumeClaudeSessionId: item.provider === 'claude' ? item.sessionId : undefined,
        resumeCodexThreadId: item.provider === 'codex' ? item.sessionId : undefined,
        resumeOpenCodeSessionId: item.provider === 'opencode' ? item.sessionId : undefined,
        customTitle: item.title,
    });
    switch (result.type) {
        case 'success':
            navigateToSession(result.sessionId);
            break;
        case 'requestToApproveDirectoryCreation': {
            const approved = await Modal.confirm(
                'Create Directory?',
                `The directory '${result.directory}' does not exist. Would you like to create it?`,
                { cancelText: t('common.cancel'), confirmText: t('common.create') }
            );
            if (approved) {
                await spawnResumedSession(options, directory, true);
            }
            break;
        }
        case 'error':
            Modal.alert(t('common.error'), result.errorMessage);
            break;
    }
}

/**
 * Full "resume a provider session as a Happy session" flow shared by the
 * sessions list and the session detail screen: confirmation dialog,
 * missing-directory prompt, spawn (with directory-creation approval) and
 * error reporting. Callers only manage their own busy state.
 */
export async function resumeProviderSession(options: ResumeProviderSessionOptions): Promise<void> {
    const { item, homeDir } = options;
    if (!item.resumable) {
        Modal.alert(t('common.error'), t('providerSessions.notResumable'));
        return;
    }
    const displayTitle = item.title || item.summary || item.sessionId;
    const confirmed = await Modal.confirm(
        t('providerSessions.resumeTitle'),
        t('providerSessions.resumeMessage', { title: displayTitle }) + '\n\n' + t('providerSessions.resumeWarning'),
        { cancelText: t('common.cancel'), confirmText: t('providerSessions.resume') }
    );
    if (!confirmed) return;

    let directory = item.projectDir;
    if (!directory) {
        const entered = await Modal.prompt(
            t('providerSessions.missingDirectoryTitle'),
            t('providerSessions.missingDirectoryMessage'),
            { placeholder: '~/my-project', cancelText: t('common.cancel'), confirmText: t('providerSessions.resume') }
        );
        if (!entered || !entered.trim()) return;
        directory = resolveAbsolutePath(entered.trim(), homeDir);
    }

    try {
        await spawnResumedSession(options, directory, false);
    } catch (error) {
        Modal.alert(
            t('common.error'),
            error instanceof Error ? error.message : t('providerSessions.resumeFailed')
        );
    }
}
