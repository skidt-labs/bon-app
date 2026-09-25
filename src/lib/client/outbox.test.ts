import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Alle Faelle hier spielen unter EINER Anmeldung; die Trennung nach Konten hat einen
// eigenen Test weiter unten.
const NUTZER = 'nutzer-a';

// Abweichung vom Task-14-Brief (dokumentiert im Bericht): flushOutbox liefert
// zusätzlich `rejected`, damit die Oberfläche einen endgültig abgelehnten Bon
// (z. B. zu groß) von einem erfolgreich hochgeladenen unterscheiden kann. Mit
// nur {sent, kept} sind beide Fälle "kept === 0" — die UI würde einem
// verworfenen Bon fälschlich "hochgeladen" anzeigen. Das verletzt das oberste
// Prinzip ("ein Foto darf niemals still verschwinden") stärker, als ein
// zusätzliches Feld die vorgegebene Test-Signatur verändert.
/**
 * `fake-indexeddb/auto` setzt `globalThis.indexedDB` einmal beim Import des
 * Testfiles - die Datenbank überlebt also standardmässig über alle Tests
 * hinweg. `vi.resetModules()` allein reicht deshalb nicht für Isolation: es
 * tauscht nur das SUT-Modul aus, nicht die zugrunde liegenden Datensätze.
 * Ohne diesen Reset würden Einträge aus einem Test in den nächsten
 * durchsickern und dort die genauen Zähler verfälschen.
 */
function resetDb(): Promise<void> {
	return new Promise((resolve) => {
		const req = indexedDB.deleteDatabase('bon-outbox');
		req.onsuccess = () => resolve();
		req.onerror = () => resolve();
		req.onblocked = () => resolve();
	});
}

