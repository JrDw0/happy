import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Platform, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MobileGlassSurface } from './MobileGlass';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        position: 'absolute',
        right: 16,
    },
    button: {
        borderRadius: 20,
        width: 56,
        height: 56,
        padding: Platform.select({ web: 16, default: 0 }),
        overflow: 'visible',
        shadowColor: Platform.select({ web: theme.colors.shadow.color, default: 'transparent' }),
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: Platform.select({ web: 3.84, default: 0 }),
        shadowOpacity: Platform.select({ web: theme.colors.shadow.opacity, default: 0 }),
        // No elevation on Android: with a transparent shadowColor it doesn't
        // draw a real shadow, just a gray rectangular artifact behind the
        // rounded button. The solid black fill provides enough contrast.
        elevation: Platform.select({ web: 5, default: 0 }),
    },
    buttonDefault: {
        // Solid on web/Android — the translucent glass surface disappears
        // against the light session-list background. iOS keeps Liquid Glass.
        backgroundColor: Platform.select({ ios: 'transparent', default: theme.colors.fab.background }),
    },
    buttonPressed: {
        backgroundColor: Platform.select({ ios: 'transparent', default: theme.colors.fab.backgroundPressed }),
        opacity: Platform.select({ web: 1, default: 0.72 }),
        transform: Platform.select({ web: [], default: [{ scale: 0.97 }] }),
    },
    solidContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    glass: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: 'transparent',
        borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
        borderColor: theme.colors.glass.border,
        shadowColor: theme.colors.glass.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: Platform.select({ web: 0, default: 1 }),
        shadowRadius: 18,
        elevation: Platform.select({ android: 8, default: 0 }),
    },
}));

export const FAB = React.memo(({ onPress }: { onPress: () => void }) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    return (
        <View
            style={[
                styles.container,
                { bottom: safeArea.bottom + 16 }
            ]}
        >
            <Pressable
                style={({ pressed }) => [
                    styles.button,
                    pressed ? styles.buttonPressed : styles.buttonDefault
                ]}
                onPress={onPress}
            >
                {Platform.OS === 'ios' ? (
                    <MobileGlassSurface interactive intensity={76} style={styles.glass}>
                        <Ionicons name="add" size={24} color={theme.colors.fab.icon} />
                    </MobileGlassSurface>
                ) : (
                    <View style={styles.solidContent}>
                        <Ionicons name="add" size={24} color={theme.colors.fab.icon} />
                    </View>
                )}
            </Pressable>
        </View>
    )
});
