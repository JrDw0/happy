import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configuration } from '@/configuration';
import type { PendingAttachment } from './MessageQueue2';

function safeSegment(value: string): string {
    const cleaned = value.trim().replace(/[\\/]+/g, '_').replace(/\.\.+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
    return cleaned.replace(/^\.+/, '').slice(0, 120) || 'attachment';
}

export async function materializeNonImageAttachments(
    sessionId: string,
    attachments: PendingAttachment[] | undefined,
): Promise<{ context: string; materialized: number }> {
    const files = (attachments ?? []).filter((attachment) => !attachment.mimeType.startsWith('image/'));
    if (files.length === 0) return { context: '', materialized: 0 };

    const directory = join(configuration.happyHomeDir, 'session-attachments', safeSegment(sessionId));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);

    const lines: string[] = ['The user attached files. Read them from these local paths when needed:'];
    let materialized = 0;
    for (const attachment of files) {
        const filename = `${randomUUID()}-${safeSegment(attachment.name)}`;
        const path = join(directory, filename);
        await writeFile(path, Buffer.from(attachment.data), { mode: 0o600 });
        lines.push(`- ${attachment.name} (${attachment.mimeType}, ${attachment.data.length} bytes): ${path}`);
        materialized += 1;
    }
    return { context: lines.join('\n'), materialized };
}
