import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
	insertCalls: [] as { tabelle: unknown; values: unknown; konflikt: unknown }[],
	/** Was die Suche nach einem vorhandenen Produkt liefert. */
	vorhandenesProdukt: [] as { id: string }[],
	produktId: 'produkt-1' as string | null,
	wirft: null as Error | null
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.vorhandenesProdukt) }) }) }),
		insert: (tabelle: unknown) => ({
			values: (values: unknown) => {
				const eintrag = { tabelle, values, konflikt: null as unknown };
				const kette = {
					onConflictDoUpdate: (k: unknown) => {
						eintrag.konflikt = k;
						mocks.insertCalls.push(eintrag);
						if (mocks.wirft) return Promise.reject(mocks.wirft);
						return {
							returning: () => Promise.resolve(mocks.produktId ? [{ id: mocks.produktId }] : [])
						};
					},
					returning: () => {
						mocks.insertCalls.push(eintrag);
						if (mocks.wirft) return Promise.reject(mocks.wirft);
						return Promise.resolve(mocks.produktId ? [{ id: mocks.produktId }] : []);
					}
				};
				return kette;
			}
		})
	}
}));

import { lerneAusKorrektur } from './lernen';
import { products, productAliases } from '$lib/server/db/schema';

const basis = {
	householdId: 'haushalt-1',
	merchantId: 'haendler-1',
	rawText: 'BIO MILCH 1L',
	categoryId: 'kategorie-1'
};

describe('lerneAusKorrektur', () => {
	beforeEach(() => {
		mocks.insertCalls.length = 0;
		mocks.vorhandenesProdukt = [];
		mocks.produktId = 'produkt-1';
		mocks.wirft = null;
	});

	it('legt Produkt und Alias an und normalisiert den Rohtext', async () => {
		await lerneAusKorrektur(basis);
		const produkt = mocks.insertCalls.find((c) => c.tabelle === products);
		const alias = mocks.insertCalls.find((c) => c.tabelle === productAliases);
		expect(produkt?.values).toMatchObject({ householdId: 'haushalt-1', defaultCategoryId: 'kategorie-1' });
		// Der Schluessel ist der NORMALISIERTE Text — sonst lernt das Gedaechtnis fuer
		// jede Schreibweise desselben Artikels von vorn. Die Gebindegroesse bleibt darin:
		// „Milch 1L" und „Milch 500ml" sind verschiedene Artikel, nicht derselbe.
		expect((alias?.values as { rawTextNormalized: string }).rawTextNormalized).toBe('bio milch 1l');
		expect(alias?.values).toMatchObject({ merchantId: 'haendler-1', productId: 'produkt-1' });
	});

	// Zweimal derselbe Text beim selben Haendler: der Alias wird ueberschrieben, nicht
	// verdoppelt — die Eindeutigkeitsbedingung aus Aufgabe 2 faengt es sonst als Fehler ab.
	it('ueberschreibt einen vorhandenen Alias, statt einen zweiten anzulegen', async () => {
		await lerneAusKorrektur(basis);
		const alias = mocks.insertCalls.find((c) => c.tabelle === productAliases);
		expect(alias?.konflikt).toBeTruthy();
		const k = alias?.konflikt as { set: Record<string, unknown> };
		// hits steigt beim erneuten Treffer — daran misst sich spaeter, was sich bewaehrt hat.
		expect(Object.keys(k.set)).toContain('hits');
		expect(Object.keys(k.set)).toContain('productId');
	});

	it('lernt ohne Haendler haendlerunabhaengig', async () => {
		await lerneAusKorrektur({ ...basis, merchantId: null });
		const alias = mocks.insertCalls.find((c) => c.tabelle === productAliases);
		expect((alias?.values as { merchantId: string | null }).merchantId).toBeNull();
	});

	it('haelt den Produktnamen am Rohtext fest, nicht am normalisierten Schluessel', async () => {
		await lerneAusKorrektur(basis);
		const produkt = mocks.insertCalls.find((c) => c.tabelle === products);
		expect((produkt?.values as { canonicalName: string }).canonicalName).toBe('BIO MILCH 1L');
	});

	/**
	 * Die wichtigste Zusicherung: ein Fehler beim Lernen darf das Bestaetigen des Bons
	 * nicht scheitern lassen. Der Bon ist wichtiger als die gelernte Regel.
	 */
	it('wirft nie — auch nicht, wenn die Datenbank ablehnt', async () => {
		mocks.wirft = new Error('Datenbank weg');
		await expect(lerneAusKorrektur(basis)).resolves.toBeUndefined();
	});

	// Ein zweites Mal derselbe Artikel legt KEIN zweites Produkt an: products hat keine
	// Eindeutigkeitsregel auf dem Namen, also muss der Code selbst nachsehen. Sonst
	// wuechse mit jeder Korrektur eine Karteileiche.
	it('nutzt ein vorhandenes Produkt, statt ein zweites anzulegen', async () => {
		mocks.vorhandenesProdukt = [{ id: 'produkt-alt' }];
		await lerneAusKorrektur(basis);
		expect(mocks.insertCalls.some((c) => c.tabelle === products)).toBe(false);
		const alias = mocks.insertCalls.find((c) => c.tabelle === productAliases);
		expect((alias?.values as { productId: string }).productId).toBe('produkt-alt');
	});

	it('lernt nichts aus einem leeren Rohtext', async () => {
		await lerneAusKorrektur({ ...basis, rawText: '   ' });
		expect(mocks.insertCalls).toHaveLength(0);
	});

	// Ohne Produkt kein Alias: ein Alias, der auf nichts zeigt, waere eine kaputte Zeile
	// im Gedaechtnis, die spaeter still nichts findet.
	it('legt keinen Alias an, wenn das Produkt nicht entstanden ist', async () => {
		mocks.produktId = null;
		await lerneAusKorrektur(basis);
		expect(mocks.insertCalls.some((c) => c.tabelle === productAliases)).toBe(false);
	});
});
