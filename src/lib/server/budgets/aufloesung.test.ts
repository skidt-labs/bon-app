import { describe, it, expect } from 'vitest';
import { budgetsFuerMonat } from './aufloesung';

const KATEGORIEN = [
	{ id: 'haushalt', parentId: null },
	{ id: 'reinigung', parentId: 'haushalt' },
	{ id: 'papier', parentId: 'haushalt' },
	{ id: 'lebensmittel', parentId: null },
	{ id: 'brot', parentId: 'lebensmittel' }
];

// Die Sichtbarkeit reicht budgetsFuerMonat nur durch — fuer die Aufloesung selbst spielt
// sie keine Rolle. Vorgabe hier 'geteilt', wie beim Anlegen eines Topfs.
const topf = (id: string, name = id, sichtbarkeit: 'geteilt' | 'privat' = 'geteilt') => ({
	id,
	name,
	sichtbarkeit
});
const betrag = (budgetId: string, giltAb: string, amountCents: number) => ({
	budgetId,
	giltAb,
	amountCents
});
// Vorgabe `null` fuer den Eigentuemer = die Zuordnung eines GETEILTEN Topfs. Die
// Bereichstrennung hat einen eigenen Test weiter unten; die bestehenden Faelle spielen
// alle im gemeinsamen Bereich und sollen das auch weiterhin tun.
const zu = (
	budgetId: string,
	categoryId: string,
	giltAb: string,
	giltBis: string | null = null,
	eigentuemerId: string | null = null
) => ({
	budgetId,
	categoryId,
	giltAb,
	giltBis,
	eigentuemerId
});

