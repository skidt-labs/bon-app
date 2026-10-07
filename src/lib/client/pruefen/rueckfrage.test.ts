import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nachKorbFehler } from './rueckfrage';

/*
 * Pruefansicht, Papierkorb-Aktion gescheitert (1.6, 2.3). Aus der Rueckfrage heraus steht der
 * Fehler IN ihr, und sie bleibt offen — vorher schloss sie, und der Satz stand unten ausser
 * Sicht. Antwortet der Server mit brauchtRueckfrage (der Bon wurde in einem anderen Tab
 * bestaetigt), laedt die Seite neu: erst dann schickt der naechste Klick bestaetigtWegnehmen.
 */
describe('nachKorbFehler', () => {
	it('aus der Rueckfrage: der Fehler steht in ihr, unten keine Meldung', () => {
		expect(nachKorbFehler({ meldung: 'Das hat nicht geklappt (HTTP 500).' }, true)).toEqual({
			rueckfrageFehler: 'Das hat nicht geklappt (HTTP 500).',
			meldung: '',
			neuLaden: false
		});
	});

	it('ohne Rueckfrage (Wiederherstellen): unten als Meldung', () => {
		expect(nachKorbFehler({ meldung: 'Keine Verbindung — bitte später noch einmal versuchen.' }, false)).toEqual({
			rueckfrageFehler: '',
			meldung: 'Keine Verbindung — bitte später noch einmal versuchen.',
			neuLaden: false
		});
	});

	it('brauchtRueckfrage (Tab veraltet): Satz in der Rueckfrage und neu laden', () => {
		const satz =
			'Dieser Bon ist bestätigt und zählt in Berichten und Budgets. Im Papierkorb zählt er nicht mehr — wirklich verwerfen?';
		expect(nachKorbFehler({ meldung: satz, brauchtRueckfrage: true }, true)).toEqual({
			rueckfrageFehler: satz,
			meldung: '',
			neuLaden: true
		});
	});
});

// Abschlusspruefung 0.11.0: Nach brauchtRueckfrage laedt die Seite neu — der Bon ist inzwischen
// bestaetigt, womoeglich mit Korrekturen aus dem anderen Tab. kopieSchluessel ist fuer review und
// confirmed gleich, der Kopie-Effekt baute darum nicht neu: Kopf und Zeilen blieben auf dem alten
// Stand, und ein spaeteres Speichern haette die Korrekturen ueberschrieben.
describe('Pruefen.svelte nach brauchtRueckfrage', () => {
	it('baut die Kopie aus den neu geladenen Daten', () => {
		const quelle = readFileSync('src/lib/client/pruefen/Pruefen.svelte', 'utf8');
		expect(quelle).toMatch(/if \(f\.neuLaden\) \{\s*await invalidateAll\(\);(?:\s*\/\/[^\n]*)*\s*angezeigt = '';\s*\}/);
	});
});
