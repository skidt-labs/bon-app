import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const fault = vi.hoisted(() => ({ thumbnailWrite: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...actual,
		writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
			if (fault.thumbnailWrite && String(args[0]).endsWith('.thumb.webp')) {
				throw Object.assign(new Error('Platte voll'), { code: 'ENOSPC' });
			}
			return actual.writeFile(...args);
		}
	};
});

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'bon-storage-fault-'));
	process.env.RECEIPT_DIR = dir;
});
afterEach(async () => {
	fault.thumbnailWrite = false;
	await rm(dir, { recursive: true, force: true });
});

describe('storeReceiptImage bei Schreibfehlern', () => {
	it('entfernt das Original, wenn das Thumbnail nicht geschrieben werden kann', async () => {
		const { storeReceiptImage } = await import('./images');
		const input = await sharp({
			create: { width: 40, height: 80, channels: 3, background: '#fff' }
		}).png().toBuffer();
		fault.thumbnailWrite = true;

		await expect(storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'))).rejects.toMatchObject({ code: 'ENOSPC' });
		expect(await readdir(join(dir, '2026', '09'))).toEqual([]);
	});
});
