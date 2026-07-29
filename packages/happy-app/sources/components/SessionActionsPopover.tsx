import * as React from 'react';
import { Pressable, Modal as RNModal, Platform, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { useSessionQuickActions, SessionActionItem } from '@/hooks/useSessionQuickActions';
import { useSession } from '@/sync/storage';
import {
    formatShortcutChord,
    getPreferredShortcutModifier,
    matchesShortcutChord,
    SESSION_ACTION_SHORTCUTS,
} from '@/keyboard/shortcuts';
import { AnimatedPopup } from './AnimatedOverlay';
import { ProviderIcon } from './ProviderIcon';
import { getSessionIdentityLine, formatPathRelativeToHome } from '@/utils/sessionUtils';
import { t } from '@/text';

export type SessionActionsAnchor =
    | {
        type: 'point';
        x: number;
        y: number;
    }
    | {
        type: 'rect';
        x: number;
        y: number;
        width: number;
        height: number;
    };

interface SessionActionsPopoverProps {
    anchor: SessionActionsAnchor | null;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    onClose: () => void;
    sessionId: string;
    visible: boolean;
}


const WEB_MENU_WIDTH = 288;
const WEB_MENU_ITEM_HEIGHT = 48;
const WEB_MENU_MARGIN = 12;

const stylesheet = StyleSheet.create((theme) => ({
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
    },
    backdropScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.10)',
    },
    webBackdrop: {
        backgroundColor: 'rgba(0, 0, 0, 0.12)',
    },
    card: {
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
        borderColor: theme.colors.glass.border,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 18,
        shadowOffset: {
            width: 0,
            height: 8,
        },
        elevation: 10,
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 999,
        marginTop: 10,
        marginBottom: 8,
        alignSelf: 'center',
    },
    menuItem: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        gap: 12,
    },
    menuItemPressed: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    menuItemDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    menuItemLabel: {
        flex: 1,
        fontSize: 15,
        lineHeight: 20,
        ...Typography.default(),
    },
    menuItemShortcut: {
        flexShrink: 0,
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 18,
        ...Typography.default('semiBold'),
    },
    sessionHeader: {
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    sessionHeaderKicker: {
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 16,
        ...Typography.default('semiBold'),
    },
    sessionHeaderTitle: {
        marginTop: 3,
        color: theme.colors.text,
        fontSize: 17,
        lineHeight: 23,
        ...Typography.default('semiBold'),
    },
    sessionHeaderMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 7,
    },
    sessionHeaderMetaText: {
        flex: 1,
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
        ...Typography.default(),
    },
    sessionHeaderPath: {
        marginTop: 3,
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
        ...Typography.default(),
    },
    sectionLabel: {
        paddingHorizontal: 18,
        paddingTop: 11,
        paddingBottom: 4,
        color: theme.colors.textSecondary,
        fontSize: 10,
        lineHeight: 14,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        ...Typography.default('semiBold'),
    },
    section: {
        paddingVertical: 4,
    },
    sectionDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    nativeContainer: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    nativeSheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
    },
    webContainer: {
        flex: 1,
    },
    webMenu: {
        position: 'absolute',
        width: WEB_MENU_WIDTH,
    },
}));

