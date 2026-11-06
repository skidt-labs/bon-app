import { describe, it, expect } from 'vitest';
import { Verlauf, istTextfeld, strgZ, wiederherstellen, type Stand } from './verlauf';
import { zeileLoeschen, type EditorZeile } from './editor';

const zeile = (id: string | null, lineNo: number, rawText = 'MILCH'): EditorZeile => ({
	id,
	lineNo,
	rawText,
	lineType: 'article',
	quantity: '1',
	unit: 'stk',
	unitPriceCents: 109,
	totalPriceCents: 109,
	vatClass: null,
	appliesToLine: null,
	categoryId: null,
	ocrZeile: null
});
const kopf = { merchantNameRaw: 'Laden', purchasedAt: null, totalGrossCents: 218, paymentMethod: null, privatBehalten: false };
const stand = (zeilen: EditorZeile[], geloescht: string[] = []): Stand => ({ zeilen, kopf: { ...kopf }, geloescht });

describe('Verlauf', () => {
	it('merken und zurueck ergibt denselben Stand samt Beschreibung', () => {
		const v = new Verlauf();
		const s = stand([zeile('a', 1), zeile('b', 2)]);
		v.merken(s, 'Zeile 2 gelöscht');
		expect(v.kannZurueck).toBe(true);
		expect(v.zurueck()).toEqual({ stand: s, beschreibung: 'Zeile 2 gelöscht' });
		expect(v.kannZurueck).toBe(false);
		expect(v.zurueck()).toBeNull();
	});

	it('der gemerkte Stand ist eine Kopie — spaetere Aenderungen erreichen ihn nicht', () => {
		const v = new Verlauf();
		const s = stand([zeile('a', 1)]);
		v.merken(s, 'x');
		s.zeilen[0].rawText = 'GEAENDERT';
		s.kopf.merchantNameRaw = 'anders';
		const r = v.zurueck()!;
		expect(r.stand.zeilen[0].rawText).toBe('MILCH');
		expect(r.stand.kopf.merchantNameRaw).toBe('Laden');
	});

	it('juengster zuerst', () => {
		const v = new Verlauf();
		v.merken(stand([zeile('a', 1, 'EINS')]), 'eins');
		v.merken(stand([zeile('a', 1, 'ZWEI')]), 'zwei');
		expect(v.zurueck()?.beschreibung).toBe('zwei');
		expect(v.zurueck()?.beschreibung).toBe('eins');
	});

	it('haelt hoechstens die Grenze, der aelteste faellt heraus', () => {
		const v = new Verlauf(3);
		for (let i = 1; i <= 5; i++) v.merken(stand([]), `s${i}`);
		expect([v.zurueck()?.beschreibung, v.zurueck()?.beschreibung, v.zurueck()?.beschreibung, v.zurueck()]).toEqual(['s5', 's4', 's3', null]);
	});

	it('Standardgrenze 50', () => {
		const v = new Verlauf();
		for (let i = 0; i < 60; i++) v.merken(stand([]), `s${i}`);
		let n = 0;
		while (v.zurueck()) n++;
		expect(n).toBe(50);
	});

	it('feldBesuch: nur der erste Aufruf je Feld und Besuch zaehlt', () => {
		const v = new Verlauf();
		expect(v.feldBesuch('a')).toBe(true);
		expect(v.feldBesuch('a')).toBe(false);
		expect(v.feldBesuch('b')).toBe(true);
		v.feldVerlassen();
		expect(v.feldBesuch('a')).toBe(true);
	});

	it('leeren', () => {
		const v = new Verlauf();
		v.merken(stand([]), 'x');
		v.leeren();
		expect(v.kannZurueck).toBe(false);
		expect(v.anzahl).toBe(0);
	});

	// Review Focus 1: sonst loeschte der Server eine Zeile, die wieder zu sehen ist.
	it('Loeschen einer gespeicherten Zeile zuruecknehmen bringt Zeile UND leeres geloescht zurueck', () => {
		const v = new Verlauf();
		const vorher = stand([zeile('a', 1), zeile('b', 2)]);
		v.merken(vorher, 'Zeile 2 gelöscht');
		const r = zeileLoeschen(vorher.zeilen, 1);
		expect(r.geloescht).toEqual(['b']);
		const zurueck = v.zurueck()!.stand;
		expect(zurueck.geloescht).toEqual([]);
		expect(zurueck.zeilen.map((z) => z.id)).toEqual(['a', 'b']);
	});
});