describe('Outbox', () => {
	beforeEach(async () => {
		vi.resetModules();
		await resetDb();
	});

	it('verschickt KEIN Foto eines anderen Kontos (R01)', async () => {
		/*
		 * IndexedDB haengt am Browserprofil, nicht am Konto. A nimmt offline ein Foto
		 * auf, B meldet sich am selben Geraet an — ohne Zuordnung verschickte der
		 * automatische Abgleich As Foto unter Bs Sitzung, und der Bon landete in Bs
		 * Haushalt. Serverseitig ist daran nichts zu retten: fuer den Server ist das
		 * ein voellig normaler Upload von B.
		 */
		// Kein localStorage in dieser Umgebung — nutzerMerken() faengt das ab und
		// liefert eine leere Liste. Alteintraege werden dann NICHT uebernommen, die
		// sichere Richtung. Fuer diesen Test ohne Belang: beide Eintraege tragen eine
		// ausdrueckliche Zuordnung.
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', 'person-a');
		await enqueueUpload(new Blob(['b'], { type: 'image/webp' }), 'camera', 'person-b');

		const gesendet: string[] = [];
		const fetchImpl = vi.fn(async () => {
			gesendet.push('einer');
			return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
		});

		// B meldet sich an und laesst abgleichen.
		const r = await flushOutbox({ nutzerId: 'person-b', fetchImpl: fetchImpl as unknown as typeof fetch });
		expect(r.sent).toBe(1);
		expect(r.fremd).toBe(1);
		expect(gesendet).toHaveLength(1);

		// As Foto liegt noch da — es wird NICHT geloescht. Ein Foto verschwinden zu
		// lassen waere derselbe Fehler wie es falsch hochzuladen, nur andersherum.
		expect(await pendingCount()).toBe(1);

		// Und sobald A sich anmeldet, geht es raus.
		const r2 = await flushOutbox({ nutzerId: 'person-a', fetchImpl: fetchImpl as unknown as typeof fetch });
		expect(r2.sent).toBe(1);
		expect(r2.fremd).toBe(0);
		expect(await pendingCount()).toBe(0);
	});

	it('uebernimmt Alteintraege ohne Zuordnung nur, wenn dieser Browser nur EIN Konto kennt', async () => {
		const { darfUebernehmen } = await import('./outbox');
		// Genau ein Konto war je hier: die Zuordnung ist zweifelsfrei.
		expect(darfUebernehmen(['person-a'], 'person-a')).toBe(true);
		// Zwei Konten: nicht mehr herstellbar — dann lieber liegenlassen als raten.
		expect(darfUebernehmen(['person-a', 'person-b'], 'person-a')).toBe(false);
		// Nichts bekannt (privater Modus, gesperrter Speicher): ebenfalls nicht raten.
		expect(darfUebernehmen([], 'person-a')).toBe(false);
	});

	it('bewahrt Uploads auf und verschickt sie beim Leeren', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER);
		await enqueueUpload(new Blob(['b'], { type: 'image/webp' }), 'upload', NUTZER);
		expect(await pendingCount()).toBe(2);

		const ok = vi.fn(async () => new Response('{}', { status: 201 }));
		const result = await flushOutbox({ nutzerId: NUTZER, fetchImpl: ok as unknown as typeof fetch });

		expect(result).toEqual({ sent: 2, kept: 0, rejected: 0, stored: 0, fremd: 0 });
		expect(await pendingCount()).toBe(0);
	});

	it('behält Einträge, wenn der Server nicht erreichbar ist', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER);

		const dead = vi.fn(async () => {
			throw new Error('offline');
		});
		const result = await flushOutbox({ nutzerId: NUTZER, fetchImpl: dead as unknown as typeof fetch });

		expect(result).toEqual({ sent: 0, kept: 1, rejected: 0, stored: 0, fremd: 0 });
		expect(await pendingCount()).toBe(1);
	});

	it('behält Einträge bei einem 5xx-Serverfehler (temporär, erneuter Versuch lohnt sich)', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER);

		const serverDown = vi.fn(async () => new Response('Verarbeitung konnte nicht gestartet werden', { status: 503 }));
		const result = await flushOutbox({ nutzerId: NUTZER, fetchImpl: serverDown as unknown as typeof fetch });

		expect(result).toEqual({ sent: 0, kept: 1, rejected: 0, stored: 0, fremd: 0 });
		expect(await pendingCount()).toBe(1);
	});

	it('verwirft Einträge, die der Server endgültig ablehnt (z. B. Bild zu groß)', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'upload', NUTZER);

		const rejected = vi.fn(async () => new Response('zu groß', { status: 413 }));
		const result = await flushOutbox({ nutzerId: NUTZER, fetchImpl: rejected as unknown as typeof fetch });

		expect(result).toEqual({ sent: 0, kept: 0, rejected: 1, stored: 0, fremd: 0 });
		expect(await pendingCount()).toBe(0);
	});

	// Abweichung: 401 ("Nicht angemeldet") ist KEIN endgültiges Nein des Servers zu
	// diesem Bild, sondern eine abgelaufene/fehlende Sitzung. Würde der Eintrag hier
	// verworfen, verschwindet ein echtes Foto des Nutzers spurlos, nur weil die
	// Session zufällig genau in diesem Moment abgelaufen ist — das widerspricht dem
	// obersten Prinzip. Ein 401-Eintrag bleibt daher erhalten und wird nach dem
	// nächsten Login automatisch erneut versucht.
	it('behält Einträge bei 401 (abgelaufene Sitzung ist kein endgültiges Nein zum Bild)', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER);

		const unauth = vi.fn(async () => new Response('Nicht angemeldet', { status: 401 }));
		const result = await flushOutbox({ nutzerId: NUTZER, fetchImpl: unauth as unknown as typeof fetch });

		expect(result).toEqual({ sent: 0, kept: 1, rejected: 0, stored: 0, fremd: 0 });
		expect(await pendingCount()).toBe(1);
	});

	it('verarbeitet mehrere Einträge unabhängig voneinander (ein Fehlschlag blockiert die anderen nicht)', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER); // wird angenommen
		await enqueueUpload(new Blob(['b'], { type: 'image/webp' }), 'upload', NUTZER); // wird endgültig abgelehnt
		await enqueueUpload(new Blob(['c'], { type: 'image/webp' }), 'camera', NUTZER); // Netz bricht ab

		let call = 0;
		const mixed = vi.fn(async () => {
			call++;
			if (call === 1) return new Response('{}', { status: 201 });
			if (call === 2) return new Response('zu groß', { status: 413 });
			throw new Error('offline');
		});
		const result = await flushOutbox({ nutzerId: NUTZER, fetchImpl: mixed as unknown as typeof fetch });

		expect(result).toEqual({ sent: 1, kept: 1, rejected: 1, stored: 0, fremd: 0 });
		expect(await pendingCount()).toBe(1);
	});

	it('pendingCount ist 0, solange nichts in der Warteschlange liegt', async () => {
		const { pendingCount } = await import('./outbox');
		expect(await pendingCount()).toBe(0);
	});
});

