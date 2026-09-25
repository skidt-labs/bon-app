import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	nimmBildAuf,
	MAX_BILD_BYTES,
	MIN_BILD_BREITE_PX,
	pruefeAngekuendigteGroesse,
	type EingehendesBild
} from './ingest';

const bild = (ueber: Partial<EingehendesBild> = {}): EingehendesBild => ({
	eventId: '$ereignis1',
	senderMatrixId: '@erika:example.org',
	roomId: '!raum:example.org',
	bytes: Buffer.alloc(1024, 7),
	gesendetAm: new Date('2026-09-14T12:00:00Z'),
	...ueber
});

function deps(ueber: Record<string, unknown> = {}) {
	return {
		nutzerZuMatrixId: vi.fn(async () => ({ userId: 'u1', householdId: 'h1', displayName: 'Erika' })),
		// Breite deutlich über MIN_BILD_BREITE_PX: bestehende Tests erwarten 'aufgenommen',
		// nicht die neue Warnvariante (Entwurf E4) — siehe eigene Tests weiter unten.
		storeReceiptImage: vi.fn(async () => ({ imagePath: 'a.webp', thumbPath: 'a.thumb.webp', width: 900 })),
		enqueueExtraction: vi.fn(async () => {}),
		findeBonZuEreignis: vi.fn(async () => null),
		legeBonAn: vi.fn(async () => 'r1'),
		markiereFehlgeschlagen: vi.fn(async () => {}),
		...ueber
	};
}

