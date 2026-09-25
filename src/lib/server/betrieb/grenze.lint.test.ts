import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * „Der Eigentuemer verwaltet. Er sieht nicht hinein."
 *
 * Das ist eine Zusicherung, die man vergisst — spaetestens bei der naechsten Funktion,
 * die jemand auf der Betriebsseite braucht („nur schnell die letzten Bons anzeigen").
 * Ein Test ist es nicht. Dasselbe Muster wie tor.lint.test.ts, aus demselben Grund.
 */

const lies = (pfad: string) => readFileSync(pfad, 'utf8');
const dateienIn = (ordner: string) =>
	readdirSync(ordner, { recursive: true, encoding: 'utf8' })
		.filter((d) => d.endsWith('.ts') && !d.includes('.test.'))
		.map((d) => join(ordner, d));

describe('Die Grenze der Betreiberrolle', () => {
	it('laesst die Rolle nicht in die Sichtbarkeitsschicht', () => {
		// Taucht istBetreiber dort auf, waere der Betreiber auf einmal jemand, der MEHR
		// sieht — und der ganze Berechtigungsentwurf eine Beschriftung ohne Wirkung.
		const suender = dateienIn('src/lib/server/zugriff').filter((d) =>
			/istBetreiber/.test(lies(d))
		);
		expect(suender).toEqual([]);
	});

	it('laesst die Betriebsseite keine Inhaltstabellen anfassen', () => {
		// `receipts` ist erlaubt — aber nur zum ZAEHLEN, siehe naechster Fall.
		const VERBOTEN = [
			'receiptItems',
			'budgets',
			'budgetBetraege',
			'budgetKategorien',
			'products',
			'productAliases',
			'merchants',
			'extractionRuns'
		];
		const suender: string[] = [];
		for (const d of dateienIn('src/lib/server/betrieb')) {
			const text = lies(d);
			const importe = text.match(/import\s*\{([^}]*)\}\s*from\s*'\$lib\/server\/db\/schema'/s);
			if (!importe) continue;
			const namen = importe[1].split(',').map((x) => x.trim().replace(/^type\s+/, ''));
			const treffer = namen.filter((x) => VERBOTEN.includes(x));
			if (treffer.length) suender.push(`${d}: ${treffer.join(', ')}`);
		}
		expect(suender).toEqual([]);
	});

	it('liest aus receipts ausschliesslich die Haushaltsspalte', () => {
		/*
		 * Die schaerfere Haelfte: `receipts` zu importieren ist erlaubt, weil die
		 * Uebersicht Bons ZAEHLEN muss. Sobald aber eine andere Spalte gelesen wird —
		 * totalGrossCents, merchantNameRaw, imagePath —, ist es kein Zaehlerstand mehr,
		 * sondern Inhalt. Dass ein Haushalt 340 Bons hat, darf der Betreiber wissen; was
		 * darauf steht, geht ihn nichts an.
		 */
		const erlaubt = new Set(['householdId']);
		const suender: string[] = [];
		for (const d of dateienIn('src/lib/server/betrieb')) {
			for (const treffer of lies(d).matchAll(/\breceipts\.(\w+)/g)) {
				if (!erlaubt.has(treffer[1])) suender.push(`${d}: receipts.${treffer[1]}`);
			}
		}
		expect(suender).toEqual([]);
	});
});
