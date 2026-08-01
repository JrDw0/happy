import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
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
    DEFAULT_PROVIDER_FILTER,
    DEFAULT_SORT_BY,
    DEFAULT_DATE_PRESET,
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

// Retry backoff for the provider-session RPC: failures retry forever with an
// exponentially growing delay (never surface load errors — just keep trying).
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 30_000;

// A unified row in the global history list. `happy` rows come from the local
// store; `provider` rows come from on-disk sessions on remote machines.
type HistoryRow =
    | { type: 'happy'; key: string; session: Session; machineId?: string }
    | { type: 'provider'; key: string; item: ProviderSessionMeta; machineId: string };

type ListRow =
    | { type: 'header'; key: string; groupKey: string; label: string; count: number; loading: boolean }
    | HistoryRow;

type MachineLoadState = 'loading' | 'loaded';

interface ProviderGroup {
    machineId: string;
    machineLabel: string;
    state: MachineLoadState;
    sessions: ProviderSessionMeta[];
}

function machineLabel(machine: { id: string; metadata: any }): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

function GlobalHistoryScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const allSessions = useAllSessions();
    const allMachines = useAllMachines({ includeOffline: true });

    // Controls state
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [providerFilter, setProviderFilter] = useState<ProviderFilter>(DEFAULT_PROVIDER_FILTER);
    const [sortBy, setSortBy] = useState<ProviderSessionSortBy>(DEFAULT_SORT_BY);
    const [datePreset, setDatePreset] = useState<DatePreset>(DEFAULT_DATE_PRESET);

    // Provider sessions fanned out across machines. Keyed by machineId.
    const [providerGroups, setProviderGroups] = useState<Record<string, ProviderGroup>>({});
    // Bump on every fan-out so we can discard stale responses.
    const requestSeq = useRef(0);
    // Manual pull-to-refresh trigger.
    const [refreshNonce, setRefreshNonce] = useState(0);

    // Collapsed per group ('happy' | machineId). Not persisted — sections
    // start expanded and searching temporarily forces everything open.
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const toggleGroup = useCallback((groupKey: string) => {
        setCollapsed((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
    }, []);

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

    // Fan out to every supported machine whenever filters change. Each machine
    // loads independently with retry-and-backoff so one slow machine doesn't
    // stall the others, and failures retry silently instead of showing errors.
    useEffect(() => {
        if (supportedMachines.length === 0) {
            setProviderGroups({});
            return;
        }
        const seq = ++requestSeq.current;
        const providers = providerFilter === 'all' ? undefined : [providerFilter];
        const dateFrom = datePresetToFrom(datePreset);
        const q = debouncedQuery.trim() || undefined;

        // Mark every supported machine as loading up front, keeping the
        // previously loaded rows visible under the header spinner.
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
        const isStale = () => cancelled || seq !== requestSeq.current;
        const timers = new Set<ReturnType<typeof setTimeout>>();
        const sleep = (ms: number) => new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                timers.delete(timer);
                resolve();
            }, ms);
            timers.add(timer);
        });

        const loadMachine = async (m: (typeof supportedMachines)[number]) => {
            let attempt = 0;
            while (!isStale()) {
                const result = await machineListProviderSessions(m.id, {
                    providers,
                    query: q,
                    sortBy,
                    dateFrom,
                    limit: PER_MACHINE_LIMIT,
                    offset: 0,
                });
                if (isStale()) return;
                if (result.type === 'success') {
                    const label = machineLabel(m);
                    setProviderGroups((prev) => ({
                        ...prev,
                        [m.id]: { machineId: m.id, machineLabel: label, state: 'loaded', sessions: result.sessions },
                    }));
                    return;
                }
                attempt += 1;
                await sleep(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS));
            }
        };

        for (const m of supportedMachines) {
            void loadMachine(m);
        }
        return () => {
            cancelled = true;
            for (const timer of timers) clearTimeout(timer);
        };
    }, [supportedMachines, providerFilter, debouncedQuery, sortBy, datePreset, refreshNonce]);

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

    // Build the unified, filtered, sorted list of rows with collapsible groups.
    // Searching collapses nothing — all groups force-expand so matches surface.
    const rows = useMemo<ListRow[]>(() => {
        const out: ListRow[] = [];
        const q = debouncedQuery.trim().toLocaleLowerCase();
        const searching = q.length > 0;
        const matchesQuery = (text?: string) => !q || (text?.toLocaleLowerCase().includes(q) ?? false);
        // Rows that exist regardless of collapse state — collapsing everything
        // must not look like an empty history.
        let hasSessionRows = false;

        // --- Happy sessions (local, instant) ---
        const happyRows: HistoryRow[] = [];
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
        happyRows.sort((a, b) => {
            const sa = (a as Extract<HistoryRow, { type: 'happy' }>).session;
            const sb = (b as Extract<HistoryRow, { type: 'happy' }>).session;
            switch (sortBy) {
                case 'createdAt':
                    return sb.createdAt - sa.createdAt;
                case 'projectDir':
                    return (sa.metadata?.path ?? '').localeCompare(sb.metadata?.path ?? '');
                case 'lastActiveAt':
                default:
                    return sb.updatedAt - sa.updatedAt;
            }
        });
        if (happyRows.length > 0) {
            hasSessionRows = true;
            out.push({
                type: 'header',
                key: 'header:happy',
                groupKey: 'happy',
                label: t('history.happySessions'),
                count: happyRows.length,
                loading: false,
            });
            if (searching || !collapsed['happy']) {
                for (const row of happyRows) out.push(row);
            }
        }

        // --- Provider sessions grouped by machine ---
        for (const m of supportedMachines) {
            const group = providerGroups[m.id];
            if (!group) continue;

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

            if (sessions.length > 0) hasSessionRows = true;
            out.push({
                type: 'header',
                key: `header:${m.id}`,
                groupKey: m.id,
                label: group.machineLabel,
                count: sessions.length,
                loading: group.state === 'loading',
            });
            if (searching || !collapsed[m.id]) {
                for (const item of sessions) {
                    out.push({
                        type: 'provider',
                        key: `provider:${m.id}:${item.provider}:${item.sessionId}`,
                        item,
                        machineId: m.id,
                    });
                }
            }
        }

        // When there's genuinely nothing anywhere (no matches, no sessions)
        // and nothing is still loading, strip the bare group headers so
        // FlatList renders the proper empty state. Collapsed groups keep
        // their headers — they still have sessions, just hidden.
        const anyLoading = supportedMachines.some((m) => providerGroups[m.id]?.state === 'loading');
        if (!hasSessionRows && !anyLoading) return [];

        return out;
    }, [allSessions, supportedMachines, providerGroups, providerFilter, debouncedQuery, sortBy, collapsed]);

    const controlsOnChange = useCallback((next: Partial<ProviderSessionControlsState>) => {
        if (next.query !== undefined) setQuery(next.query);
        if (next.providerFilter !== undefined) setProviderFilter(next.providerFilter);
        if (next.sortBy !== undefined) setSortBy(next.sortBy);
        if (next.datePreset !== undefined) setDatePreset(next.datePreset);
    }, []);

    const renderRow = useCallback(({ item: row }: { item: ListRow }) => {
        if (row.type === 'header') {
            const isCollapsed = !debouncedQuery.trim() && collapsed[row.groupKey];
            return (
                <Pressable style={styles.groupHeader} onPress={() => toggleGroup(row.groupKey)}>
                    <Ionicons
                        name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
                        size={13}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={[Typography.default('semiBold'), styles.groupHeaderLabel, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {row.label}
                    </Text>
                    {row.loading ? (
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    ) : (
                        <View style={[styles.countPill, { backgroundColor: theme.colors.glass.backgroundSubtle }]}>
                            <Text style={[Typography.default(), styles.countPillText, { color: theme.colors.textSecondary }]}>
                                {row.count}
                            </Text>
                        </View>
                    )}
                </Pressable>
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
    }, [activeHappySessions, allMachines, theme, navigateToSession, handleProviderPress, collapsed, debouncedQuery, toggleGroup]);

    const keyExtractor = useCallback((row: ListRow) => row.key, []);

    const anyLoading = supportedMachines.some((m) => providerGroups[m.id]?.state === 'loading');

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
                    refreshControl={
                        <RefreshControl
                            refreshing={anyLoading && refreshNonce > 0}
                            onRefresh={() => setRefreshNonce((n) => n + 1)}
                            tintColor={theme.colors.textSecondary}
                        />
                    }
                    ListEmptyComponent={!anyLoading ? (
                        <View style={styles.centerState}>
                            <Ionicons name="file-tray-outline" size={36} color={theme.colors.textSecondary} />
                            <Text style={[Typography.default(), { fontSize: 15, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
                                {t('history.empty')}
                            </Text>
                        </View>
                    ) : null}
                />
            </View>
        </>
    );
}

export default React.memo(GlobalHistoryScreen);

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
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 6,
    },
    groupHeaderLabel: {
        flex: 1,
        fontSize: 13,
    },
    countPill: {
        minWidth: 22,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 9,
        alignItems: 'center',
    },
    countPillText: {
        fontSize: 11,
    },
    activeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: '#34C75922',
    },
}));
