import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ zeile: null as any, geschrieben: [] as unknown[] }));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: () => Promise.resolve(mocks.zeile ? [mocks.zeile] : []) }) }),
		insert: () => ({
			values: (w: unknown) => ({
				onConflictDoUpdate: () => {
					mocks.geschrieben.push(w);
					return Promise.resolve();
				}
			})
		})
	}
}));

import { PostgresStorageProvider } from './storage';

describe('Sync-Token-Speicher', () => {
	beforeEach(() => {
		mocks.zeile = null;
		mocks.geschrieben = [];
	});

	it('gibt ohne gespeicherten Stand undefined zurück, statt zu raten', async () => {
		const s = new PostgresStorageProvider();
		await s.laden();
		expect(s.getSyncToken()).toBeNull();
	});

	it('liefert den gespeicherten Token nach dem Laden', async () => {
		mocks.zeile = { sinceToken: 's_123', lastSyncAt: new Date() };
		const s = new PostgresStorageProvider();
		await s.laden();
		expect(s.getSyncToken()).toBe('s_123');
	});

	// Der Zeitstempel ist der einzige Weg, einen toten Bot zu bemerken, bevor Bons
	// ins Leere wandern.
	it('schreibt bei jedem Setzen auch den Zeitstempel fort', async () => {
		const s = new PostgresStorageProvider();
		await s.laden();
		s.setSyncToken('s_456');
		await s.sichern();
		expect(mocks.geschrieben[0]).toMatchObject({ sinceToken: 's_456' });
		expect((mocks.geschrieben[0] as { lastSyncAt: Date }).lastSyncAt).toBeInstanceOf(Date);
	});
});
