import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { Typography } from '@/constants/Typography';
import { useAllSessions, useAllMachines } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import {
    machineListProviderSessions,
    type ProviderSessionMeta,
    type ProviderSessionProvider,
    type ProviderSessionSortBy,
} from '@/sync/ops';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { ProviderIcon } from '@/components/ProviderIcon';
import {
    ProviderSessionControls,
    datePresetToFrom,
    type ProviderFilter,
    type DatePreset,
    type ProviderSessionControlsState,
} from '@/components/ProviderSessionControls';
import { formatPathRelativeToHome, formatLastSeen, getSessionName, getSessionSubtitle, getSessionAvatarId } from '@/utils/sessionUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import { Avatar } from '@/components/Avatar';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

// Per-machine page size when fanning out the provider-session RPC. We only
// surface the first page per machine here — full pagination lives on the
// per-machine screen. Keeping this modest bounds the fan-out cost.
const PER_MACHINE_LIMIT = 50;

// A unified row in the global history list. `happy` rows come from the local
// store; `provider` rows come from on-disk sessions on remote machines.
type HistoryRow =
    | { type: 'happy'; key: string; session: Session; machineId?: string }
    | { type: 'provider'; key: string; item: ProviderSessionMeta; machineId: string };

type ListRow =
    | { type: 'header'; key: string; label: string }
    | HistoryRow;

type MachineLoadState = 'loading' | 'loaded' | 'error' | 'unsupported';

interface ProviderGroup {
    machineId: string;
    machineLabel: string;
    state: MachineLoadState;
    sessions: ProviderSessionMeta[];
    errorMessage?: string;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    centerState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 48,
    },
    groupHeader: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 6,
    },
    groupHeaderSubtitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    activeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: '#34C75922',
    },
    machineStateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
    },
    machineStateText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));

function machineLabel(machine: { id: string; metadata: any }): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