describe('nimmBildAuf', () => {
	it('legt einen Bon an und reiht ihn ein', async () => {
		const d = deps();
		const r = await nimmBildAuf(bild(), d);
		expect(r).toEqual({ art: 'aufgenommen', receiptId: 'r1' });
		expect(d.enqueueExtraction).toHaveBeenCalledWith('r1');
	});

	// Der Idempotenz-Schlüssel. Nach einem Neustart liefert Matrix dieselben Ereignisse
	// noch einmal; ohne diese Prüfung entstünde für jedes Bild ein zweiter Bon.
	//
	// Die storeReceiptImage-Zusicherung ist die Gegenprobe aus Korrekturrunde 1
	// (Befund W3, Mutation a): würde die Idempotenzprüfung HINTER storeReceiptImage
	// verschoben, liefe für ein längst bekanntes Ereignis trotzdem ein Bild auf die
	// Platte — genau das, was diese Prüfung verhindern soll.
	it('erzeugt für dasselbe Ereignis keinen zweiten Bon', async () => {
		const d = deps({ findeBonZuEreignis: vi.fn(async () => 'r1') });
		const r = await nimmBildAuf(bild(), d);
		expect(r).toEqual({ art: 'schon_bekannt', receiptId: 'r1' });
		expect(d.legeBonAn).not.toHaveBeenCalled();
		expect(d.enqueueExtraction).not.toHaveBeenCalled();
		expect(d.storeReceiptImage).not.toHaveBeenCalled();
	});

	// Ein nicht gekoppelter Absender darf NICHTS auslösen — kein Bon, kein Bild auf der
	// Platte, kein Job. Das ist die Zugangskontrolle dieses Wegs.
	it('nimmt von einem nicht gekoppelten Absender nichts an', async () => {
		const d = deps({ nutzerZuMatrixId: vi.fn(async () => null) });
		const r = await nimmBildAuf(bild({ senderMatrixId: '@fremd:example.org' }), d);
		expect(r).toEqual({ art: 'nicht_gekoppelt' });
		expect(d.storeReceiptImage).not.toHaveBeenCalled();
		expect(d.legeBonAn).not.toHaveBeenCalled();
	});

	// Synapse erlaubt 512 MB Upload. Das ungeprüft in sharp zu schieben wäre ein
	// Speicherproblem, das den Bot für alle anderen lahmlegt.
	it('weist ein zu grosses Bild ab, bevor es verarbeitet wird', async () => {
		const d = deps();
		const r = await nimmBildAuf(bild({ bytes: Buffer.alloc(MAX_BILD_BYTES + 1) }), d);
		expect(r.art).toBe('zu_gross');
		expect(d.storeReceiptImage).not.toHaveBeenCalled();
	});

	it('meldet ein unbrauchbares Bild, ohne einen Bon anzulegen', async () => {
		const d = deps({
			storeReceiptImage: vi.fn(async () => {
				throw new Error('Input buffer contains unsupported image format');
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('kein_bild');
		expect(d.legeBonAn).not.toHaveBeenCalled();
	});

	// Übernimmt wörtlich die Lösung aus 7afb245: Der Bon EXISTIERT, nur der
	// Hintergrundauftrag fehlt. Nicht so tun, als wäre nichts angekommen — und auf
	// keinen Fall erneut aufnehmen.
	it('behält den Bon, wenn das Einreihen scheitert, und markiert ihn als fehlgeschlagen', async () => {
		const d = deps({
			enqueueExtraction: vi.fn(async () => {
				throw new Error('pg-boss nicht erreichbar');
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('nicht_eingereiht');
		expect(r).toMatchObject({ receiptId: 'r1' });
		expect(d.markiereFehlgeschlagen).toHaveBeenCalledWith('r1', expect.stringContaining('pg-boss'));
	});

	it('meldet einen Datenbankfehler, ohne ihn zu verschlucken', async () => {
		const d = deps({
			legeBonAn: vi.fn(async () => {
				throw new Error('Verbindung weg');
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('fehler');
	});

	it('schreibt Ereignis-ID und Quelle an den Bon', async () => {
		const d = deps();
		await nimmBildAuf(bild(), d);
		expect(d.legeBonAn).toHaveBeenCalledWith(
			expect.objectContaining({ matrixEventId: '$ereignis1', source: 'matrix', uploadedBy: 'u1', householdId: 'h1' })
		);
	});

	// Korrekturrunde 1, Befund W3 (Mutation b/c): Ein falsches Argument an
	// nutzerZuMatrixId legte den Bon in einen FREMDEN Haushalt — kein bisheriger Test
	// hätte das bemerkt. Diese Zusicherung macht genau das rot: einen anderen Wert
	// als bild.senderMatrixId bzw. bild.bytes/bild.gesendetAm weiterzureichen.
	it('reicht Absender und Bilddaten unverändert an die Abhängigkeiten weiter', async () => {
		const d = deps();
		const b = bild();
		await nimmBildAuf(b, d);
		expect(d.nutzerZuMatrixId).toHaveBeenCalledWith(b.senderMatrixId);
		expect(d.storeReceiptImage).toHaveBeenCalledWith(b.bytes, b.gesendetAm);
	});

	// Korrekturrunde 1, Befund W1: nimmBildAuf darf UNTER KEINEN UMSTÄNDEN werfen.
	// Ein Datenbankfehler bei der Idempotenzprüfung wäre sonst eine unbehandelte
	// Ablehnung, die Aufgabe 5 (den Bot) beendet — kein Text, keine Reaktion, kein
	// Alarm. Der dritte, längst getestete Datenbank-Fehlerpfad (legeBonAn) würde dann
	// nie erreicht.
	it('meldet einen Fehler bei der Idempotenzprüfung, statt zu werfen', async () => {
		const d = deps({
			findeBonZuEreignis: vi.fn(async () => {
				throw new Error('Verbindung weg');
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('fehler');
		expect(d.nutzerZuMatrixId).not.toHaveBeenCalled();
		expect(d.legeBonAn).not.toHaveBeenCalled();
	});

	// Korrekturrunde 1, Befund W1, zweiter Zugriff: derselbe Anspruch gilt für die
	// Zugangskontrolle. Ein Fehler hier ist kein "nicht gekoppelt" — sonst würde eine
	// Störung einen echten, gekoppelten Nutzer unbemerkt abweisen.
	it('meldet einen Fehler bei der Zugangskontrolle, statt zu werfen', async () => {
		const d = deps({
			nutzerZuMatrixId: vi.fn(async () => {
				throw new Error('Verbindung weg');
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('fehler');
		expect(d.storeReceiptImage).not.toHaveBeenCalled();
		expect(d.legeBonAn).not.toHaveBeenCalled();
	});

	// Korrekturrunde 1, Befund W2: Der Koordinator hat die ursprüngliche Einstufung
	// als "kosmetisch" zurückgewiesen. Zwei gleichzeitige Aufrufe für DASSELBE
	// Ereignis (z. B. nach einem Neustart erneut zugestelltes /sync) sehen beide
	// findeBonZuEreignis → null, bevor der jeweils andere committet hat. Ohne
	// Sonderbehandlung meldete der Verlierer des Wettlaufs 'fehler', Aufgabe 5
	// antwortete mit "bitte erneut versuchen", der Nutzer schickte das Foto NOCHMAL
	// mit einer NEUEN Ereignis-ID — und der Doppel-Bon entstünde, den der
	// Idempotenz-Schlüssel gerade verhindern soll. legeBonAn simuliert hier den
	// Unique-Constraint-Verstoss (Postgres 23505 auf receipts_matrix_event_id_unique);
	// findeBonZuEreignis liefert beim ERSTEN Aufruf (früher Idempotenz-Check) null
	// und erst beim ZWEITEN (Nachschlagen nach dem Konflikt) die ID des Gewinners.
	it('erkennt eine Verletzung der Eindeutigkeit beim Einfügen und meldet den vorhandenen Bon', async () => {
		const konflikt = Object.assign(
			new Error('duplicate key value violates unique constraint "receipts_matrix_event_id_unique"'),
			{ code: '23505', constraint: 'receipts_matrix_event_id_unique' }
		);
		const findeBonZuEreignis = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('r1');
		const d = deps({
			findeBonZuEreignis,
			legeBonAn: vi.fn(async () => {
				throw konflikt;
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r).toEqual({ art: 'schon_bekannt', receiptId: 'r1' });
		expect(findeBonZuEreignis).toHaveBeenCalledTimes(2);
		expect(d.enqueueExtraction).not.toHaveBeenCalled();
	});

	// Gegenprobe zu W2: eine ANDERE Eindeutigkeitsverletzung (falscher Constraint)
	// ist KEIN Ereignis-Konflikt und darf nicht als 'schon_bekannt' maskiert werden.
	// Die Anzahl der Aufrufe ist die eigentliche Zusicherung: prüfte istEreignisKonflikt
	// nur den SQLSTATE-Code und nicht den Constraint-Namen, würde hier trotzdem ein
	// zweites Mal nachgeschlagen (und mangels eines Mock-Treffers 'fehler' geliefert) —
	// derselbe Fehlertyp käme also selbst bei einer kaputten Prüfung heraus. Erst der
	// Aufrufzähler macht sichtbar, OB der Constraint-Name tatsächlich geprüft wurde.
	it('meldet eine andere Eindeutigkeitsverletzung als gewöhnlichen Fehler', async () => {
		const andererKonflikt = Object.assign(new Error('duplicate key value violates unique constraint'), {
			code: '23505',
			constraint: 'irgendein_anderer_constraint'
		});
		const findeBonZuEreignis = vi.fn(async () => null);
		const d = deps({
			findeBonZuEreignis,
			legeBonAn: vi.fn(async () => {
				throw andererKonflikt;
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('fehler');
		// Nur der frühe Idempotenz-Check — KEIN Nachschlagen nach einem
		// Ereignis-Konflikt, der laut Constraint-Name gar keiner ist.
		expect(findeBonZuEreignis).toHaveBeenCalledTimes(1);
	});

	// W4 (Korrekturrunde 2): eine volle Platte (ENOSPC beim zweiten writeFile, dem
	// Vorschaubild) ist KEIN Bildproblem — der Nutzer bekam bisher trotzdem "das
	// sieht nicht nach einem lesbaren Bild aus" vorgeworfen. Node-Dateisystemfehler
	// tragen `.code` (z. B. 'ENOSPC'); das unterscheidet den Systemfehler vom
	// sharp-Dekodierfehler zuverlässig.
	it('meldet einen Systemfehler beim Ablegen (volle Platte) als "fehler", nicht als "kein_bild"', async () => {
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
		const enospc = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
		const d = deps({
			storeReceiptImage: vi.fn(async () => {
				throw enospc;
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('fehler');
		expect(consoleErr).toHaveBeenCalled();
		consoleErr.mockRestore();
	});

	// Gegenprobe: ein gewöhnlicher sharp-Fehler (kein `.code`) bleibt 'kein_bild' —
	// das ist tatsächlich ein Nutzerfehler, kein Systemfehler.
	it('meldet ein unbrauchbares Bild weiterhin als "kein_bild" und protokolliert es', async () => {
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
		const d = deps({
			storeReceiptImage: vi.fn(async () => {
				throw new Error('Input buffer contains unsupported image format');
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('kein_bild');
		expect(consoleErr).toHaveBeenCalled();
		consoleErr.mockRestore();
	});

	// W4 (Korrekturrunde 2): "fehler" nach einem gescheiterten legeBonAn (ausserhalb
	// eines Ereignis-Konflikts) blieb bisher ohne jede Log-Zeile.
	it('protokolliert einen Fehler beim Anlegen des Bons', async () => {
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
		const d = deps({
			legeBonAn: vi.fn(async () => {
				throw new Error('Verbindung weg');
			})
		});
		await nimmBildAuf(bild(), d);
		expect(consoleErr).toHaveBeenCalled();
		consoleErr.mockRestore();
	});

	// W3 (Korrekturrunde 2): scheitert auch noch das Markieren als "failed" (z. B.
	// dieselbe Datenbankstörung, die schon enqueueExtraction lahmgelegt hat), darf
	// das nicht spurlos verschwinden wie vorher (leerer `.catch(() => {})`).
	it('protokolliert, wenn sogar das Markieren als fehlgeschlagen scheitert', async () => {
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
		const d = deps({
			enqueueExtraction: vi.fn(async () => {
				throw new Error('pg-boss nicht erreichbar');
			}),
			markiereFehlgeschlagen: vi.fn(async () => {
				throw new Error('DB auch weg');
			})
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('nicht_eingereiht');
		expect(consoleErr).toHaveBeenCalled();
		consoleErr.mockRestore();
	});

	// Entwurf E4, gemessen am 2026-09-15: unter MIN_BILD_BREITE_PX liest Tesseract oft
	// GAR NICHTS (297 px: kein einziges Feld). Der Bon wird TROTZDEM gespeichert und
	// eingereiht — nichts wird weggeworfen —, aber der Rückgabewert muss das melden,
	// damit der Bot warnen kann.
	it('speichert und reiht einen zu schmalen Bon trotzdem ein, meldet aber die Breite', async () => {
		const d = deps({
			storeReceiptImage: vi.fn(async () => ({ imagePath: 'a.webp', thumbPath: 'a.thumb.webp', width: 297 }))
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r).toEqual({ art: 'aufgenommen_zu_klein', receiptId: 'r1', breite: 297 });
		expect(d.legeBonAn).toHaveBeenCalled();
		expect(d.enqueueExtraction).toHaveBeenCalledWith('r1');
	});

	it('meldet ein Bild genau an der Mindestbreite als ausreichend', () => {
		// Grenzfall dokumentiert, keine Netzwerk-/DB-Interaktion nötig: die Bedingung
		// selbst ist `< MIN_BILD_BREITE_PX`, also zählt die Grenze selbst noch als OK.
		expect(MIN_BILD_BREITE_PX).toBeGreaterThan(297);
		expect(MIN_BILD_BREITE_PX).toBeLessThanOrEqual(366);
	});

	it('meldet ein Bild an der Mindestbreite selbst nicht als zu klein', async () => {
		const d = deps({
			storeReceiptImage: vi.fn(async () => ({
				imagePath: 'a.webp', thumbPath: 'a.thumb.webp', width: MIN_BILD_BREITE_PX
			}))
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r).toEqual({ art: 'aufgenommen', receiptId: 'r1' });
	});

	it('meldet ein Bild knapp unter der Mindestbreite als zu klein', async () => {
		const d = deps({
			storeReceiptImage: vi.fn(async () => ({
				imagePath: 'a.webp', thumbPath: 'a.thumb.webp', width: MIN_BILD_BREITE_PX - 1
			}))
		});
		const r = await nimmBildAuf(bild(), d);
		expect(r.art).toBe('aufgenommen_zu_klein');
	});
});

describe('pruefeAngekuendigteGroesse (W2b)', () => {
	it('weist eine angekündigte Grösse über der Grenze ab, ohne herunterzuladen', () => {
		const r = pruefeAngekuendigteGroesse(MAX_BILD_BYTES + 1);
		expect(r).toEqual({ art: 'zu_gross', bytes: MAX_BILD_BYTES + 1, grenze: MAX_BILD_BYTES });
	});

	it('lässt eine angekündigte Grösse innerhalb der Grenze durch', () => {
		expect(pruefeAngekuendigteGroesse(1024)).toBeNull();
	});

	// Fehlt die Angabe, wird trotzdem geladen (Restlücke, siehe Kommentar an der
	// Funktion) — hier nur die Gegenprobe, dass ein fehlendes Feld NICHT vorschnell
	// abgewiesen wird.
	it('lässt eine fehlende Angabe durch', () => {
		expect(pruefeAngekuendigteGroesse(undefined)).toBeNull();
	});
});