describe('describeFlush', () => {
	it('meldet Erfolg, wenn nichts hängen blieb oder abgelehnt wurde', async () => {
		const { describeFlush } = await import('./outbox');
		expect(describeFlush({ sent: 1, kept: 0, rejected: 0, stored: 0, fremd: 0 })).toMatch(/hochgeladen/);
	});

	it('meldet "kein Netz", solange etwas in der Warteschlange hängt', async () => {
		const { describeFlush } = await import('./outbox');
		expect(describeFlush({ sent: 0, kept: 1, rejected: 0, stored: 0, fremd: 0 })).toMatch(/Netz/);
	});

	// Kern des obersten Prinzips: ein abgelehnter Bon darf NIE wie ein Erfolg klingen.
	it('meldet eine Ablehnung deutlich, statt "hochgeladen" zu behaupten', async () => {
		const { describeFlush } = await import('./outbox');
		const msg = describeFlush({ sent: 0, kept: 0, rejected: 1, stored: 0, fremd: 0 });
		expect(msg).toMatch(/abgelehnt|verworfen/);
		expect(msg).not.toMatch(/hochgeladen/);
	});

	it('nennt beide Fälle, wenn gleichzeitig etwas abgelehnt und etwas aufgehoben wurde', async () => {
		const { describeFlush } = await import('./outbox');
		const msg = describeFlush({ sent: 0, kept: 1, rejected: 1, stored: 0, fremd: 0 });
		expect(msg).toMatch(/abgelehnt|verworfen/);
		expect(msg).toMatch(/Netz/);
	});

	// Vom Review nachgestellt: zwei gleichzeitig laufende Durchgaenge schickten
	// denselben Eintrag ZWEIMAL an /api/receipts. Der Endpunkt kennt keinen
	// Idempotenz-Schluessel — es entstuenden zwei Bons, zwei Modellaufrufe und im
	// Haushaltsbuch ein doppelter Betrag. Kein Fotoverlust, aber eine Behauptung,
	// die nicht stimmt. Ausloeser im Alltag: zwei offene Tabs, die beide auf
	// `online` reagieren, oder im selben Tab der online-Handler und ein gerade
	// hochgeladenes Foto.
	it('schickt denselben Eintrag nicht doppelt, wenn zwei Durchgaenge gleichzeitig starten', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER);

		// Langsame Antwort: ohne Serialisierung liest der zweite Durchgang den
		// Bestand, waehrend der erste noch sendet, und findet den Eintrag dort vor.
		const langsam = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 25));
			return new Response('{}', { status: 201 });
		});
		const fetchImpl = langsam as unknown as typeof fetch;

		const [a, b] = await Promise.all([flushOutbox({ nutzerId: NUTZER, fetchImpl }), flushOutbox({ nutzerId: NUTZER, fetchImpl })]);

		expect(langsam).toHaveBeenCalledTimes(1);
		expect(a.sent + b.sent).toBe(1);
		expect(await pendingCount()).toBe(0);
	});

	// Der zweite Durchgang darf nicht einfach das Ergebnis des ersten uebernehmen:
	// ein Foto, das erst nach dessen Bestandsaufnahme dazukam, muss trotzdem raus.
	it('verschickt einen Eintrag, der waehrend eines laufenden Durchgangs dazukommt', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER);

		const ok = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 25));
			return new Response('{}', { status: 201 });
		});
		const fetchImpl = ok as unknown as typeof fetch;

		const erster = flushOutbox({ nutzerId: NUTZER, fetchImpl });
		await enqueueUpload(new Blob(['b'], { type: 'image/webp' }), 'upload', NUTZER);
		const zweiter = flushOutbox({ nutzerId: NUTZER, fetchImpl });

		await Promise.all([erster, zweiter]);
		expect(ok).toHaveBeenCalledTimes(2);
		expect(await pendingCount()).toBe(0);
	});

	// Ein Fehlschlag darf die Kette nicht reissen — sonst blieben alle folgenden
	// Durchgaenge fuer immer aus und die Fotos lagen still in der Warteschlange.
	it('leert weiter, nachdem ein Durchgang geworfen hat', async () => {
		const { enqueueUpload, flushOutbox, pendingCount } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER);

		const kaputt = vi.fn(async () => {
			throw new Error('boom');
		});
		// flushOutbox faengt fetch-Fehler selbst ab (kept) — ein echter Wurf entsteht
		// nur oberhalb davon. Hier genuegt, dass ein Durchgang mit kept endet und der
		// naechste trotzdem laeuft.
		await flushOutbox({ nutzerId: NUTZER, fetchImpl: kaputt as unknown as typeof fetch });
		expect(await pendingCount()).toBe(1);

		const ok = vi.fn(async () => new Response('{}', { status: 201 }));
		const result = await flushOutbox({ nutzerId: NUTZER, fetchImpl: ok as unknown as typeof fetch });
		expect(result.sent).toBe(1);
		expect(await pendingCount()).toBe(0);
	});

});

