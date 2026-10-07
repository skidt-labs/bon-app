import { describe, it, expect, vi } from 'vitest';

/**
 * 2.5: „alle" kommt aus dem Enum. Hier bekommt das Enum einen kuenftigen Status — mit der
 * Handliste fiele er still aus „alle" heraus, genau die Luecke, die der Punkt schliesst.
 * Eigene Datei: der Mock gilt fuer die ganze Datei, liste.test.ts bleibt beim echten Schema.
 */
vi.mock('$lib/server/db/schema', async (importOriginal) => {
	const echt = await importOriginal<typeof import('$lib/server/db/schema')>();
	return { ...echt, receiptStatus: { enumValues: [...echt.receiptStatus.enumValues, 'kuenftig'] } };
});

import { statusListe } from './liste';

describe('statusListe("alle")', () => {
	it('nimmt einen neuen Status des Enums ohne Handarbeit auf, den Papierkorb nicht (2.5)', () => {
		const alle = statusListe('alle');
		expect(alle).toContain('kuenftig');
		expect(alle).not.toContain('verworfen');
		expect(alle).toEqual(expect.arrayContaining(['pending', 'extracting', 'review', 'confirmed', 'failed', 'doppelt']));
	});
});
