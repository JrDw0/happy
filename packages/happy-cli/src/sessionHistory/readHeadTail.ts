/**
 * Efficiently read the first `headN` and last `tailN` lines of a file.
 *
 * Ported from cc-switch `session_manager/providers/utils.rs`
 * (`read_head_tail_lines`): small files (< 16 KB) are read in one go;
 * large files stream the head lines and seek to the last 16 KB for the
 * tail lines, discarding the first (potentially truncated) tail line.
 */

import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';

const SMALL_FILE_THRESHOLD = 16_384;
const TAIL_CHUNK_SIZE = 16_384;

export interface HeadTailLines {
    head: string[];
    tail: string[];
}

function splitLines(text: string): string[] {
    const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
    // A trailing newline produces one empty trailing element; drop it to match
    // BufReader::lines() semantics.
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

async function readFirstLines(filePath: string, headN: number): Promise<string[]> {
    if (headN <= 0) {
        return [];
    }
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    const head: string[] = [];
    try {
        for await (const line of rl) {
            head.push(line);
            if (head.length >= headN) {
                break;
            }
        }
    } finally {
        rl.close();
        stream.destroy();
    }
    return head;
}

export async function readHeadTailLines(filePath: string, headN: number, tailN: number): Promise<HeadTailLines> {
    const fileStat = await stat(filePath);
    const fileLen = fileStat.size;

    // For small files, read all lines once and split
    if (fileLen < SMALL_FILE_THRESHOLD) {
        const handle = await open(filePath, 'r');
        let content: string;
        try {
            content = (await handle.readFile({ encoding: 'utf8' })) as string;
        } finally {
            await handle.close();
        }
        const all = splitLines(content);
        const head = all.slice(0, headN);
        const tail = all.slice(Math.max(0, all.length - tailN));
        return { head, tail };
    }

    // Read head lines from the beginning
    const head = await readFirstLines(filePath, headN);

    // Seek to last ~16 KB for tail lines
    const seekPos = Math.max(0, fileLen - TAIL_CHUNK_SIZE);
    const handle = await open(filePath, 'r');
    let tailText: string;
    try {
        const length = fileLen - seekPos;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, seekPos);
        tailText = buffer.toString('utf8');
    } finally {
        await handle.close();
    }

    const allTail = splitLines(tailText);
    // Skip first partial line if we seeked into the middle of a line
    const usable = seekPos > 0 ? allTail.slice(1) : allTail;
    const tail = usable.slice(Math.max(0, usable.length - tailN));

    return { head, tail };
}