export function SessionActionsPopover({
    anchor,
    onAfterArchive,
    onAfterDelete,
    onClose,
    sessionId,
    visible,
}: SessionActionsPopoverProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const session = useSession(sessionId);
    const { actionItems: actions } = useSessionQuickActions(session!, {
        onAfterArchive,
        onAfterDelete,
    });
    const preferredModifier = React.useMemo(() => getPreferredShortcutModifier(
        typeof navigator === 'undefined' ? undefined : navigator
    ), []);

    const position = React.useMemo(() => {
        if (!anchor) {
            return null;
        }

        const estimatedHeight = actions.length * WEB_MENU_ITEM_HEIGHT + 116;
        const leftBase = anchor.type === 'point'
            ? anchor.x
            : anchor.x + anchor.width - WEB_MENU_WIDTH;

        let topBase = anchor.type === 'point'
            ? anchor.y
            : anchor.y + anchor.height + 8;

        if (anchor.type === 'rect' && topBase + estimatedHeight > windowHeight - WEB_MENU_MARGIN) {
            topBase = anchor.y - estimatedHeight - 8;
        }

        return {
            left: Math.max(WEB_MENU_MARGIN, Math.min(windowWidth - WEB_MENU_WIDTH - WEB_MENU_MARGIN, leftBase)),
            top: Math.max(WEB_MENU_MARGIN, Math.min(windowHeight - estimatedHeight - WEB_MENU_MARGIN, topBase)),
        };
    }, [actions.length, anchor, windowHeight, windowWidth]);

    const handleActionPress = React.useCallback((action: SessionActionItem) => {
        onClose();
        action.onPress();
    }, [onClose]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || !visible || !anchor || !session) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            const action = actions.find((candidate) => matchesShortcutChord(
                event,
                preferredModifier,
                SESSION_ACTION_SHORTCUTS[candidate.id],
            ));
            if (!action) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            handleActionPress(action);
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [actions, anchor, handleActionPress, preferredModifier, session, visible]);

    if (!visible || !anchor || !session) {
        return null;
    }

    const renderAction = (action: SessionActionItem, index: number, items: SessionActionItem[]) => {
        const isLast = index === items.length - 1;
        const color = action.destructive ? theme.colors.status.error : theme.colors.text;
        const shortcutLabel = formatShortcutChord(
            preferredModifier,
            SESSION_ACTION_SHORTCUTS[action.id],
        );

        return (
            <Pressable
                key={action.id}
                accessibilityRole="button"
                onPress={() => handleActionPress(action)}
                style={({ pressed }) => [
                    styles.menuItem,
                    !isLast && styles.menuItemDivider,
                    pressed && styles.menuItemPressed,
                ]}
            >
                <Ionicons
                    color={color}
                    name={action.icon as keyof typeof Ionicons.glyphMap}
                    size={18}
                />
                <Text numberOfLines={1} style={[styles.menuItemLabel, { color }]}>
                    {action.label}
                </Text>
                {Platform.OS === 'web' && (
                    <Text style={styles.menuItemShortcut}>{shortcutLabel}</Text>
                )}
            </Pressable>
        );
    };

    const sections: Array<{ label: string; items: SessionActionItem[] }> = [
        {
            label: t('session.actionGroupSession'),
            items: actions.filter((action) => action.id === 'rename' || action.id === 'details'),
        },
        {
            label: t('session.actionGroupWork'),
            items: actions.filter((action) => action.id === 'resume' || action.id === 'fork' || action.id === 'duplicate'),
        },
        {
            label: t('session.actionGroupDeveloper'),
            items: actions.filter((action) => action.id === 'copy-metadata' || action.id === 'copy-metadata-and-logs'),
        },
        {
            label: t('session.actionGroupDanger'),
            items: actions.filter((action) => action.id === 'archive'),
        },
    ].filter((section) => section.items.length > 0);

    const actionGroups = sections.map((section, sectionIndex) => (
        <View key={section.label} style={[styles.section, sectionIndex > 0 && styles.sectionDivider]}>
            <Text style={styles.sectionLabel}>{section.label}</Text>
            {section.items.map((action, index) => renderAction(action, index, section.items))}
        </View>
    ));

    const sessionPath = session.metadata?.path
        ? formatPathRelativeToHome(session.metadata.path, session.metadata.homeDir)
        : t('status.unknown');
    const sessionIdentity = getSessionIdentityLine(session);

    const nativeContent = (
        <>
            <View style={styles.card}>
                {Platform.OS !== 'web' && (
                    <View style={[styles.handle, { backgroundColor: theme.colors.textSecondary }]} />
                )}
                <View style={styles.sessionHeader}>
                    <Text style={styles.sessionHeaderKicker}>{t('session.actionSheetTitle')}</Text>
                    <Text style={styles.sessionHeaderTitle} numberOfLines={1}>{session.metadata?.customTitle || session.metadata?.summary?.text || t('session.newChat')}</Text>
                    <View style={styles.sessionHeaderMeta}>
                        <ProviderIcon kind={session.metadata?.provider?.kind ?? session.metadata?.flavor} size={14} />
                        <Text style={styles.sessionHeaderMetaText} numberOfLines={1}>{sessionIdentity}</Text>
                    </View>
                    <Text style={styles.sessionHeaderPath} numberOfLines={1}>{sessionPath}</Text>
                </View>
                {actionGroups}
            </View>
        </>
    );

    if (Platform.OS === 'web' && position) {
        return (
            <RNModal
                animationType="none"
                onRequestClose={onClose}
                transparent
                visible={visible}
            >
                <View style={styles.webContainer}>
                    <Pressable onPress={onClose} style={[styles.backdrop, styles.webBackdrop]} />
                    <View
                        style={[
                            styles.webMenu,
                            {
                                left: position.left,
                                top: position.top,
                            },
                        ]}
                    >
                        <View style={[styles.card, { backgroundColor: theme.colors.header.background }]}>
                            <View style={styles.sessionHeader}>
                                <Text style={styles.sessionHeaderKicker}>{t('session.actionSheetTitle')}</Text>
                                <Text style={styles.sessionHeaderTitle} numberOfLines={1}>{session.metadata?.customTitle || session.metadata?.summary?.text || t('session.newChat')}</Text>
                                <View style={styles.sessionHeaderMeta}>
                                    <ProviderIcon kind={session.metadata?.provider?.kind ?? session.metadata?.flavor} size={14} />
                                    <Text style={styles.sessionHeaderMetaText} numberOfLines={1}>{sessionIdentity}</Text>
                                </View>
                                <Text style={styles.sessionHeaderPath} numberOfLines={1}>{sessionPath}</Text>
                            </View>
                            {actionGroups}
                        </View>
                    </View>
                </View>
            </RNModal>
        );
    }

    return (
        <RNModal
            animationType="fade"
            onRequestClose={onClose}
            transparent
            visible={visible}
        >
            <View style={styles.nativeContainer}>
                <Pressable onPress={onClose} style={styles.backdrop}>
                    <View pointerEvents="none" style={styles.backdropScrim} />
                </Pressable>
                <AnimatedPopup
                    style={[
                        styles.nativeSheet,
                        {
                            paddingBottom: Math.max(16, safeArea.bottom),
                        },
                    ]}
                >
                    {nativeContent}
                </AnimatedPopup>
            </View>
        </RNModal>
    );
}
