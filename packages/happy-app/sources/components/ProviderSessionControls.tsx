import * as React from 'react';
import { View, Text, TextInput, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import {
    type ProviderSessionProvider,
    type ProviderSessionSortBy,
} from '@/sync/ops';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { Modal } from '@/modal';
import { ProviderSessionFilterSheet } from './ProviderSessionFilterSheet';

// Provider filter options. The "all" entry resolves its label via t() at
// render time so the control stays language-agnostic.
export type ProviderFilter = 'all' | ProviderSessionProvider;

export const PROVIDER_FILTERS: { key: ProviderFilter; label: string }[] = [
    { key: 'all', label: '' /* resolved via t() at render time */ },
    { key: 'claude', label: 'Claude' },
    { key: 'codex', label: 'Codex' },
    { key: 'opencode', label: 'OpenCode' },
];

export const SORT_OPTIONS: ProviderSessionSortBy[] = ['lastActiveAt', 'createdAt', 'projectDir'];

export type DatePreset = 'all' | 'today' | '7d' | '30d' | '90d';

export const DATE_PRESETS: { key: DatePreset; days?: number }[] = [
    { key: 'all' },
    { key: 'today' },
    { key: '7d', days: 7 },
    { key: '30d', days: 30 },
    { key: '90d', days: 90 },
];

// Defaults used to decide whether the filter button shows its active dot and
// which segments appear in the active-filter summary line.
export const DEFAULT_PROVIDER_FILTER: ProviderFilter = 'all';
export const DEFAULT_SORT_BY: ProviderSessionSortBy = 'lastActiveAt';
export const DEFAULT_DATE_PRESET: DatePreset = 'all';

export function providerFilterLabel(filter: ProviderFilter): string {
    if (filter === 'all') return t('providerSessions.filterAll');
    return PROVIDER_FILTERS.find(f => f.key === filter)?.label ?? filter;
}

export function sortLabel(sortBy: ProviderSessionSortBy): string {
    switch (sortBy) {
        case 'lastActiveAt': return t('providerSessions.sortRecent');
        case 'createdAt': return t('providerSessions.sortCreated');
        case 'projectDir': return t('providerSessions.sortProject');
    }
}

export function datePresetLabel(preset: DatePreset): string {
    switch (preset) {
        case 'all': return t('providerSessions.dateAll');
        case 'today': return t('providerSessions.dateToday');
        case '7d': return t('providerSessions.date7Days');
        case '30d': return t('providerSessions.date30Days');
        case '90d': return t('providerSessions.date90Days');
    }
}

// Resolve a DatePreset into a `dateFrom` lower bound (unix millis) computed on
// the client clock. Returns undefined for the "all" preset.
export function datePresetToFrom(preset: DatePreset): number | undefined {
    if (preset === 'all') return undefined;
    if (preset === 'today') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        return startOfDay.getTime();
    }
    const entry = DATE_PRESETS.find(p => p.key === preset);
    if (entry?.days) {
        return Date.now() - entry.days * 24 * 60 * 60 * 1000;
    }
    return undefined;
}

export interface ProviderSessionControlsState {
    query: string;
    providerFilter: ProviderFilter;
    sortBy: ProviderSessionSortBy;
    datePreset: DatePreset;
}

const styles = StyleSheet.create((theme) => ({
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    searchBox: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 10,
        backgroundColor: Platform.select({
            web: theme.colors.input?.background ?? theme.colors.groupped.background,
            default: theme.colors.glass.backgroundSubtle,
        }),
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 10,
    },
    searchInput: {
        flex: 1,
        paddingVertical: Platform.select({ web: 9, ios: 9, default: 7 }) as any,
        fontSize: 15,
        color: theme.colors.text,
    },
    filterButton: {
        width: 38,
        height: 38,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Platform.select({
            web: theme.colors.input?.background ?? theme.colors.groupped.background,
            default: theme.colors.glass.backgroundSubtle,
        }),
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    filterDot: {
        position: 'absolute',
        top: 5,
        right: 5,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.button.primary.background,
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    summaryText: {
        flex: 1,
        fontSize: 12,
        ...Typography.default(),
    },
}));

// Compact controls: one row with the search box plus a filter button that
// opens ProviderSessionFilterSheet. Active (non-default) filters collapse to
// a single tappable summary line with a clear-all affordance instead of
// permanently occupying three chip rows.
export function ProviderSessionControls({
    query,
    providerFilter,
    sortBy,
    datePreset,
    onChange,
}: ProviderSessionControlsState & {
    onChange: (next: Partial<ProviderSessionControlsState>) => void;
}) {
    const { theme } = useUnistyles();

    const activeParts: string[] = [];
    if (providerFilter !== DEFAULT_PROVIDER_FILTER) activeParts.push(providerFilterLabel(providerFilter));
    if (datePreset !== DEFAULT_DATE_PRESET) activeParts.push(datePresetLabel(datePreset));
    if (sortBy !== DEFAULT_SORT_BY) activeParts.push(sortLabel(sortBy));
    const hasActiveFilters = activeParts.length > 0;

    const openFilters = React.useCallback(() => {
        Modal.show({
            component: ProviderSessionFilterSheet,
            props: {
                initial: { providerFilter, sortBy, datePreset },
                onApply: (next: Partial<ProviderSessionControlsState>) => onChange(next),
            },
        } as any);
    }, [providerFilter, sortBy, datePreset, onChange]);

    const resetFilters = React.useCallback(() => {
        onChange({
            providerFilter: DEFAULT_PROVIDER_FILTER,
            sortBy: DEFAULT_SORT_BY,
            datePreset: DEFAULT_DATE_PRESET,
        });
    }, [onChange]);

    return (
        <View>
            <View style={styles.searchRow}>
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={15} color={theme.colors.textSecondary} />
                    <TextInput
                        style={styles.searchInput}
                        value={query}
                        onChangeText={(text) => onChange({ query: text })}
                        placeholder={t('providerSessions.searchPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        clearButtonMode="while-editing"
                    />
                </View>
                <Pressable onPress={openFilters} style={styles.filterButton} hitSlop={4}>
                    <Ionicons name="options-outline" size={19} color={theme.colors.text} />
                    {hasActiveFilters && <View style={styles.filterDot} />}
                </Pressable>
            </View>
            {hasActiveFilters && (
                <View style={styles.summaryRow}>
                    <Pressable onPress={openFilters} style={{ flexShrink: 1 }}>
                        <Text
                            style={[styles.summaryText, { color: theme.colors.button.primary.background }]}
                            numberOfLines={1}
                        >
                            {activeParts.join(' · ')}
                        </Text>
                    </Pressable>
                    <Pressable onPress={resetFilters} hitSlop={8}>
                        <Ionicons name="close-circle" size={17} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
            )}
        </View>
    );
}
