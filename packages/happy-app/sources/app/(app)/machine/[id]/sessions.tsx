import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, FlatList, ActivityIndicator, Pressable, Platform } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { Typography } from '@/constants/Typography';
import { useSessions, useMachine } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import {
    machineListProviderSessions,
    type ProviderSessionMeta,
    type ProviderSessionProvider,
    type ProviderSessionSortBy,
} from '@/sync/ops';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { formatPathRelativeToHome, formatLastSeen } from '@/utils/sessionUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';

const PAGE_SIZE = 100;

type ProviderFilter = 'all' | ProviderSessionProvider;

const PROVIDER_FILTERS: { key: ProviderFilter; label: string }[] = [
    { key: 'all', label: '' /* resolved via t() at render time */ },
    { key: 'claude', label: 'Claude' },
    { key: 'codex', label: 'Codex' },
    { key: 'opencode', label: 'OpenCode' },
];

const SORT_OPTIONS: ProviderSessionSortBy[] = ['lastActiveAt', 'createdAt', 'projectDir'];

type DatePreset = 'all' | 'today' | '7d' | '30d' | '90d';

const DATE_PRESETS: { key: DatePreset; days?: number }[] = [
    { key: 'all' },
    { key: 'today' },
    { key: '7d', days: 7 },
    { key: '30d', days: 30 },
    { key: '90d', days: 90 },
];

function sortLabel(sortBy: ProviderSessionSortBy): string {
    switch (sortBy) {
        case 'lastActiveAt': return t('providerSessions.sortRecent');
        case 'createdAt': return t('providerSessions.sortCreated');
        case 'projectDir': return t('providerSessions.sortProject');
    }
}

function datePresetLabel(preset: DatePreset): string {
    switch (preset) {
        case 'all': return t('providerSessions.dateAll');
        case 'today': return t('providerSessions.dateToday');
        case '7d': return t('providerSessions.date7Days');
        case '30d': return t('providerSessions.date30Days');
        case '90d': return t('providerSessions.date90Days');
    }
}

// FlatList rows: plain session entries, plus project group headers when sorting by project
type ListRow =
    | { type: 'header'; key: string; label: string }
    | { type: 'session'; key: string; item: ProviderSessionMeta };

const PROVIDER_ICONS: Record<ProviderSessionProvider, keyof typeof Ionicons.glyphMap> = {
    claude: 'sparkles-outline',
    codex: 'code-slash-outline',
    opencode: 'terminal-outline',
};

const styles = StyleSheet.create((theme) => ({
    searchContainer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    searchInput: {
        borderRadius: 8,
        backgroundColor: Platform.select({
            web: theme.colors.input?.background ?? theme.colors.groupped.background,
            default: theme.colors.glass.backgroundSubtle,
        }),
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 12,
        paddingVertical: Platform.select({ web: 10, ios: 10, default: 8 }) as any,
        fontSize: 15,
        color: theme.colors.text,
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    chipSelected: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    centerState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 48,
    },
    activeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: '#34C75922',
    },
    groupHeader: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 6,
    },
}));

