import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { categories, products, productAliases, productTags, receiptItems } from './schema';

describe('Kategorie-Tabellen', () => {
  // Der Entwurf legt die Zweistufigkeit fest: Oberkategorien haben kein parent_id,
  // Unterkategorien genau eines. Mehr Ebenen sind ausdruecklich nicht vorgesehen.
  it('bildet den Baum ueber parent_id ab', () => {
    const namen = getTableConfig(categories).columns.map((c) => c.name);
    expect(namen).toContain('parent_id');
    expect(namen).toContain('slug');
  });

  it('macht den slug eindeutig, damit der Startbestand idempotent bleibt', () => {
    const slug = getTableConfig(categories).columns.find((c) => c.name === 'slug');
    expect(slug?.isUnique).toBe(true);
  });

  // DAS Lerngedaechtnis. Ohne diese Eindeutigkeit koennte derselbe Rohtext beim
  // selben Haendler auf zwei Produkte zeigen — und welche Regel gilt, waere Zufall.
  it('erlaubt pro Haendler und Rohtext genau einen Alias', () => {
    const cfg = getTableConfig(productAliases);
    const namen = cfg.uniqueConstraints.flatMap((u) => u.columns.map((c) => c.name)).sort();
    expect(namen).toEqual(['merchant_id', 'raw_text_normalized']);
  });

  it('haengt Produkte an den Haushalt, Haendler aber nicht', () => {
    expect(getTableConfig(products).columns.map((c) => c.name)).toContain('household_id');
  });

  it('haengt Tags am Produkt, nicht an der Bonzeile', () => {
    expect(getTableConfig(productTags).columns.map((c) => c.name)).toContain('product_id');
    expect(getTableConfig(productTags).columns.map((c) => c.name)).not.toContain('receipt_item_id');
  });

  it('ergaenzt die Bonzeile um Produkt, Kategorie, Herkunft und Konfidenz', () => {
    const namen = getTableConfig(receiptItems).columns.map((c) => c.name);
    for (const n of ['product_id', 'category_id', 'category_source', 'confidence']) {
      expect(namen, n).toContain(n);
    }
  });

  // null heisst „noch nicht zugeordnet" und ist von „bewusst Sonstiges" unterscheidbar.
  it('laesst die Kategorie null, statt etwas zu behaupten', () => {
    const c = getTableConfig(receiptItems).columns.find((x) => x.name === 'category_id');
    expect(c?.notNull).toBe(false);
  });
});