describe('budgetsFuerMonat', () => {
	it('legt ohne Toepfe alles nach ausserhalb — und behauptet keinen Betrag', () => {
		const r = budgetsFuerMonat([], [], [], KATEGORIEN, '2026-09');
		expect(r.budgets).toEqual([]);
		expect(r.ausserhalb.sort()).toEqual(['brot', 'haushalt', 'lebensmittel', 'papier', 'reinigung']);
	});

	// „Gilt ab" heisst: der letzte Betrag, der am Monatsersten schon galt. Ein Betrag, der
	// erst im Oktober beginnt, darf den September nicht rueckwirkend teurer machen.
	it('nimmt je Monat den Betrag, der an dessen Erstem galt', () => {
		const b = [betrag('t1', '2026-01-01', 20000), betrag('t1', '2026-10-01', 25000)];
		expect(budgetsFuerMonat([topf('t1')], b, [], KATEGORIEN, '2026-09').budgets[0].betragCents).toBe(20000);
		expect(budgetsFuerMonat([topf('t1')], b, [], KATEGORIEN, '2026-10').budgets[0].betragCents).toBe(25000);
	});

	// Kein Betrag fuer diesen Monat ist eine Leerstelle, keine Null: ein Topf ohne
	// festgelegten Betrag hat keinen Betrag — er hat nicht null Euro.
	it('meldet null, wenn fuer den Monat noch kein Betrag festgelegt ist', () => {
		const r = budgetsFuerMonat([topf('t1')], [betrag('t1', '2026-10-01', 25000)], [], KATEGORIEN, '2026-09');
		expect(r.budgets[0].betragCents).toBeNull();
	});

	it('nimmt nur Zuordnungen, die am Monatsersten liefen', () => {
		const z = [zu('t1', 'brot', '2026-09-01', '2026-09-30'), zu('t2', 'brot', '2026-10-01')];
		const sept = budgetsFuerMonat([topf('t1'), topf('t2')], [], z, KATEGORIEN, '2026-09');
		expect(sept.budgets.find((b) => b.budgetId === 't1')?.kategorieIds).toContain('brot');
		expect(sept.budgets.find((b) => b.budgetId === 't2')?.kategorieIds).not.toContain('brot');
		const okt = budgetsFuerMonat([topf('t1'), topf('t2')], [], z, KATEGORIEN, '2026-10');
		expect(okt.budgets.find((b) => b.budgetId === 't1')?.kategorieIds).not.toContain('brot');
		expect(okt.budgets.find((b) => b.budgetId === 't2')?.kategorieIds).toContain('brot');
	});

	// Nimmt ein Topf die Oberkategorie, gelten deren Unterkategorien mit.
	it('zieht die Unterkategorien mit, wenn die Oberkategorie zugeordnet ist', () => {
		const r = budgetsFuerMonat(
			[topf('t1')],
			[],
			[zu('t1', 'haushalt', '2026-01-01')],
			KATEGORIEN,
			'2026-09'
		);
		expect(r.budgets[0].kategorieIds.sort()).toEqual(['haushalt', 'papier', 'reinigung']);
		expect(r.ausserhalb.sort()).toEqual(['brot', 'lebensmittel']);
	});

	// Der Kern der Regel: der GENAUERE Eintrag gewinnt. „Reinigung" steht ausdruecklich in
	// einem anderen Topf und bleibt dort, obwohl die Oberkategorie anders vergeben ist.
	it('laesst die eigene Zuordnung einer Unterkategorie die der Oberkategorie schlagen', () => {
		const r = budgetsFuerMonat(
			[topf('t1'), topf('t2')],
			[],
			[zu('t1', 'haushalt', '2026-01-01'), zu('t2', 'reinigung', '2026-01-01')],
			KATEGORIEN,
			'2026-09'
		);
		expect(r.budgets.find((b) => b.budgetId === 't1')?.kategorieIds.sort()).toEqual([
			'haushalt',
			'papier'
		]);
		expect(r.budgets.find((b) => b.budgetId === 't2')?.kategorieIds).toEqual(['reinigung']);
	});

	it('meldet alles Unzugeordnete als ausserhalb', () => {
		const r = budgetsFuerMonat([topf('t1')], [], [zu('t1', 'brot', '2026-01-01')], KATEGORIEN, '2026-09');
		expect(r.ausserhalb.sort()).toEqual(['haushalt', 'lebensmittel', 'papier', 'reinigung']);
	});

	// Ein geloeschter Topf hat nur beendete Zuordnungen. Er verschwindet NICHT aus der
	// Liste — die Rechnung stellt dar, was ist, und der Aufrufer entscheidet, was er
	// zeigt. Fuer einen vergangenen Monat traegt er seine Kategorien weiterhin.
	it('gibt einen Topf ohne laufende Zuordnung mit leerer Liste zurueck', () => {
		const z = [zu('t1', 'brot', '2026-01-01', '2026-08-31')];
		const r = budgetsFuerMonat([topf('t1')], [], z, KATEGORIEN, '2026-09');
		expect(r.budgets[0].kategorieIds).toEqual([]);
		expect(budgetsFuerMonat([topf('t1')], [], z, KATEGORIEN, '2026-08').budgets[0].kategorieIds).toEqual(['brot']);
	});

	it('ordnet die Toepfe nach Namen, damit die Liste nicht springt', () => {
		const r = budgetsFuerMonat([topf('t1', 'Zucker'), topf('t2', 'Ärzte')], [], [], KATEGORIEN, '2026-09');
		expect(r.budgets.map((b) => b.name)).toEqual(['Ärzte', 'Zucker']);
	});

	it('gibt bei unbrauchbarem Monat nichts vor, statt zu raten', () => {
		const r = budgetsFuerMonat([topf('t1')], [betrag('t1', '2026-01-01', 100)], [], KATEGORIEN, 'quatsch');
		expect(r.budgets[0].betragCents).toBeNull();
		expect(r.ausserhalb).toHaveLength(KATEGORIEN.length);
	});

	it('haelt gemeinsame und private Zuordnungen derselben Kategorie auseinander (R20)', () => {
		// Ein gemeinsamer Topf und ein privater fuehren dieselbe Kategorie. Der
		// Unique-Index erlaubt das seit Aufgabe 6 ausdruecklich — die Aufloesung benutzte
		// aber EINE flache Zuordnung Kategorie→Topf, und dort gewann schlicht die zuletzt
		// gelesene Zeile. Der jeweils andere Topf stand dann auf null.
		const toepfe = [topf('gemeinsam'), topf('privat', 'privat', 'privat')];
		const zuordnungen = [
			zu('gemeinsam', 'brot', '2026-01-01'),
			zu('privat', 'brot', '2026-01-01', null, 'person-a')
		];

		const r = budgetsFuerMonat(toepfe, [], zuordnungen, KATEGORIEN, '2026-09');
		expect(r.budgets.find((b) => b.budgetId === 'gemeinsam')?.kategorieIds).toContain('brot');
		expect(r.budgets.find((b) => b.budgetId === 'privat')?.kategorieIds).toContain('brot');

		// Und unabhaengig von der Reihenfolge der Zeilen — die Datenbank garantiert keine.
		const andersherum = budgetsFuerMonat(toepfe, [], [...zuordnungen].reverse(), KATEGORIEN, '2026-09');
		expect(andersherum.budgets.find((b) => b.budgetId === 'gemeinsam')?.kategorieIds).toContain('brot');
		expect(andersherum.budgets.find((b) => b.budgetId === 'privat')?.kategorieIds).toContain('brot');

		// „Ausserhalb" zaehlt eine Kategorie nicht mit, die in EINEM Bereich gefuehrt wird.
		expect(r.ausserhalb).not.toContain('brot');
	});
});
