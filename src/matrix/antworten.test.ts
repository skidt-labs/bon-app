import { describe, it, expect } from 'vitest';
import { antwortFuer } from './antworten';

describe('Antwort an den Nutzer', () => {
	// Erfolg braucht keinen Text — dafür gibt es die Reaktion. Alles andere schon,
	// weil eine Reaktion im Fehlerfall zu leicht übersehen wird.
	// Stand frueher auf "schweigt bei Erfolg, die Reaktion genuegt". Im echten Betrieb
	// am 2026-09-15 stellte sich heraus: Die Reaktion annotiert das Bildereignis, und
	// genau dieses loescht der Bot unmittelbar danach (E6). Element zeigt eine Reaktion
	// auf ein geloeschtes Ereignis nicht an — der Nutzer sah im ERFOLGSFALL nichts,
	// waehrend sein Foto verschwand. Die Bestaetigung muss die Loeschung ueberleben.
	it('bestaetigt den Erfolg als Text, der die Loeschung des Bildes ueberlebt', () => {
		const a = antwortFuer({ art: 'aufgenommen', receiptId: 'r1' });
		expect(a.text).toBeTruthy();
		// Der Haken macht die Erfolgsmeldung im Chatverlauf auf einen Blick erkennbar,
		// ohne dass man den Satz lesen muss — auf Wunsch des Betreibers.
		expect(a.text).toContain('✅');
		expect(a.alarm).toBe(false);
		// Keine Ergebnis-Zusammenfassung: der Bot rechnet nichts vor (Entwurf,
		// Abschnitt "Nicht dafuer"). Nur die Ankunft wird bestaetigt.
		expect(a.text).not.toMatch(/\d+[,.]\d{2}|EUR|€/);
	});

	// M4 (Korrekturrunde 3, Ruling-Umkehr): stand vorher auf `text: null` — richtig
	// für den Regelfall (Nutzer hat die Bestätigung beim ersten Mal schon gesehen),
	// aber falsch für den Fall, in dem der erste Durchlauf VOR der Antwort
	// abgebrochen ist (M1: SIGKILL; W5: Senden der Bestätigung scheitert selbst) —
	// dann bekam der Nutzer bisher auch beim Wiederholungsdurchlauf nichts, obwohl
	// der Bon längst existiert. Lärm (doppelte Bestätigung) ist der billigere Fehler
	// als Schweigen nach einem echten Verlust.
	it('bestätigt ein schon bekanntes Ereignis genauso wie ein neu aufgenommenes', () => {
		expect(antwortFuer({ art: 'schon_bekannt', receiptId: 'r1' })).toEqual(
			antwortFuer({ art: 'aufgenommen', receiptId: 'r1' })
		);
		expect(antwortFuer({ art: 'schon_bekannt', receiptId: 'r1' }).text).toBeTruthy();
	});

	// Ein Bot, der Fremde stumm ignoriert, sieht für den Betroffenen genauso aus wie
	// ein kaputter Bot.
	it('sagt einem Unbekannten, was er tun muss', () => {
		const a = antwortFuer({ art: 'nicht_gekoppelt' });
		expect(a.text).toMatch(/Kopplungscode/);
		expect(a.alarm).toBe(false);
	});

	it('nennt bei einem zu grossen Bild die Grenze in Megabyte', () => {
		const a = antwortFuer({ art: 'zu_gross', bytes: 30 * 1024 * 1024, grenze: 25 * 1024 * 1024 });
		expect(a.text).toMatch(/25 MB/);
	});

	// Entwurf E4: der Betreiber kann einem Bild nicht ansehen, dass Element es
	// kaputtkomprimiert hat — der Text muss den KONKRETEN Ausweg nennen, nicht nur warnen.
	it('nennt bei einem zu schmalen Bild die Breite und den konkreten Ausweg', () => {
		const a = antwortFuer({ art: 'aufgenommen_zu_klein', receiptId: 'r1', breite: 297 });
		expect(a.text).toContain('297');
		expect(a.text).toMatch(/Datei-Symbol/);
		expect(a.alarm).toBe(false);
	});

	it('sagt bei einem unbrauchbaren Bild, dass kein Bon entstanden ist', () => {
		const a = antwortFuer({ art: 'kein_bild', grund: 'unsupported image format' });
		expect(a.text).toMatch(/kein Bon/i);
	});

	// Der Bon EXISTIERT. Das muss die Antwort sagen, sonst schickt der Nutzer das Foto
	// noch einmal und erzeugt einen Doppel-Bon.
	it('sagt beim fehlgeschlagenen Einreihen, dass der Bon da ist', () => {
		const a = antwortFuer({ art: 'nicht_eingereiht', receiptId: 'r1', grund: 'pg-boss weg' });
		expect(a.text).toMatch(/Posteingang/);
		expect(a.text).not.toMatch(/noch einmal|erneut schicken/i);
	});

	// W3 (Korrekturrunde 2): "Er steht im Posteingang als fehlgeschlagen" behauptete
	// einen Status, den `ingest.ts` nur best-effort setzt (`markiereFehlgeschlagen`
	// selbst kann scheitern). Der Text darf keinen konkreten Status mehr zusichern,
	// nur dass der Bon da ist und im Posteingang nachzusehen ist.
	it('behauptet beim fehlgeschlagenen Einreihen keinen konkreten Status', () => {
		const a = antwortFuer({ art: 'nicht_eingereiht', receiptId: 'r1', grund: 'pg-boss weg' });
		expect(a.text).not.toMatch(/als fehlgeschlagen/i);
	});

	it('schlägt bei einem echten Fehler Alarm', () => {
		expect(antwortFuer({ art: 'fehler', grund: 'Verbindung weg' }).alarm).toBe(true);
	});

	// Der technische Grund darf dem Nutzer nicht ins Gesicht fliegen: er kann
	// Endpunkte, Pfade oder Konfiguration nennen.
	it('gibt den technischen Grund nicht an den Nutzer weiter', () => {
		const a = antwortFuer({ art: 'fehler', grund: 'connect ECONNREFUSED 10.0.0.5:5432' });
		expect(a.text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
	});

	// W1 (Korrekturrunde 2, dritte Instanz des Musters "falsche Rückmeldung erzeugt
	// den Doppel-Bon"): `ingest.ts` kommentiert an jeder Stelle, die zu 'fehler'
	// führt, ausdrücklich "wir wissen es gerade nicht" — der Bon KANN bereits
	// existieren (nur die Antwort ging verloren). "Der Bon wurde nicht gespeichert"
	// wäre eine Zusicherung, die dem widerspricht, und lud zum erneuten Schicken
	// ein — mit neuer Ereignis-ID, also einem Doppel-Bon.
	it('behauptet bei einem echten Fehler NICHT, dass der Bon nicht gespeichert wurde', () => {
		const a = antwortFuer({ art: 'fehler', grund: 'Verbindung weg' });
		expect(a.text).not.toMatch(/nicht gespeichert/i);
		expect(a.text).not.toMatch(/noch einmal versuchen|bitte.*versuch/i);
		expect(a.text).toMatch(/Posteingang/);
	});
});
