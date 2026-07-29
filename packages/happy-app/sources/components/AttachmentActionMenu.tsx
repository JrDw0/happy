import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

export function AttachmentActionMenu({
    onTakePhoto,
    onPickMedia,
    onPickFiles,
    onClose,
}: {
    onTakePhoto: () => void;
    onPickMedia: () => void;
    onPickFiles: () => void;
    onClose: () => void;
}) {
    const { theme } = useUnistyles();
    const actions = [
        { icon: 'camera-outline' as const, label: t('imageUpload.takePhoto'), onPress: onTakePhoto },
        { icon: 'images-outline' as const, label: t('imageUpload.chooseMedia'), onPress: onPickMedia },
        { icon: 'document-outline' as const, label: t('imageUpload.addFile'), onPress: onPickFiles },
    ];
    return (
        <>
            <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close attachment menu" />
            <View style={[styles.menu, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
                {actions.map((action) => (
                    <Pressable key={action.label} onPress={() => { onClose(); action.onPress(); }} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                        <View style={[styles.icon, { backgroundColor: theme.colors.surfaceHigh }]}>
                            <Ionicons name={action.icon} size={21} color={theme.colors.text} />
                        </View>
                        <Text style={[styles.label, { color: theme.colors.text }]}>{action.label}</Text>
                    </Pressable>
                ))}
            </View>
        </>
    );
}

const styles = StyleSheet.create(() => ({
    backdrop: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 998 },
    menu: { position: 'absolute', left: 8, bottom: '100%', marginBottom: 10, width: 245, paddingVertical: 8, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 16, elevation: 12, zIndex: 999 },
    row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12 },
    pressed: { opacity: 0.58 },
    icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    label: { flex: 1, fontSize: 16, fontWeight: '600' },
}));