export default function GlobalHistoryScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const allSessions = useAllSessions();
    const allMachines = useAllMachines({ includeOffline: true });

    // Controls state
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
    const [sortBy, setSortBy] = useState<ProviderSessionSortBy>('lastActiveAt');
    const [datePreset, setDatePreset] = useState<DatePreset>('all');

    // Provider sessions fanned out across machines. Keyed by machineId.
    const [providerGroups, setProviderGroups] = useState<Record<string, ProviderGroup>>({});
    // Bump on every fan-out so we can discard stale responses.
    const requestSeq = useRef(0);

    // Happy sessions that are already tracked, keyed by `provider:sessionId`,
    // so provider rows can badge + jump straight to the existing session.
    const activeHappySessions = useMemo(() => {
        const map = new Map<string, string>();
        if (!allSessions) return map;
        for (const session of allSessions) {
            if (session.metadata?.claudeSessionId) {
                map.set(`claude:${session.metadata.claudeSessionId}`, session.id);
            }
            if (session.metadata?.codexThreadId) {
                map.set(`codex:${session.metadata.codexThreadId}`, session.id);
            }
        }
        return map;
    }, [allSessions]);

    // Machines that can serve the provider-session RPC right now.
    const supportedMachines = useMemo(() => {
        return allMachines.filter(
            (m) => isMachineOnline(m) && m.metadata?.sessionHistorySupport === true,
        );
    }, [allMachines]);

    // Debounce the search query before fanning out.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(timer);
    }, [query]);

    // Fan out to every supported machine whenever filters change.
    useEffect(() => {
        if (supportedMachines.length === 0) {
            setProviderGroups({});
            return;
        }
        const seq = ++requestSeq.current;
        const providers = providerFilter === 'all' ? undefined : [providerFilter];
        const dateFrom = datePresetToFrom(datePreset);
        const q = debouncedQuery.trim() || undefined;

        // Mark every supported machine as loading up front.
        setProviderGroups((prev) => {
            const next: Record<string, ProviderGroup> = {};
            for (const m of supportedMachines) {
                next[m.id] = {
                    machineId: m.id,
                    machineLabel: machineLabel(m),
                    state: 'loading',
                    sessions: prev[m.id]?.sessions ?? [],
                };
            }
            return next;
        });

        let cancelled = false;
        (async () => {
            const results = await Promise.all(
                supportedMachines.map(async (m) => {
                    const result = await machineListProviderSessions(m.id, {
                        providers,
                        query: q,
                        sortBy,
                        dateFrom,
                        limit: PER_MACHINE_LIMIT,
                        offset: 0,
                    });
                    return { machineId: m.id, machineLabel: machineLabel(m), result };
                }),
            );
            if (cancelled || seq !== requestSeq.current) return;
            setProviderGroups(() => {
                const next: Record<string, ProviderGroup> = {};
                for (const { machineId, machineLabel: label, result } of results) {
                    if (result.type === 'success') {
                        next[machineId] = {
                            machineId,
                            machineLabel: label,
                            state: 'loaded',
                            sessions: result.sessions,
                        };
                    } else {
                        next[machineId] = {
                            machineId,
                            machineLabel: label,
                            state: 'error',
                            sessions: [],
                            errorMessage: result.errorMessage,
                        };
                    }
                }
                return next;
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [supportedMachines, providerFilter, debouncedQuery, sortBy, datePreset]);

    const handleProviderPress = useCallback((machineId: string, item: ProviderSessionMeta) => {
        const activeSessionId = activeHappySessions.get(`${item.provider}:${item.sessionId}`);
        if (activeSessionId) {
            navigateToSession(activeSessionId);
            return;
        }
        router.push({
            pathname: `/machine/${machineId}/session/${encodeURIComponent(item.sessionId)}` as any,
            params: {
                provider: item.provider,
                title: item.title ?? '',
                summary: item.summary ?? '',
                projectDir: item.projectDir ?? '',
                createdAt: item.createdAt != null ? String(item.createdAt) : '',
                lastActiveAt: item.lastActiveAt != null ? String(item.lastActiveAt) : '',
                resumable: item.resumable ? '1' : '0',
            },
        });
    }, [activeHappySessions, navigateToSession, router]);

    // Build the unified, filtered, sorted list of rows.
    const rows = useMemo<ListRow[]>(() => {
        const out: ListRow[] = [];
        const q = debouncedQuery.trim().toLocaleLowerCase();
        const matchesQuery = (text?: string) => !q || (text?.toLocaleLowerCase().includes(q) ?? false);

        // --- Happy sessions (local, instant) ---
        const happyRows: Array<{ type: 'happy'; key: string; session: Session; machineId?: string }> = [];
        if (allSessions) {
            for (const session of allSessions) {
                const provider: ProviderSessionProvider | undefined =
                    session.metadata?.claudeSessionId ? 'claude'
                        : session.metadata?.codexThreadId ? 'codex'
                            : undefined;
                if (providerFilter !== 'all' && provider !== providerFilter) continue;
                if (!matchesQuery(getSessionName(session)) && !matchesQuery(getSessionSubtitle(session))) continue;
                happyRows.push({
                    type: 'happy',
                    key: `happy:${session.id}`,
                    session,
                    machineId: session.metadata?.machineId,
                });
            }
        }
        // Happy sessions sort by updatedAt (most recent first).
        happyRows.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
        if (happyRows.length > 0) {
            out.push({ type: 'header', key: 'header:happy', label: t('history.happySessions') });
            for (const row of happyRows) out.push(row);
        }

        // --- Provider sessions grouped by machine ---
        for (const m of supportedMachines) {
            const group = providerGroups[m.id];
            if (!group) continue;
            // Always show a header per machine so the user sees which machines
            // were queried, even when a group is loading/empty/error.
            out.push({
                type: 'header',
                key: `header:${m.id}`,
                label: group.machineLabel,
            });

            if (group.state === 'loading') {
                out.push({
                    type: 'header',
                    key: `state:${m.id}`,
                    label: t('common.loading'),
                });
                continue;
            }
            if (group.state === 'error') {
                out.push({
                    type: 'header',
                    key: `state:${m.id}`,
                    label: group.errorMessage || t('providerSessions.loadFailed'),
                });
                continue;
            }

            let sessions = group.sessions;
            if (providerFilter !== 'all') {
                sessions = sessions.filter((s) => s.provider === providerFilter);
            }
            // Client-side query filter (the RPC already filters, but the
            // debounced value may lag the local one).
            if (q) {
                sessions = sessions.filter((s) =>
                    matchesQuery(s.title) || matchesQuery(s.summary) || matchesQuery(s.projectDir),
                );
            }
            // Sort client-side to honor the chosen key uniformly across machines.
            sessions = sessions.slice().sort((a, b) => {
                switch (sortBy) {
                    case 'createdAt':
                        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
                    case 'projectDir':
                        return (a.projectDir ?? '').localeCompare(b.projectDir ?? '');
                    case 'lastActiveAt':
                    default:
                        return (b.lastActiveAt ?? b.createdAt ?? 0) - (a.lastActiveAt ?? a.createdAt ?? 0);
                }
            });

            for (const item of sessions) {
                out.push({
                    type: 'provider',
                    key: `provider:${m.id}:${item.provider}:${item.sessionId}`,
                    item,
                    machineId: m.id,
                });
            }
        }

        return out;
    }, [allSessions, supportedMachines, providerGroups, providerFilter, debouncedQuery, sortBy]);

    const controlsOnChange = useCallback((next: Partial<ProviderSessionControlsState>) => {
        if (next.query !== undefined) setQuery(next.query);
        if (next.providerFilter !== undefined) setProviderFilter(next.providerFilter);
        if (next.sortBy !== undefined) setSortBy(next.sortBy);
        if (next.datePreset !== undefined) setDatePreset(next.datePreset);
    }, []);

    const renderRow = useCallback(({ item: row }: { item: ListRow }) => {
        if (row.type === 'header') {
            return (
                <View style={styles.groupHeader}>
                    <Text style={[Typography.default('semiBold'), { fontSize: 13, color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {row.label}
                    </Text>
                </View>
            );
        }
        if (row.type === 'happy') {
            const session = row.session;
            return (
                <Item
                    title={getSessionName(session)}
                    subtitle={getSessionSubtitle(session)}
                    subtitleLines={2}
                    leftElement={<Avatar id={getSessionAvatarId(session)} size={36} />}
                    onPress={() => navigateToSession(session.id)}
                    showChevron={false}
                />
            );
        }
        // provider row
        const item = row.item;
        const activeSessionId = activeHappySessions.get(`${item.provider}:${item.sessionId}`);
        const machine = allMachines.find((m) => m.id === row.machineId);
        const homeDir = machine?.metadata?.homeDir;
        const displayTitle = item.title || item.summary || item.sessionId;
        const pathDisplay = item.projectDir
            ? formatPathRelativeToHome(item.projectDir, homeDir)
            : undefined;
        const timestamp = item.lastActiveAt ?? item.createdAt;
        const timeDisplay = timestamp ? formatLastSeen(timestamp, false) : undefined;
        const subtitleParts = [pathDisplay, timeDisplay].filter(Boolean);
        return (
            <Item
                title={displayTitle}
                subtitle={subtitleParts.join('\n') || undefined}
                subtitleLines={2}
                leftElement={<ProviderIcon kind={item.provider} size={20} />}
                rightElement={activeSessionId ? (
                    <View style={styles.activeBadge}>
                        <Text style={[Typography.default(), { fontSize: 11, color: '#34C759' }]}>
                            {t('providerSessions.activeInHappy')}
                        </Text>
                    </View>
                ) : undefined}
                onPress={() => handleProviderPress(row.machineId, item)}
                showChevron={false}
            />
        );
    }, [activeHappySessions, allMachines, theme, navigateToSession, handleProviderPress]);

    const keyExtractor = useCallback((row: ListRow) => row.key, []);

    // Empty state: only when everything has settled and there's nothing.
    const anyLoading = Object.values(providerGroups).some((g) => g.state === 'loading');
    const isEmpty = rows.length === 0 && !anyLoading;

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: t('history.title'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <View style={styles.container}>
                <ProviderSessionControls
                    query={query}
                    providerFilter={providerFilter}
                    sortBy={sortBy}
                    datePreset={datePreset}
                    onChange={controlsOnChange}
                />
                <FlatList
                    data={rows}
                    keyExtractor={keyExtractor}
                    renderItem={renderRow}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={isEmpty ? (
                        <View style={styles.centerState}>
                            <Ionicons name="file-tray-outline" size={36} color={theme.colors.textSecondary} />
                            <Text style={[Typography.default(), { fontSize: 15, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
                                {t('history.empty')}
                            </Text>
                        </View>
                    ) : null}
                    ListFooterComponent={anyLoading ? (
                        <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        </View>
                    ) : null}
                />
            </View>
        </>
    );
}