export default function MachineProviderSessionsScreen() {
    const { theme } = useUnistyles();
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const machine = useMachine(machineId!);
    const sessions = useSessions();
    const navigateToSession = useNavigateToSession();
    const router = useRouter();

    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
    const [sortBy, setSortBy] = useState<ProviderSessionSortBy>('lastActiveAt');
    const [datePreset, setDatePreset] = useState<DatePreset>('all');
    const [items, setItems] = useState<ProviderSessionMeta[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const requestSeq = useRef(0);

    const supported = machine?.metadata?.sessionHistorySupport === true;
    const online = machine ? isMachineOnline(machine) : false;

    // Debounce the search query before hitting the daemon RPC
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(timer);
    }, [query]);

    // Map provider session ids already tracked by Happy → happy session id,
    // so we can badge them and jump straight to the existing session.
    const activeHappySessions = useMemo(() => {
        const map = new Map<string, string>();
        if (!sessions) return map;
        for (const entry of sessions) {
            if (typeof entry === 'string') continue;
            const session = entry as Session;
            if (session.metadata?.claudeSessionId) {
                map.set(`claude:${session.metadata.claudeSessionId}`, session.id);
            }
            if (session.metadata?.codexThreadId) {
                map.set(`codex:${session.metadata.codexThreadId}`, session.id);
            }
        }
        return map;
    }, [sessions]);

    const load = useCallback(async (offset: number, append: boolean) => {
        if (!machineId || !supported || !online) {
            setIsLoading(false);
            return;
        }
        const seq = ++requestSeq.current;
        if (append) {
            setIsLoadingMore(true);
        } else {
            setIsLoading(true);
        }
        // Translate the date preset into a lower bound computed on the client clock
        let dateFrom: number | undefined;
        const preset = DATE_PRESETS.find(p => p.key === datePreset);
        if (preset && preset.key !== 'all') {
            if (preset.key === 'today') {
                const startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);
                dateFrom = startOfDay.getTime();
            } else if (preset.days) {
                dateFrom = Date.now() - preset.days * 24 * 60 * 60 * 1000;
            }
        }
        const result = await machineListProviderSessions(machineId, {
            providers: providerFilter === 'all' ? undefined : [providerFilter],
            query: debouncedQuery.trim() || undefined,
            sortBy,
            dateFrom,
            limit: PAGE_SIZE,
            offset,
        });
        // Stale response guard - a newer request has been issued meanwhile
        if (seq !== requestSeq.current) return;
        if (result.type === 'success') {
            setItems(prev => append ? [...prev, ...result.sessions] : result.sessions);
            setHasMore(result.hasMore);
            setErrorMessage(null);
        } else {
            setErrorMessage(result.errorMessage);
            if (!append) {
                setItems([]);
                setHasMore(false);
            }
        }
        setIsLoading(false);
        setIsLoadingMore(false);
    }, [machineId, supported, online, providerFilter, debouncedQuery, sortBy, datePreset]);

    useEffect(() => {
        load(0, false);
    }, [load]);

    const handleLoadMore = useCallback(() => {
        if (!hasMore || isLoading || isLoadingMore) return;
        load(items.length, true);
    }, [hasMore, isLoading, isLoadingMore, items.length, load]);

    const handleItemPress = useCallback((item: ProviderSessionMeta) => {
        // Already tracked by Happy - jump straight to the existing session
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
    }, [activeHappySessions, navigateToSession, router, machineId]);

    // Insert project group headers when sorting by project directory
    const rows = useMemo<ListRow[]>(() => {
        const result: ListRow[] = [];
        let lastGroup: string | null = null;
        for (const item of items) {
            if (sortBy === 'projectDir') {
                const group = item.projectDir
                    ? formatPathRelativeToHome(item.projectDir, machine?.metadata?.homeDir)
                    : '—';
                if (group !== lastGroup) {
                    result.push({ type: 'header', key: `header:${group}`, label: group });
                    lastGroup = group;
                }
            }
            result.push({ type: 'session', key: `${item.provider}:${item.sessionId}`, item });
        }
        return result;
    }, [items, sortBy, machine?.metadata?.homeDir]);

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
        const item = row.item;
        const activeSessionId = activeHappySessions.get(`${item.provider}:${item.sessionId}`);
        const displayTitle = item.title || item.summary || item.sessionId;
        const pathDisplay = item.projectDir
            ? formatPathRelativeToHome(item.projectDir, machine?.metadata?.homeDir)
            : undefined;
        const timestamp = item.lastActiveAt ?? item.createdAt;
        const timeDisplay = timestamp ? formatLastSeen(timestamp, false) : undefined;
        const subtitleParts = sortBy === 'projectDir'
            ? [timeDisplay]
            : [pathDisplay, timeDisplay];
        return (
            <Item
                title={displayTitle}
                subtitle={subtitleParts.filter(Boolean).join('\n') || undefined}
                subtitleLines={2}
                leftElement={
                    <Ionicons
                        name={PROVIDER_ICONS[item.provider]}
                        size={20}
                        color={theme.colors.textSecondary}
                    />
                }
                rightElement={activeSessionId ? (
                    <View style={styles.activeBadge}>
                        <Text style={[Typography.default(), { fontSize: 11, color: '#34C759' }]}>
                            {t('providerSessions.activeInHappy')}
                        </Text>
                    </View>
                ) : undefined}
                onPress={() => handleItemPress(item)}
                showChevron={false}
            />
        );
    }, [activeHappySessions, machine, theme, sortBy, handleItemPress]);

    const listEmpty = useMemo(() => {
        if (isLoading) {
            return (
                <View style={styles.centerState}>
                    <ActivityIndicator size="large" color={theme.colors.textSecondary} />
                </View>
            );
        }
        if (errorMessage) {
            return (
                <View style={styles.centerState}>
                    <Ionicons name="alert-circle-outline" size={36} color={theme.colors.textSecondary} />
                    <Text style={[Typography.default(), { fontSize: 15, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
                        {t('providerSessions.loadFailed')}
                    </Text>
                    <Text style={[Typography.default(), { fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 8 }]}>
                        {errorMessage}
                    </Text>
                </View>
            );
        }
        return (
            <View style={styles.centerState}>
                <Ionicons name="file-tray-outline" size={36} color={theme.colors.textSecondary} />
                <Text style={[Typography.default(), { fontSize: 15, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
                    {t('providerSessions.empty')}
                </Text>
            </View>
        );
    }, [isLoading, errorMessage, theme]);

    // Degraded states: machine offline or daemon too old for the RPC
    const degradedMessage = !machine
        ? t('providerSessions.machineNotFound')
        : (!online
            ? t('machine.offlineUnableToSpawn')
            : (!supported ? t('providerSessions.notSupported') : null));

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: t('providerSessions.title'),
                    headerBackTitle: t('common.back'),
                }}
            />
            {degradedMessage ? (
                <View style={styles.centerState}>
                    <Ionicons name="cloud-offline-outline" size={36} color={theme.colors.textSecondary} />
                    <Text style={[Typography.default(), { fontSize: 15, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
                        {degradedMessage}
                    </Text>
                </View>
            ) : (
                <View style={{ flex: 1 }}>
                    <View style={styles.searchContainer}>
                        <TextInput
                            style={styles.searchInput}
                            value={query}
                            onChangeText={setQuery}
                            placeholder={t('providerSessions.searchPlaceholder')}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            clearButtonMode="while-editing"
                        />
                    </View>
                    <View style={styles.chipsRow}>
                        {PROVIDER_FILTERS.map(filter => {
                            const selected = providerFilter === filter.key;
                            const label = filter.key === 'all' ? t('providerSessions.filterAll') : filter.label;
                            return (
                                <Pressable
                                    key={filter.key}
                                    onPress={() => setProviderFilter(filter.key)}
                                    style={[styles.chip, selected && styles.chipSelected]}
                                >
                                    <Text style={[Typography.default(selected ? 'semiBold' : undefined), {
                                        fontSize: 13,
                                        color: selected ? theme.colors.button.primary.tint : theme.colors.text,
                                    }]}>
                                        {label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    <View style={styles.chipsRow}>
                        {SORT_OPTIONS.map(option => {
                            const selected = sortBy === option;
                            return (
                                <Pressable
                                    key={option}
                                    onPress={() => setSortBy(option)}
                                    style={[styles.chip, selected && styles.chipSelected]}
                                >
                                    <Text style={[Typography.default(selected ? 'semiBold' : undefined), {
                                        fontSize: 13,
                                        color: selected ? theme.colors.button.primary.tint : theme.colors.text,
                                    }]}>
                                        {sortLabel(option)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    <View style={[styles.chipsRow, { paddingBottom: 12 }]}>
                        {DATE_PRESETS.map(preset => {
                            const selected = datePreset === preset.key;
                            return (
                                <Pressable
                                    key={preset.key}
                                    onPress={() => setDatePreset(preset.key)}
                                    style={[styles.chip, selected && styles.chipSelected]}
                                >
                                    <Text style={[Typography.default(selected ? 'semiBold' : undefined), {
                                        fontSize: 13,
                                        color: selected ? theme.colors.button.primary.tint : theme.colors.text,
                                    }]}>
                                        {datePresetLabel(preset.key)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    <FlatList
                        data={rows}
                        keyExtractor={(row) => row.key}
                        renderItem={renderRow}
                        ListEmptyComponent={listEmpty}
                        onEndReached={handleLoadMore}
                        onEndReachedThreshold={0.5}
                        keyboardShouldPersistTaps="handled"
                        ListFooterComponent={isLoadingMore ? (
                            <View style={{ paddingVertical: 16 }}>
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            </View>
                        ) : null}
                    />
                </View>
            )}
        </>
    );
}
