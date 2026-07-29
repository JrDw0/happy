import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readHeadTailLines } from './readHeadTail';

describe('readHeadTailLines', () => {
    let testDir: string;

    beforeEach(async () => {
        testDir = join(tmpdir(), `read-head-tail-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
        await rm(testDir, { recursive: true, force: true });
    });

    async function writeLines(name: string, lines: string[], trailingNewline = true): Promise<string> {
        const filePath = join(testDir, name);
        await writeFile(filePath, lines.join('\n') + (trailingNewline ? '\n' : ''));
        return filePath;
    }

    it('reads head and tail from a small file (< 16KB)', async () => {
        const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`);
        const filePath = await writeLines('small.jsonl', lines);

        const { head, tail } = await readHeadTailLines(filePath, 10, 30);
        expect(head).toEqual(lines.slice(0, 10));
        expect(tail).toEqual(lines.slice(20));
    });

    it('returns all lines when file has fewer lines than requested', async () => {
        const lines = ['a', 'b', 'c'];
        const filePath = await writeLines('tiny.jsonl', lines);

        const { head, tail } = await readHeadTailLines(filePath, 10, 30);
        expect(head).toEqual(lines);
        expect(tail).toEqual(lines);
    });

    it('handles a file without trailing newline', async () => {
        const lines = ['first', 'second', 'third'];
        const filePath = await writeLines('no-trailing.jsonl', lines, false);

        const { head, tail } = await readHeadTailLines(filePath, 2, 2);
        expect(head).toEqual(['first', 'second']);
        expect(tail).toEqual(['second', 'third']);
    });

    it('strips CRLF line endings', async () => {
        const filePath = join(testDir, 'crlf.jsonl');
        await writeFile(filePath, 'one\r\ntwo\r\nthree\r\n');

        const { head, tail } = await readHeadTailLines(filePath, 2, 2);
        expect(head).toEqual(['one', 'two']);
        expect(tail).toEqual(['two', 'three']);
    });

    it('reads head and tail from a large file (> 16KB) with correct line boundaries', async () => {
        // Each line ~100 chars so the file is well above the 16KB threshold
        const lines = Array.from({ length: 500 }, (_, i) => `line-${String(i).padStart(4, '0')}-${'x'.repeat(90)}`);
        const filePath = await writeLines('large.jsonl', lines);

        const { head, tail } = await readHeadTailLines(filePath, 10, 30);
        expect(head).toEqual(lines.slice(0, 10));
        // Tail must be the exact last 30 lines with no truncated partial line
        expect(tail).toEqual(lines.slice(470));
        for (const line of tail) {
            expect(line).toMatch(/^line-\d{4}-x+$/);
        }
    });

    it('discards the first partial tail line when seeking into a large file', async () => {
        // One huge first line pushes the seek position into the middle of it
        const bigFirst = 'A'.repeat(40_000);
        const lines = [bigFirst, 'tail-1', 'tail-2'];
        const filePath = await writeLines('huge-first-line.jsonl', lines);

        const { head, tail } = await readHeadTailLines(filePath, 1, 30);
        expect(head).toEqual([bigFirst]);
        // The truncated chunk of the big first line must not leak into tail
        expect(tail).toEqual(['tail-1', 'tail-2']);
    });

    it('handles an empty file', async () => {
        const filePath = join(testDir, 'empty.jsonl');
        await writeFile(filePath, '');

        const { head, tail } = await readHeadTailLines(filePath, 10, 30);
        expect(head).toEqual([]);
        expect(tail).toEqual([]);
    });

    it('rejects for a missing file', async () => {
        await expect(readHeadTailLines(join(testDir, 'nope.jsonl'), 10, 30)).rejects.toThrow();
    });
});
