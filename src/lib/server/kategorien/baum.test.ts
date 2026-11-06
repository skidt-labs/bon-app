import { describe, it, expect } from 'vitest';
import {
	KATEGORIEBAUM,
	SONSTIGES_PFAND_SLUG,
	SONSTIGES_RABATT_SLUG,
	SONSTIGES_UNSORTIERT_SLUG,
	ENTFALLENE_SLUGS
} from './baum';

describe('Kategoriebaum', () => {
	// 0.12.0 (Nutzer 06.11.2026): zehn Oberkategorien plus Medikamente (Nachtrag), dazu
	// Freizeit, Tier und Sonstiges.
	it('hat die 14 Oberkategorien aus 0.12.0 in dieser Reihenfolge', () => {
		expect(KATEGORIEBAUM.map((o) => o.name)).toEqual([
			'Lebensmittel',
			'Süßes',
			'Snacks',
			'Hygiene',
			'Baby',
			'Medikamente',
			'Mobilität',
			'Baumarkt',
			'Garten',
			'Kleidung',
			'Technik',
			'Freizeit',
			'Tier',
			'Sonstiges'
		]);
	});

	// Ids und Slugs der Unterkategorien bleiben beim Umhaengen — nur Eltern und Namen
	// aendern sich. Ein neuer Slug wuerde jede gelernte Zuordnung zerreissen.
	it('haengt die bestehenden Unterkategorien um, ohne ihre Slugs zu aendern', () => {
		const eltern = new Map<string, string>();
		const namen = new Map<string, string>();
		for (const o of KATEGORIEBAUM) {
			namen.set(o.slug, o.name);
			for (const k of o.kinder) {
				eltern.set(k.slug, o.slug);
				namen.set(k.slug, k.name);
			}
		}
		for (const s of ['getraenke-wasser', 'getraenke-saefte', 'getraenke-limonaden', 'getraenke-bier', 'getraenke-wein-spirituosen'])
			expect(eltern.get(s), s).toBe('lebensmittel');
		for (const s of ['haushalt-reinigung', 'haushalt-waesche', 'haushalt-papierwaren', 'drogerie-hygiene'])
			expect(eltern.get(s), s).toBe('drogerie');
		expect(eltern.get('haushalt-kuechenbedarf')).toBe('baumarkt-werkzeug');
		expect(eltern.get('buero-schreibwaren')).toBe('elektronik-technik');
		expect(eltern.get('lebensmittel-babynahrung')).toBe('baby');
		expect(eltern.get('drogerie-gesundheit-apotheke')).toBe('medikamente');
		expect(namen.get('medikamente')).toBe('Medikamente');
		expect(namen.get('drogerie-gesundheit-apotheke')).toBe('Gesundheit & Apotheke');
		expect(eltern.get('baby-pflege')).toBe('baby');
		expect(eltern.get('suesses-suessigkeiten')).toBe('suesses');
		expect(eltern.get('snacks-knabberzeug')).toBe('snacks');
		expect(namen.get('drogerie')).toBe('Hygiene');
		expect(namen.get('drogerie-hygiene')).toBe('Hygieneartikel');
		expect(namen.get('baby-pflege')).toBe('Babypflege');
		expect(namen.get('suesses-suessigkeiten')).toBe('Süßigkeiten');
		expect(namen.get('snacks-knabberzeug')).toBe('Knabberzeug');
		expect(namen.get('baumarkt-werkzeug')).toBe('Baumarkt');
		expect(namen.get('garten-pflanzen')).toBe('Garten');
		expect(namen.get('kleidung-schuhe')).toBe('Kleidung');
		expect(namen.get('elektronik-technik')).toBe('Technik');
	});

	it('enthaelt die entfallenen Kategorien nicht mehr', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => [o.slug, ...o.kinder.map((k) => k.slug)]);
		for (const weg of ENTFALLENE_SLUGS) expect(alle, weg).not.toContain(weg);
	});

	it('vergibt jeden slug genau einmal', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => [o.slug, ...o.kinder.map((k) => k.slug)]);
		expect(new Set(alle).size).toBe(alle.length);
	});

	// Die Zweistufigkeit ist laut Entwurf fest. Ein Kind mit eigenen Kindern waere eine
	// dritte Ebene und wuerde jede Auswertung ueber Oberkategorien verfaelschen.
	it('bleibt zweistufig', () => {
		for (const o of KATEGORIEBAUM) {
			for (const k of o.kinder) {
				expect(Object.keys(k).sort(), k.slug).toEqual(['name', 'slug']);
			}
		}
	});

	it('enthaelt den Rueckfall der Kaskade', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => o.kinder.map((k) => k.slug));
		expect(alle).toContain(SONSTIGES_UNSORTIERT_SLUG);
	});

	// Review Aufgabe 5, Befund 1/A: kaskade.ts verlaesst sich fuer Pfand/Leergut und
	// Rabatt auf diese beiden Slugs. Sie sind zwar schon dieselbe Quelle wie der Baum
	// (siehe baum.ts), aber ein Tippfehler an DIESER Stelle (Konstante vs. Blatt im
	// Baum) waere sonst still moeglich — dieser Test faengt genau das.
	it('enthaelt die Pfand- und Rabatt-Zweige der Kaskade', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => o.kinder.map((k) => k.slug));
		expect(alle).toContain(SONSTIGES_PFAND_SLUG);
		expect(alle).toContain(SONSTIGES_RABATT_SLUG);
	});

	// Slugs landen in Migrationen und im Prompt. Umlaute und Leerzeichen darin waeren
	// eine Fehlerquelle ohne Gegenwert.
	it('nutzt nur unbedenkliche Zeichen im slug', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => [o.slug, ...o.kinder.map((k) => k.slug)]);
		for (const s of alle) expect(s, s).toMatch(/^[a-z0-9-]+$/);
	});
});