// Der eine Fall, in dem ein aufgenommenes Foto wirklich NICHT gesichert ist. Die rohe
// Browser-Ausnahme sagt dem Nutzer nichts; sie liest sich wie eine Panne, die von
// selbst vergeht. Er muss erfahren, dass dieses Foto weg ist, wenn er nichts tut.
describe('Speicher voll', () => {
	it('meldet unmissverstaendlich, dass das Foto NICHT gesichert wurde', async () => {
		const { enqueueUpload } = await import('./outbox');
		const quota = Object.assign(new Error('The quota has been exceeded.'), {
			name: 'QuotaExceededError'
		});
		vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
			throw quota;
		});
		try {
			await expect(enqueueUpload(new Blob(['a']), 'camera', NUTZER)).rejects.toThrow(/NICHT gesichert/);
		} finally {
			vi.restoreAllMocks();
		}
	});

	it('reicht andere Fehler unveraendert durch, statt sie als Speicherproblem auszugeben', async () => {
		const { enqueueUpload } = await import('./outbox');
		vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
			throw new Error('etwas ganz anderes');
		});
		try {
			await expect(enqueueUpload(new Blob(['a']), 'camera', NUTZER)).rejects.toThrow('etwas ganz anderes');
		} finally {
			vi.restoreAllMocks();
		}
	});
});

// Aus der Abschlusspruefung: Der Server kann den Bon HABEN und trotzdem melden, dass
// die Auswertung nicht angelaufen ist (Hintergrundauftrag liess sich nicht einreihen).
// Wuerde die Warteschlange das als "spaeter erneut versuchen" behandeln, lüde sie
// dasselbe Foto ein zweites Mal hoch: ein Doppel-Bon zusaetzlich zur Karteileiche.
describe('angekommen, aber nicht ausgelesen', () => {
	it('nimmt den Eintrag aus der Warteschlange und meldet es getrennt von "ausgelesen"', async () => {
		const { enqueueUpload, flushOutbox, pendingCount, describeFlush } = await import('./outbox');
		await enqueueUpload(new Blob(['a'], { type: 'image/webp' }), 'camera', NUTZER);

		const ok = vi.fn(async () => new Response(JSON.stringify({ id: 'r1', queued: false }), { status: 201 }));
		const result = await flushOutbox({ nutzerId: NUTZER, fetchImpl: ok as unknown as typeof fetch });

		expect(result).toEqual({ sent: 0, kept: 0, rejected: 0, stored: 1, fremd: 0 });
		// Entscheidend: NICHT erneut versuchen — sonst entsteht ein Doppel-Bon.
		expect(await pendingCount()).toBe(0);
		expect(describeFlush(result)).toMatch(/nicht angelaufen/);
		expect(describeFlush(result)).not.toMatch(/wird ausgelesen/);
	});
});

