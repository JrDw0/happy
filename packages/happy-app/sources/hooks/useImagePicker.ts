/**
 * Image picker hook for attaching images to messages.
 *
 * Wraps expo-image-picker with permission handling and thumbhash generation.
 * Enforces limits: max 20 images per message, 10MB per file.
 *
 * Note: fileSize from expo-image-picker is optional — some platforms do not
 * provide it (returns undefined → size=0). Such files pass the client-side
 * size check; the server enforces the limit on upload. Phase 5 should handle
 * 413 responses gracefully.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { Modal } from '@/modal';
import { generateThumbhash } from '@/utils/thumbhash';
import { t } from '@/text';
import type { AttachmentPreview } from '@/sync/attachmentTypes';

export const MAX_IMAGES_PER_MESSAGE = 20;
export const MAX_ATTACHMENTS_PER_MESSAGE = MAX_IMAGES_PER_MESSAGE;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const IOS_ATTACHMENT_JPEG_QUALITY = 0.92;

export type { AttachmentPreview };

type UseImagePickerResult = {
    selectedImages: AttachmentPreview[];
    pickImages: () => Promise<void>;
    pickMedia: () => Promise<void>;
    takePhoto: () => Promise<void>;
    pickFiles: () => Promise<void>;
    removeImage: (id: string) => void;
    clearImages: () => void;
    addImages: (images: AttachmentPreview[]) => void;
};

function withJpegExtension(fileName: string | null | undefined): string {
    const fallback = `image_${Date.now()}.jpg`;
    const name = fileName?.trim() || fallback;
    const extensionIndex = name.lastIndexOf('.');
    const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
    return `${stem}.jpg`;
}

function attachmentId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function attachmentKind(mimeType: string, mediaType?: string): 'image' | 'video' | 'file' {
    if (mediaType === 'video' || mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('image/')) return 'image';
    return 'file';
}

export async function normalizePickedAssetForUpload(asset: ImagePicker.ImagePickerAsset): Promise<{
    uri: string;
    width: number;
    height: number;
    mimeType: string;
    name: string;
}> {
    if (Platform.OS !== 'ios') {
        return {
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            mimeType: asset.mimeType ?? 'image/jpeg',
            name: asset.fileName ?? `image_${Date.now()}.jpg`,
        };
    }

    const converted = await manipulateAsync(asset.uri, [], {
        compress: IOS_ATTACHMENT_JPEG_QUALITY,
        format: SaveFormat.JPEG,
    });

    return {
        uri: converted.uri,
        width: converted.width || asset.width,
        height: converted.height || asset.height,
        mimeType: 'image/jpeg',
        name: withJpegExtension(asset.fileName),
    };
}

export function useImagePicker(): UseImagePickerResult {
    const [selectedImages, setSelectedImages] = useState<AttachmentPreview[]>([]);
    // Ref tracks current count to avoid stale closures on rapid taps.
    const selectedCountRef = useRef(0);
    useEffect(() => {
        selectedCountRef.current = selectedImages.length;
    }, [selectedImages]);

    const requestPermission = useCallback(async (): Promise<boolean> => {
        if (Platform.OS === 'web') return true;

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Modal.alert(
                t('imageUpload.permissionTitle'),
                t('imageUpload.permissionMessage'),
                [{ text: t('common.ok') }],
            );
            return false;
        }
        return true;
    }, []);

    const appendAssets = useCallback(async (assets: ImagePicker.ImagePickerAsset[]) => {
        const remaining = MAX_ATTACHMENTS_PER_MESSAGE - selectedCountRef.current;
        if (remaining <= 0) {
            Modal.alert(t('imageUpload.limitTitle'), t('imageUpload.limitMessage', { max: MAX_ATTACHMENTS_PER_MESSAGE }), [{ text: t('common.ok') }]);
            return;
        }

        const previews: AttachmentPreview[] = [];
        for (const asset of assets.slice(0, remaining)) {
            const size = asset.fileSize ?? 0;
            if (size > MAX_FILE_SIZE) {
                Modal.alert(t('imageUpload.fileTooLargeTitle'), t('imageUpload.fileTooLargeMessage', { name: asset.fileName ?? 'file', maxMb: 10 }), [{ text: t('common.ok') }]);
                continue;
            }
            const mimeType = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
            const kind = attachmentKind(mimeType, asset.type ?? undefined);
            const normalized = kind === 'image'
                ? await normalizePickedAssetForUpload(asset)
                : { uri: asset.uri, width: asset.width || 0, height: asset.height || 0, mimeType, name: asset.fileName ?? `${kind}_${Date.now()}` };
            const thumbhash = kind === 'image' && normalized.width > 0 && normalized.height > 0
                ? await generateThumbhash(normalized.uri, normalized.width, normalized.height)
                : undefined;
            previews.push({ id: attachmentId(), ...normalized, size, kind, thumbhash });
        }
        if (previews.length > 0) setSelectedImages(prev => [...prev, ...previews].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
    }, []);

    const pickMedia = useCallback(async () => {
        const hasPermission = await requestPermission();
        if (!hasPermission) return;

        const remaining = MAX_IMAGES_PER_MESSAGE - selectedCountRef.current;
        if (remaining <= 0) {
            Modal.alert(
                t('imageUpload.limitTitle'),
                t('imageUpload.limitMessage', { max: MAX_IMAGES_PER_MESSAGE }),
                [{ text: t('common.ok') }],
            );
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'], // expo-image-picker ~55
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            quality: 1, // request full-resolution source; iOS upload is normalized below
            exif: false,
        });

        if (result.canceled || !result.assets.length) return;

        // On web, selectionLimit is not enforced by the browser — clamp here.
        await appendAssets(result.assets);
    }, [appendAssets, requestPermission]);

    const takePhoto = useCallback(async () => {
        if (Platform.OS !== 'web') {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (permission.status !== 'granted') {
                Modal.alert(t('imageUpload.cameraPermissionTitle'), t('imageUpload.cameraPermissionMessage'), [{ text: t('common.ok') }]);
                return;
            }
        }
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
        if (!result.canceled) await appendAssets(result.assets);
    }, [appendAssets]);

    const pickFiles = useCallback(async () => {
        const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
        if (result.canceled) return;
        const previews: AttachmentPreview[] = [];
        for (const file of result.assets.slice(0, MAX_ATTACHMENTS_PER_MESSAGE - selectedCountRef.current)) {
            const size = file.size ?? 0;
            if (size > MAX_FILE_SIZE) {
                Modal.alert(t('imageUpload.fileTooLargeTitle'), t('imageUpload.fileTooLargeMessage', { name: file.name, maxMb: 10 }), [{ text: t('common.ok') }]);
                continue;
            }
            previews.push({ id: attachmentId(), uri: file.uri, width: 0, height: 0, mimeType: file.mimeType ?? 'application/octet-stream', size, name: file.name, kind: 'file' });
        }
        if (previews.length > 0) setSelectedImages(prev => [...prev, ...previews].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
    }, []);

    const pickImages = pickMedia;

    const removeImage = useCallback((id: string) => {
        setSelectedImages(prev => prev.filter(img => img.id !== id));
    }, []);

    const clearImages = useCallback(() => {
        setSelectedImages([]);
    }, []);

    const addImages = useCallback((images: AttachmentPreview[]) => {
        setSelectedImages(prev => {
            const remaining = MAX_IMAGES_PER_MESSAGE - prev.length;
            if (remaining <= 0) return prev;
            return [...prev, ...images.slice(0, remaining)];
        });
    }, []);

    return { selectedImages, pickImages, pickMedia, takePhoto, pickFiles, removeImage, clearImages, addImages };
}
