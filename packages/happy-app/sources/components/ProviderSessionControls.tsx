import * as React from 'react';
import { View, Text, TextInput, Pressable, Platform } from 'react-native';
import { Typography } from '@/constants/Typography';
import {
    type ProviderSessionProvider,
    type ProviderSessionSortBy,
} from '@/sync/ops';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';

// Provider filter chips. The "all" entry resolves its label via t() at render
// time so the control stays language-agnostic.
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
}));

function Chip({
    label,
    selected,
    onPress,
}: {
    label: string;
    selected: boolean;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={onPress}
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
}

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
    return (
        <View>
            <View style={styles.searchContainer}>
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
            <View style={styles.chipsRow}>
                {PROVIDER_FILTERS.map((filter) => {
                    const selected = providerFilter === filter.key;
                    const label = filter.key === 'all' ? t('providerSessions.filterAll') : filter.label;
                    return (
                        <Chip
                            key={filter.key}
                            label={label}
                            selected={selected}
                            onPress={() => onChange({ providerFilter: filter.key })}
                        />
                    );
                })}
            </View>
            <View style={styles.chipsRow}>
                {SORT_OPTIONS.map((option) => (
                    <Chip
                        key={option}
                        label={sortLabel(option)}
                        selected={sortBy === option}
                        onPress={() => onChange({ sortBy: option })}
                    />
                ))}
            </View>
            <View style={[styles.chipsRow, { paddingBottom: 12 }]}>
                {DATE_PRESETS.map((preset) => (
                    <Chip
                        key={preset.key}
                        label={datePresetLabel(preset.key)}
                        selected={datePreset === preset.key}
                        onPress={() => onChange({ datePreset: preset.key })}
                    />
                ))}
            </View>
        </View>
    );
}