// Befund R03: der automatische Hintergrund-Abgleich (onMount/online-Event in
// Scannen.svelte) rief flushOutbox({ nutzerId: NUTZER }) bisher auf und ignorierte das Ergebnis
// vollstaendig — eine endgueltige Ablehnung verschwand spurlos aus der Warteschlange,
// ohne dass der Nutzer je davon erfuhr.
describe('autoSyncMessage', () => {
	it('meldet nichts, wenn die Warteschlange leer war (kein Upload fand statt)', async () => {
		const { autoSyncMessage } = await import('./outbox');
		expect(autoSyncMessage({ sent: 0, kept: 0, rejected: 0, stored: 0, fremd: 0 })).toBeNull();
	});

	it('meldet nichts fuer blossen Erfolg oder "kein Netz" — beides zeigt die Oberflaeche bereits an', async () => {
		const { autoSyncMessage } = await import('./outbox');
		expect(autoSyncMessage({ sent: 1, kept: 0, rejected: 0, stored: 0, fremd: 0 })).toBeNull();
		expect(autoSyncMessage({ sent: 0, kept: 1, rejected: 0, stored: 0, fremd: 0 })).toBeNull();
	});

	// Der Kern des Befunds: eine endgueltige Ablehnung MUSS sichtbar werden.
	it('meldet eine endgueltige Ablehnung deutlich', async () => {
		const { autoSyncMessage } = await import('./outbox');
		const meldung = autoSyncMessage({ sent: 0, kept: 0, rejected: 1, stored: 0, fremd: 0 });
		expect(meldung).toMatch(/abgelehnt|verworfen/);
	});

	it('meldet auch einen angekommenen, aber nicht ausgewerteten Bon', async () => {
		const { autoSyncMessage } = await import('./outbox');
		const meldung = autoSyncMessage({ sent: 0, kept: 0, rejected: 0, stored: 1, fremd: 0 });
		expect(meldung).toMatch(/nicht angelaufen/);
	});
});

/*
 * Bewertung 25.09.2026: tx() meldete Erfolg, sobald die EINZELANFRAGE durch war — nicht,
 * wenn die Transaktion abgeschlossen ist. Bricht sie danach noch ab (Speicher voll, ein
 * Konflikt, der Browser raeumt auf), stand in der Oberflaeche „sicher gespeichert" fuer
 * ein Foto, das es nicht gibt. Nachgestellt mit einer zweiten Anfrage, die an einem
 * doppelten Schluessel scheitert und damit die ganze Transaktion verwirft.
 */
describe('tx', () => {
	beforeEach(async () => {
		await resetDb();
		vi.resetModules();
	});

	it('meldet erst Erfolg, wenn die Transaktion wirklich abgeschlossen ist', async () => {
		const { tx } = await import('./outbox');
		await tx('readwrite', (store) => store.add({ id: 1, probe: 'erster' }));
		await expect(
			tx('readwrite', (store) => {
				const gelingt = store.add({ id: 2, probe: 'zweiter' });
				store.add({ id: 1, probe: 'doppelt' }); // ConstraintError → Abbruch
				return gelingt;
			})
		).rejects.toBeTruthy();
		// Der Abbruch hat auch den „gelungenen" Eintrag verworfen.
		expect(await tx('readonly', (store) => store.count())).toBe(1);
	});

	it('liefert das Ergebnis der Anfrage, wenn alles abgeschlossen ist', async () => {
		const { tx } = await import('./outbox');
		expect(await tx('readwrite', (store) => store.add({ id: 7, probe: 'x' }))).toBe(7);
	});

	it('schliesst die Verbindung auch, wenn die Anfrage sofort wirft', async () => {
		const { tx } = await import('./outbox');
		await expect(
			tx('readwrite', () => {
				throw new Error('QuotaExceededError');
			})
		).rejects.toThrow('QuotaExceededError');
		// Bliebe die Verbindung offen, meldete deleteDatabase „blocked" statt Erfolg.
		const ausgang = await new Promise<string>((fertig) => {
			const req = indexedDB.deleteDatabase('bon-outbox');
			req.onsuccess = () => fertig('geloescht');
			req.onblocked = () => fertig('blockiert');
		});
		expect(ausgang).toBe('geloescht');
	});
});
