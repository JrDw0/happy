import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const happyHome = vi.hoisted(() => ({ value: '' }));
vi.mock('@/configuration', () => ({ configuration: { get happyHomeDir() { return happyHome.value; } } }));

import { materializeNonImageAttachments } from './attachmentFiles';

describe('materializeNonImageAttachments', () => {
    beforeEach(async () => {
        happyHome.value = await mkdtemp(join(tmpdir(), 'happy-attachments-'));
    });

    it('writes non-image files into a private session directory with safe names', async () => {
        const result = await materializeNonImageAttachments('session/one', [{
            data: new TextEncoder().encode('hello'),
            mimeType: 'text/plain',
            name: '../notes.txt',
        }]);

        expect(result.materialized).toBe(1);
        expect(result.context).toContain('text/plain');
        const sessionDir = join(happyHome.value, 'session-attachments', 'session_one');
        expect((await stat(sessionDir)).mode & 0o777).toBe(0o700);
        const [filename] = await readdir(sessionDir);
        const filePath = join(sessionDir, filename);
        expect((await stat(filePath)).mode & 0o777).toBe(0o600);
        expect(await readFile(filePath, 'utf8')).toBe('hello');
    });

    it('does not materialize images', async () => {
        await expect(materializeNonImageAttachments('session', [{ data: new Uint8Array([1]), mimeType: 'image/png', name: 'a.png' }]))
            .resolves.toEqual({ context: '', materialized: 0 });
    });
});
