import { describe, it, expect } from 'vitest';
import {
	groupForReview,
	findRenumberedItemId,
	hasBrokenReference,
	describeProblem,
	type ReviewItem
} from './grouping';

const items = [
	{ id: 'a', lineNo: 1, rawText: 'MILCH', lineType: 'article', totalPriceCents: 109, corrected: false },
	{ id: 'b', lineNo: 2, rawText: 'UNBEKANNT', lineType: 'article', totalPriceCents: 0, corrected: false },
	{ id: 'c', lineNo: 3, rawText: 'PFAND', lineType: 'deposit', totalPriceCents: 25, corrected: false },
	{ id: 'd', lineNo: 4, rawText: 'KASSE 3', lineType: 'info', totalPriceCents: 0, corrected: false }
];

describe('groupForReview', () => {
	it('hebt Artikelzeilen ohne Preis nach oben', () => {
		const { problems } = groupForReview(items);
		expect(problems.map((i) => i.id)).toEqual(['b']);
	});
	it('lässt Infozeilen unangetastet unten', () => {
		const { rest } = groupForReview(items);
		expect(rest.map((i) => i.id)).toEqual(['a', 'c', 'd']);
	});
	it('behält die Bon-Reihenfolge bei', () => {
		const { rest } = groupForReview(items);
		expect(rest.map((i) => i.lineNo)).toEqual([1, 3, 4]);
	});
});

// Ruling 58: eine Zeile, die Task 11 wegen einer doppelt vergebenen lineNo umnummeriert
// hat, landet nach naiver Sortierung unmarkiert am Ende der Liste. Simuliert hier einen
// Bon mit 18 Original-Positionen, von denen eine (lineNo 5) doppelt gelesen wurde: die
// zweite Instanz bekam beim Insert die Nummer 19 (nächste freie Zahl oberhalb des
// Original-Maximums 18) — siehe sanitizeItemsForInsert in src/worker/extract-receipt.ts.
function renumberedFixture(): ReviewItem[] {
	const rows: ReviewItem[] = [];
	for (let n = 1; n <= 18; n++) {
		rows.push({
			id: `line-${n}`,
			lineNo: n,
			rawText: n === 5 ? 'JOGHURT' : `ARTIKEL ${n}`,
			lineType: 'article',
			totalPriceCents: 100 + n,
			corrected: false
		});
	}
	// Die vom Modell doppelt gelesene Zeile 5 landet nach der Umnummerierung auf 19 —
	// inhaltlich gehört sie direkt neben "JOGHURT" (lineNo 5), nicht ans Ende.
	rows.push({
		id: 'line-5-dup',
		lineNo: 19,
		rawText: 'JOGHURT',
		lineType: 'article',
		totalPriceCents: 105,
		corrected: false
	});
	return rows;
}

describe('findRenumberedItemId (Ruling 58)', () => {
	it('erkennt die Zeile mit der höchsten lineNo als umnummeriert, wenn der Bon duplicate_line_no meldet', () => {
		const id = findRenumberedItemId(renumberedFixture(), ['duplicate_line_no']);
		expect(id).toBe('line-5-dup');
	});

	it('meldet nichts, wenn duplicate_line_no gar nicht im Bon steht — auch wenn eine Zeile zufällig die höchste Nummer hat', () => {
		const id = findRenumberedItemId(renumberedFixture(), ['sum_mismatch']);
		expect(id).toBeNull();
	});

	it('meldet nichts bei needsReviewReason = null (kein Beanstandungscode je erzeugt)', () => {
		const id = findRenumberedItemId(renumberedFixture(), null);
		expect(id).toBeNull();
	});

	it('meldet nichts bei leerer Positionsliste', () => {
		const id = findRenumberedItemId([], ['duplicate_line_no']);
		expect(id).toBeNull();
	});
});

describe('hasBrokenReference', () => {
	const withReferences: ReviewItem[] = [
		{ id: 'a', lineNo: 1, rawText: 'MILCH', lineType: 'article', totalPriceCents: 109, corrected: false },
		{
			id: 'b',
			lineNo: 2,
			rawText: 'RABATT',
			lineType: 'discount',
			totalPriceCents: -50,
			corrected: false,
			appliesToLine: 1
		},
		{
			id: 'c',
			lineNo: 3,
			rawText: 'RABATT UNKLAR',
			lineType: 'discount',
			totalPriceCents: -30,
			corrected: false,
			appliesToLine: 99
		}
	];

	it('ist false ohne appliesToLine', () => {
		expect(hasBrokenReference(withReferences[0], withReferences)).toBe(false);
	});

	it('ist false, wenn die referenzierte lineNo existiert', () => {
		expect(hasBrokenReference(withReferences[1], withReferences)).toBe(false);
	});

	it('ist true, wenn die referenzierte lineNo unter den geladenen Positionen fehlt', () => {
		expect(hasBrokenReference(withReferences[2], withReferences)).toBe(true);
	});
});

describe('describeProblem', () => {
	it('übersetzt bekannte Codes ins Deutsche', () => {
		expect(describeProblem('sum_mismatch')).toBe('Summe stimmt nicht mit dem Bon überein');
	});

	// Aufgabe 3 (Entwurf E7a): eine fehlende Endsumme braucht einen eigenen, lesbaren Text.
	it('übersetzt missing_total', () => {
		expect(describeProblem('missing_total')).toBe('Keine Endsumme gelesen');
	});

	it('fällt bei unbekannten Codes auf den rohen Code zurück, statt ihn verschwinden zu lassen', () => {
		expect(describeProblem('irgendein_neuer_code')).toBe('irgendein_neuer_code');
	});
});
