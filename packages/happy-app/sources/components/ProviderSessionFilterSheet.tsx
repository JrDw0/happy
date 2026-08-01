import * as React from 'react';
import { View, Text, ScrollView, Pressable, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import {
    PROVIDER_FILTERS,
    SORT_OPTIONS,
    DATE_PRESETS,
    DEFAULT_PROVIDER_FILTER,
    DEFAULT_SORT_BY,
    DEFAULT_DATE_PRESET,
    providerFilterLabel,
    sortLabel,
    datePresetLabel,
    type ProviderFilter,
    type DatePreset,
    type ProviderSessionControlsState,
} from './ProviderSessionControls';
import type { ProviderSessionSortBy } from '@/sync/ops';

export interface ProviderSessionFilterSheetProps {
    initial: Pick<ProviderSessionControlsState, 'providerFilter' | 'sortBy' | 'datePreset'>;
    onApply: (next: Partial<ProviderSessionControlsState>) => void;
    /** Injected by the modal infra. */
    onClose?: () => void;
}

function OptionRow({
    label,
    selected,
    isLast,
    onPress,
}: {
    label: string;
    selected: boolean;
    isLast: boolean;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
                pressed && { backgroundColor: theme.colors.surfaceHigh },
            ]}
        >
            <Text
                style={[
                    styles.rowLabel,
                    { color: selected ? theme.colors.button.primary.background : theme.colors.text },
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
            {selected && (
                <Ionicons name="checkmark" size={17} color={theme.colors.button.primary.background} />
            )}
        </Pressable>
    );
}

// Filter/sort picker for provider session lists. Solid card (no glass) so
// content underneath never ghosts through; options are staged locally and
// applied once via onApply, so the list re-queries once per sheet visit.
export const ProviderSessionFilterSheet = React.memo(function ProviderSessionFilterSheet(props: ProviderSessionFilterSheetProps) {
    const { initial, onApply, onClose } = props;
    const { theme } = useUnistyles();
    const windowSize = useWindowDimensions();

    const [providerFilter, setProviderFilter] = React.useState(initial.providerFilter);
    const [sortBy, setSortBy] = React.useState<ProviderSessionSortBy>(initial.sortBy);
    const [datePreset, setDatePreset] = React.useState(initial.datePreset);

    const isDefault =
        providerFilter === DEFAULT_PROVIDER_FILTER &&
        sortBy === DEFAULT_SORT_BY &&
        datePreset === DEFAULT_DATE_PRESET;

    const resetAll = React.useCallback(() => {
        setProviderFilter(DEFAULT_PROVIDER_FILTER);
        setSortBy(DEFAULT_SORT_BY);
        setDatePreset(DEFAULT_DATE_PRESET);
    }, []);

    const apply = React.useCallback(() => {
        onApply({ providerFilter, sortBy, datePreset });
        onClose?.();
    }, [providerFilter, sortBy, datePreset, onApply, onClose]);

    const sections: { title: string; options: { key: string; label: string; selected: boolean; onPress: () => void }[] }[] = [
        {
            title: t('providerSessions.providerSection'),
            options: PROVIDER_FILTERS.map((filter) => ({
                key: filter.key,
                label: providerFilterLabel(filter.key),
                selected: providerFilter === filter.key,
                onPress: () => setProviderFilter(filter.key),
            })),
        },
        {
            title: t('providerSessions.sortSection'),
            options: SORT_OPTIONS.map((option) => ({
                key: option,
                label: sortLabel(option),
                selected: sortBy === option,
                onPress: () => setSortBy(option),
            })),
        },
        {
            title: t('providerSessions.dateSection'),
            options: DATE_PRESETS.map((preset) => ({
                key: preset.key,
                label: datePresetLabel(preset.key),
                selected: datePreset === preset.key,
                onPress: () => setDatePreset(preset.key),
            })),
        },
    ];

    return (
        <View
            style={[
                styles.sheet,
                {
                    width: Math.min(400, windowSize.width - 32),
                    maxHeight: Math.min(600, windowSize.height - 96),
                },
            ]}
        >
            <View style={styles.header}>
                <Text style={[styles.title, { color: theme.colors.text }]}>
                    {t('providerSessions.filterTitle')}
                </Text>
                <Pressable onPress={resetAll} disabled={isDefault} hitSlop={8}>
                    <Text style={[
                        styles.resetText,
                        { color: isDefault ? theme.colors.textSecondary : theme.colors.button.primary.background },
                    ]}>
                        {t('common.reset')}
                    </Text>
                </Pressable>
            </View>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {sections.map((section) => (
                    <View key={section.title}>
                        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary }]}>
                            {section.title}
                        </Text>
                        <View style={[styles.sectionCard, { backgroundColor: theme.colors.surfaceHigh }]}>
                            {section.options.map((option, index) => (
                                <OptionRow
                                    key={option.key}
                                    label={option.label}
                                    selected={option.selected}
                                    isLast={index === section.options.length - 1}
                                    onPress={option.onPress}
                                />
                            ))}
                        </View>
                    </View>
                ))}
            </ScrollView>

            <View style={styles.actions}>
                <Pressable
                    onPress={apply}
                    style={({ pressed }) => [
                        styles.applyButton,
                        { backgroundColor: theme.colors.button.primary.background },
                        pressed && { opacity: 0.7 },
                    ]}
                >
                    <Text style={[styles.applyText, { color: theme.colors.button.primary.tint }]}>
                        {t('common.done')}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    sheet: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: Platform.OS === 'web' ? 0 : StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        alignSelf: 'center',
        minWidth: 0,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 24,
        elevation: 8,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
    },
    resetText: {
        fontSize: 14,
        fontWeight: '500',
    },
    list: {
        flexGrow: 0,
        flexShrink: 1,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    sectionHeader: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        paddingTop: 14,
        paddingBottom: 5,
        paddingHorizontal: 4,
    },
    sectionCard: {
        borderRadius: 12,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingVertical: 11,
    },
    rowLabel: {
        flex: 1,
        marginRight: 8,
        fontSize: 15,
        fontWeight: '400',
    },
    actions: {
        padding: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    applyButton: {
        paddingVertical: Platform.select({ ios: 11, default: 12 }),
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    applyText: {
        fontSize: 15,
        fontWeight: '600',
    },
}));
