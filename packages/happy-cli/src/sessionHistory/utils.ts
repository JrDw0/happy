/**
 * Shared parsing helpers for provider session scanners.
 *
 * Ported from cc-switch `session_manager/providers/utils.rs`.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const TITLE_MAX_CHARS = 80;
export const SUMMARY_MAX_CHARS = 160;

/**
 * Parse a timestamp value into unix epoch milliseconds.
 * Accepts integers/floats (millis if > 1e12, otherwise seconds) and
 * ISO-8601 / RFC3339 strings.
 */
export function parseTimestampToMs(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const n = Math.trunc(value);
        return n > 1_000_000_000_000 ? n : n * 1000;
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extract plain text from a message `content` value which may be a string,
 * an array of content blocks, or an object with a `text` field.
 */
export function extractText(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map(extractTextFromItem)
            .filter((text): text is string => !!text && text.trim().length > 0)
            .join('\n');
    }
    if (isRecord(content) && typeof content.text === 'string') {
        return content.text;
    }
    return '';
}

function extractTextFromItem(item: unknown): string | undefined {
    if (!isRecord(item)) {
        return undefined;
    }
    const itemType = typeof item.type === 'string' ? item.type : '';

    // tool_use: show tool name
    if (itemType === 'tool_use') {
        const name = typeof item.name === 'string' ? item.name : 'unknown';
        return `[Tool: ${name}]`;
    }

    // tool_result: extract nested content
    if (itemType === 'tool_result') {
        if (item.content !== undefined) {
            const text = extractText(item.content);
            if (text.length > 0) {
                return text;
            }
        }
        return undefined;
    }

    if (typeof item.text === 'string') {
        return item.text;
    }
    if (typeof item.input_text === 'string') {
        return item.input_text;
    }
    if (typeof item.output_text === 'string') {
        return item.output_text;
    }
    if (item.content !== undefined) {
        const text = extractText(item.content);
        if (text.length > 0) {
            return text;
        }
    }
    return undefined;
}

export function truncateSummary(text: string, maxChars: number): string {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return '';
    }
    const chars = Array.from(trimmed);
    if (chars.length <= maxChars) {
        return trimmed;
    }
    return chars.slice(0, maxChars).join('') + '...';
}

export function pathBasename(value: string): string | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    const normalized = trimmed.replace(/[/\\]+$/, '');
    const segments = normalized.split(/[/\\]/);
    const last = segments[segments.length - 1];
    return last && last.length > 0 ? last : undefined;
}

/**
 * Recursively collect files with the given extension (e.g. '.jsonl') under
 * `root`. Missing or unreadable directories are silently skipped.
 */
export async function collectFilesWithExtension(root: string, extension: string, maxDepth = 10): Promise<string[]> {
    if (maxDepth <= 0) {
        return [];
    }
    const files: string[] = [];
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return files;
    }
    for (const entry of entries) {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectFilesWithExtension(fullPath, extension, maxDepth - 1)));
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
            files.push(fullPath);
        }
    }
    return files;
}
