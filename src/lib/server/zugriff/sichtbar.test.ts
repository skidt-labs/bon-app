import { describe, it, expect } from 'vitest';
import { kontextAus, darfGeteiltesVerwalten, darfTopfAendern } from './kontext';
import { sichtbareBons, sichtbareToepfe } from './sichtbar';
import { db } from '$lib/server/db';
import { receipts, budgets } from '$lib/server/db/schema';
import type { Zugriffskontext } from './kontext';

/**
 * Macht aus einer Bedingung das SQL, das Postgres saehe — ohne Datenbank.
 * `toSQL()` baut die Abfrage nur auf, es verbindet sich nicht.
 *
 * Die Auswahl ist ABSICHTLICH auf eine Spalte beschraenkt: `db.select()` ohne Liste
 * waehlt alle Spalten, dann stuenden `sichtbarkeit` und `uploaded_by` schon in der
 * SELECT-Liste und jede Pruefung darauf waere blind gruen — egal, was die Bedingung tut.
 * So kann ein Treffer nur aus dem WHERE stammen.
 */
function alsSql(bedingung: ReturnType<typeof sichtbareBons>): string {
	return db.select({ id: receipts.id }).from(receipts).where(bedingung).toSQL().sql;
}

const verwalter = { id: 'u1', oidcSub: 'sub-u1', email: 'a@b.c', displayName: 'A', householdId: 'h1', rolle: 'verwalter' as const };
const mitglied = { ...verwalter, id: 'u2', rolle: 'mitglied' as const };

describe('kontextAus', () => {
	it('uebernimmt Haushalt, Nutzer und Rolle', () => {
		expect(kontextAus(verwalter)).toEqual({ haushaltId: 'h1', nutzerId: 'u1', rolle: 'verwalter' });
	});
});

describe('darfGeteiltesVerwalten', () => {
	it('gilt fuer den Verwalter', () => {
		expect(darfGeteiltesVerwalten(kontextAus(verwalter))).toBe(true);
	});
	it('gilt nicht fuer ein Mitglied', () => {
		expect(darfGeteiltesVerwalten(kontextAus(mitglied))).toBe(false);
	});
});

describe('sichtbareBons', () => {
	it('filtert auf Haushalt, Sichtbarkeit und Eigentuemer', () => {
		const sql = alsSql(sichtbareBons(kontextAus(mitglied)));
		expect(sql).toContain('household_id');
		expect(sql).toContain('sichtbarkeit');
		expect(sql).toContain('uploaded_by');
	});

	it('gibt dem Verwalter KEINEN weiteren Zugriff als dem Mitglied', () => {
		// Die Kernregel des ganzen Entwurfs. Waeren die beiden Bedingungen verschieden,
		// waere "privat" in einem Haushalt mit Verwalter ein leeres Wort — der Verwalter
		// koennte einfach mitlesen. Beide Kontexte tragen denselben Nutzer und denselben
		// Haushalt; nur die Rolle unterscheidet sie. Das Ergebnis muss identisch sein.
		const alsVerwalter: Zugriffskontext = { haushaltId: 'h1', nutzerId: 'u1', rolle: 'verwalter' };
		const alsMitglied: Zugriffskontext = { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' };
		expect(alsSql(sichtbareBons(alsVerwalter))).toBe(alsSql(sichtbareBons(alsMitglied)));
	});
});

describe('sichtbareToepfe', () => {
	// Dieselbe Beschraenkung auf eine Spalte wie bei alsSql: sonst stuenden
	// 'sichtbarkeit' und 'eigentuemer_id' schon in der SELECT-Liste.
	const alsToepfeSql = (b: ReturnType<typeof sichtbareToepfe>) =>
		db.select({ id: budgets.id }).from(budgets).where(b).toSQL().sql;

	it('filtert auf Haushalt, Sichtbarkeit und Eigentuemer', () => {
		const sql = alsToepfeSql(sichtbareToepfe(kontextAus(mitglied)));
		expect(sql).toContain('household_id');
		expect(sql).toContain('sichtbarkeit');
		expect(sql).toContain('eigentuemer_id');
	});

	it('gibt dem Verwalter KEINEN weiteren Zugriff als dem Mitglied', () => {
		const alsVerwalter: Zugriffskontext = { haushaltId: 'h1', nutzerId: 'u1', rolle: 'verwalter' };
		const alsMitglied: Zugriffskontext = { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' };
		expect(alsToepfeSql(sichtbareToepfe(alsVerwalter))).toBe(
			alsToepfeSql(sichtbareToepfe(alsMitglied))
		);
	});
});

describe('darfTopfAendern', () => {
	const alsVerwalter = kontextAus(verwalter);
	const alsMitglied = kontextAus(mitglied);
	const geteilt = { sichtbarkeit: 'geteilt' as const };
	const privat = { sichtbarkeit: 'privat' as const };

	it('laesst den Verwalter an gemeinsame Toepfe', () => {
		expect(darfTopfAendern(alsVerwalter, geteilt)).toBe(true);
	});

	it('laesst ein Mitglied NICHT an gemeinsame Toepfe', () => {
		// Befund R14: bis 18.09.2026 fehlte diese Pruefung, die Rollenmatrix im Entwurf
		// stand nur auf dem Papier.
		expect(darfTopfAendern(alsMitglied, geteilt)).toBe(false);
	});

	it('laesst ein Mitglied an seinen eigenen privaten Topf', () => {
		// Die Rolle hat bei Privatem nichts zu suchen. Waere es anders, koennte ein
		// Mitglied seine privaten Toepfe nur anschauen, nicht verwalten — dann braeuchte
		// es sie nicht.
		expect(darfTopfAendern(alsMitglied, privat)).toBe(true);
	});

	it('schuetzt fremdes Privates nicht hier, sondern in sichtbareToepfe', () => {
		// Diese Funktion beantwortet nur "was darf ich TUN". Dass ein fremder privater
		// Topf gar nicht erst geladen wird, sichert die Sichtbarkeitsbedingung. Zwei
		// Fragen, zwei Stellen — hier steht der Hinweis, damit niemand die eine fuer die
		// andere haelt.
		expect(darfTopfAendern(alsVerwalter, privat)).toBe(true);
	});
});
