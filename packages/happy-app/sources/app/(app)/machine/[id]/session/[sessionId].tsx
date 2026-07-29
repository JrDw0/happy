import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { useSessions, useMachine } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import {
    machineReadProviderSession,
    type ProviderSessionMessage,
    type ProviderSessionMeta,
    type ProviderSessionProvider,
} from '@/sync/ops';
import { resumeProviderSession } from '@/sync/resumeProviderSession';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { formatPathRelativeToHome, formatLastSeen } from '@/utils/sessionUtils';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';

const PAGE_SIZE = 50;

const styles = StyleSheet.create((theme) => ({
    centerState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 48,
    },
    metaHeader: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    messageRow: {
        paddingHorizontal: 16,
        paddingVertical: 6,
    },
    bubble: {
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        maxWidth: '92%',
    },
    bubbleUser: {
        alignSelf: 'flex-end',
        backgroundColor: theme.colors.button.primary.background,
    },
    bubbleAssistant: {
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    loadEarlierButton: {
        alignSelf: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginVertical: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    headerButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
}));

export default function ProviderSessionDetailScreen() {
    const { theme } = useUnistyles();
    const params = useLocalSearchParams<{
        id: string;
        sessionId: string;
        provider?: string;
        title?: string;
        summary?: string;
        projectDir?: string;
        createdAt?: string;
        lastActiveAt?: string;
        resumable?: string;
    }>();
    const machineId = params.id!;
    const sessionId = params.sessionId!;
    const provider = (params.provider ?? 'claude') as ProviderSessionProvider;
    const machine = useMachine(machineId);
    const sessions = useSessions();
    const navigateToSession = useNavigateToSession();

    // Rebuild the meta object handed over from the list screen via route params
    const meta = useMemo<ProviderSessionMeta>(() => ({
        provider,
        sessionId,
        title: params.title || undefined,
        summary: params.summary || undefined,
        projectDir: params.projectDir || undefined,
        createdAt: params.createdAt ? Number(params.createdAt) : undefined,
        lastActiveAt: params.lastActiveAt ? Number(params.lastActiveAt) : undefined,
        resumable: params.resumable === '1',
    }), [provider, sessionId, params.title, params.summary, params.projectDir, params.createdAt, params.lastActiveAt, params.resumable]);

    // Messages in chronological order (oldest first)
    const [messages, setMessages] = useState<ProviderSessionMessage[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isResuming, setIsResuming] = useState(false);
    const loadingRef = useRef(false);

    // If this provider session is already tracked by Happy, offer "Open in Happy"
    const activeHappySessionId = useMemo(() => {
        if (!sessions) return undefined;
        for (const entry of sessions) {
            if (typeof entry === 'string') continue;
            const session = entry as Session;
            if (provider === 'claude' && session.metadata?.claudeSessionId === sessionId) return session.id;
            if (provider === 'codex' && session.metadata?.codexThreadId === sessionId) return session.id;
        }
        return undefined;
    }, [sessions, provider, sessionId]);

    const loadPage = useCallback(async (offset: number) => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        if (offset === 0) {
            setIsLoading(true);
        } else {
            setIsLoadingEarlier(true);
        }
        const result = await machineReadProviderSession(machineId, {
            provider,
            sessionId,
            offset,
            limit: PAGE_SIZE,
        });
        if (result.type === 'success') {
            // Pages are returned in chronological order; earlier pages prepend
            setMessages(prev => offset === 0 ? result.messages : [...result.messages, ...prev]);
            setHasMore(result.hasMore);
            setErrorMessage(null);
        } else {
            setErrorMessage(result.errorMessage);
        }
        setIsLoading(false);
        setIsLoadingEarlier(false);
        loadingRef.current = false;
    }, [machineId, provider, sessionId]);

    useEffect(() => {
        loadPage(0);
    }, [loadPage]);

    const handleLoadEarlier = useCallback(() => {
        if (!hasMore || isLoading || isLoadingEarlier) return;
        loadPage(messages.length);
    }, [hasMore, isLoading, isLoadingEarlier, messages.length, loadPage]);

    const handleResume = useCallback(async () => {
        if (isResuming) return;
        if (activeHappySessionId) {
            navigateToSession(activeHappySessionId);
            return;
        }
        setIsResuming(true);
        try {
            await resumeProviderSession({
                machineId,
                item: meta,
                homeDir: machine?.metadata?.homeDir,
                navigateToSession,
            });
        } finally {
            setIsResuming(false);
        }
    }, [isResuming, activeHappySessionId, navigateToSession, machineId, meta, machine]);

    // Inverted list wants newest-first data
    const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

    const renderMessage = useCallback(({ item }: { item: ProviderSessionMessage }) => {
        const isUser = item.role === 'user';
        return (
            <View style={styles.messageRow}>
                <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
                    <Text style={[Typography.default(), {
                        fontSize: 14,
                        lineHeight: 20,
                        color: isUser ? theme.colors.button.primary.tint : theme.colors.text,
                    }]}>
                        {item.text}
                    </Text>
                    {item.timestamp ? (
                        <Text style={[Typography.default(), {
                            fontSize: 10,
                            marginTop: 4,
                            color: isUser ? theme.colors.button.primary.tint : theme.colors.textSecondary,
                            opacity: 0.7,
                        }]}>
                            {formatLastSeen(item.timestamp, false)}
                        </Text>
                    ) : null}
                </View>
            </View>
        );
    }, [theme]);

    const displayTitle = meta.title || meta.summary || sessionId;
    const pathDisplay = meta.projectDir
        ? formatPathRelativeToHome(meta.projectDir, machine?.metadata?.homeDir)
        : undefined;

    // Rendered at the visual top of the inverted list (= chronologically earliest)
    const listFooter = useMemo(() => {
        if (isLoadingEarlier) {
            return (
                <View style={{ paddingVertical: 16 }}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            );
        }
        if (hasMore) {
            return (
                <Pressable style={styles.loadEarlierButton} onPress={handleLoadEarlier}>
                    <Text style={[Typography.default(), { fontSize: 13, color: theme.colors.textSecondary }]}>
                        {t('providerSessions.loadEarlier')}
                    </Text>
                </Pressable>
            );
        }
        return null;
    }, [isLoadingEarlier, hasMore, handleLoadEarlier, theme]);

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
                <Ionicons name="chatbubbles-outline" size={36} color={theme.colors.textSecondary} />
                <Text style={[Typography.default(), { fontSize: 15, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
                    {t('providerSessions.detailEmpty')}
                </Text>
            </View>
        );
    }, [isLoading, errorMessage, theme]);

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: displayTitle,
                    headerBackTitle: t('common.back'),
                    headerRight: () => (
                        <Pressable
                            style={styles.headerButton}
                            onPress={handleResume}
                            disabled={isResuming || (!activeHappySessionId && !meta.resumable)}
                        >
                            {isResuming ? (
                                <ActivityIndicator size="small" color={theme.colors.button.primary.background} />
                            ) : (
                                <Text style={[Typography.default('semiBold'), {
                                    fontSize: 14,
                                    color: (!activeHappySessionId && !meta.resumable)
                                        ? theme.colors.textSecondary
                                        : theme.colors.button.primary.background,
                                }]}>
                                    {activeHappySessionId ? t('providerSessions.openInHappy') : t('providerSessions.resume')}
                                </Text>
                            )}
                        </Pressable>
                    ),
                }}
            />
            <View style={{ flex: 1 }}>
                {(pathDisplay || meta.lastActiveAt || meta.createdAt) ? (
                    <View style={styles.metaHeader}>
                        {pathDisplay ? (
                            <Text style={[Typography.default(), { fontSize: 12, color: theme.colors.textSecondary }]} numberOfLines={1}>
                                {pathDisplay}
                            </Text>
                        ) : null}
                        {(meta.lastActiveAt ?? meta.createdAt) ? (
                            <Text style={[Typography.default(), { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }]}>
                                {formatLastSeen((meta.lastActiveAt ?? meta.createdAt)!, false)}
                            </Text>
                        ) : null}
                    </View>
                ) : null}
                <FlatList
                    data={invertedMessages}
                    inverted={invertedMessages.length > 0}
                    keyExtractor={(_, index) => `msg-${index}`}
                    renderItem={renderMessage}
                    ListEmptyComponent={listEmpty}
                    ListFooterComponent={listFooter}
                    onEndReached={handleLoadEarlier}
                    onEndReachedThreshold={0.3}
                    windowSize={10}
                    maxToRenderPerBatch={20}
                    initialNumToRender={20}
                    contentContainerStyle={{ paddingVertical: 8, flexGrow: invertedMessages.length === 0 ? 1 : undefined }}
                />
            </View>
        </>
    );
}
