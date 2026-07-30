import * as React from 'react';
import { SessionListViewItem, useSessionListViewData, useSetting } from '@/sync/storage';

export function useVisibleSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();
    const hideInactiveSessions = useSetting('hideInactiveSessions');

    return React.useMemo(() => {
        if (!data) {
            return data;
        }

        const result: SessionListViewItem[] = [];
        let hasArchived = false;
        // Offline (recoverable) sessions stay in the main list; only truly
        // archived sessions go behind the archive toggle fold.
        let currentSection: 'offline' | 'archived' | null = null;
        let pendingProjectGroup: SessionListViewItem | null = null;

        for (const item of data) {
            if (item.type === 'active-sessions') {
                result.push(item);
                continue;
            }

            if (item.type === 'header') {
                currentSection = item.section ?? 'archived';
                pendingProjectGroup = null;
                if (currentSection === 'offline') {
                    result.push(item);
                }
                continue;
            }

            if (item.type === 'project-group') {
                pendingProjectGroup = item;
                continue;
            }

            if (item.type === 'session' && !item.session.active) {
                const isArchived = item.session.archived || currentSection === 'archived';
                if (isArchived) {
                    hasArchived = true;
                } else {
                    if (pendingProjectGroup) {
                        result.push(pendingProjectGroup);
                        pendingProjectGroup = null;
                    }
                    result.push(item);
                }
            }
        }

        // Insert archive toggle if there are archived sessions
        if (hasArchived) {
            result.push({ type: 'archive-toggle', hidden: hideInactiveSessions });
        }

        // If not hiding, append archived headers and sessions after the toggle
        if (hasArchived && !hideInactiveSessions) {
            currentSection = null;
            pendingProjectGroup = null;

            for (const item of data) {
                if (item.type === 'active-sessions') {
                    continue;
                }

                if (item.type === 'header') {
                    currentSection = item.section ?? 'archived';
                    pendingProjectGroup = null;
                    if (currentSection === 'archived') {
                        result.push(item);
                    }
                    continue;
                }

                if (item.type === 'project-group') {
                    pendingProjectGroup = item;
                    continue;
                }

                if (item.type === 'session' && !item.session.active) {
                    const isArchived = item.session.archived || currentSection === 'archived';
                    if (isArchived) {
                        if (pendingProjectGroup) {
                            result.push(pendingProjectGroup);
                            pendingProjectGroup = null;
                        }
                        result.push(item);
                    }
                }
            }
        }

        return result;
    }, [data, hideInactiveSessions]);
}