describe('istTextfeld', () => {
	const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as Element;
	it('Eingabefelder, Textbereiche, Auswahl, bearbeitbare Bereiche', () => {
		expect(istTextfeld(el('INPUT', { type: 'text' }))).toBe(true);
		expect(istTextfeld(el('INPUT', { type: 'number' }))).toBe(true);
		expect(istTextfeld(el('TEXTAREA'))).toBe(true);
		expect(istTextfeld(el('SELECT'))).toBe(true);
		expect(istTextfeld(el('DIV', { isContentEditable: true }))).toBe(true);
	});
	it('Knoepfe, Haken und der Rest nicht', () => {
		expect(istTextfeld(el('INPUT', { type: 'checkbox' }))).toBe(false);
		expect(istTextfeld(el('INPUT', { type: 'button' }))).toBe(false);
		expect(istTextfeld(el('BUTTON'))).toBe(false);
		expect(istTextfeld(el('BODY'))).toBe(false);
		expect(istTextfeld(null)).toBe(false);
	});
});

// Abschlusspruefung 0.13.0, I1: der Schalter „privat behalten“ ist kein Schritt im Verlauf —
// Rueckgaengig darf ihn nicht still zuruecksetzen (sonst teilt das naechste Bestaetigen).
describe('wiederherstellen', () => {
	it('nimmt den gemerkten Stand, behaelt aber den jetzigen Schalter', () => {
		const gemerkt = stand([zeile('a', 1)]);
		const r = wiederherstellen(gemerkt, { ...kopf, merchantNameRaw: 'anders', privatBehalten: true });
		expect(r.kopf.privatBehalten).toBe(true);
		expect(r.kopf.merchantNameRaw).toBe('Laden');
		expect(r.zeilen).toEqual(gemerkt.zeilen);
	});
});

// Abschlusspruefung 0.13.0 (Minor 4, hochgestuft): kein Rueckgaengig hinter einem offenen Dialog —
// sonst nahm Strg+Z hinter „Nicht gespeichert“ das Leeren eines Bezugs zurueck, und
// „Meine Fassung speichern“ endete in einer 400.
describe('strgZ', () => {
	const taste = { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
	const lage = { offen: true, dialogOffen: false, schritte: 2, imTextfeld: false };
	it('Strg+Z oder ⌘+Z ausserhalb eines Felds', () => {
		expect(strgZ(taste, lage)).toBe(true);
		expect(strgZ({ ...taste, ctrlKey: false, metaKey: true }, lage)).toBe(true);
		expect(strgZ({ ...taste, key: 'Z' }, lage)).toBe(true);
	});
	it('nicht mit Umschalt oder Alt, nicht ohne Strg', () => {
		expect(strgZ({ ...taste, shiftKey: true }, lage)).toBe(false);
		expect(strgZ({ ...taste, altKey: true }, lage)).toBe(false);
		expect(strgZ({ ...taste, ctrlKey: false }, lage)).toBe(false);
	});
	it('nicht im Feld, nicht hinter einem Dialog, nicht ohne Schritte, nicht gesperrt', () => {
		expect(strgZ(taste, { ...lage, imTextfeld: true })).toBe(false);
		expect(strgZ(taste, { ...lage, dialogOffen: true })).toBe(false);
		expect(strgZ(taste, { ...lage, schritte: 0 })).toBe(false);
		expect(strgZ(taste, { ...lage, offen: false })).toBe(false);
	});
});
