import { describe, it, expect } from 'vitest';
import { matrixLinks, matrixPairingCodes, matrixBotState, receipts, receiptSource } from './schema';
import { getTableConfig } from 'drizzle-orm/pg-core';

describe('Matrix-Tabellen', () => {
  it('kennt den Quellwert matrix', () => {
    expect(receiptSource.enumValues).toContain('matrix');
  });

  // Eindeutig in BEIDE Richtungen: ein Matrix-Konto darf nicht auf zwei App-Nutzer
  // zeigen, und ein App-Nutzer nicht von zwei Matrix-Konten bespielt werden.
  it('verknüpft Matrix-Konto und App-Nutzer beidseitig eindeutig', () => {
    const spalten = getTableConfig(matrixLinks).columns;
    const userId = spalten.find((c) => c.name === 'user_id');
    const matrixId = spalten.find((c) => c.name === 'matrix_user_id');
    expect(userId?.isUnique).toBe(true);
    expect(matrixId?.isUnique).toBe(true);
  });

  // Der Idempotenz-Schlüssel. Ohne ihn erzeugt jedes erneute /sync einen zweiten Bon.
  it('macht die Matrix-Ereignis-ID eindeutig, lässt sie aber null zu', () => {
    const spalte = getTableConfig(receipts).columns.find((c) => c.name === 'matrix_event_id');
    expect(spalte?.isUnique).toBe(true);
    // null muss erlaubt bleiben: Bons aus Kamera und Upload haben keine Ereignis-ID.
    // Postgres lässt beliebig viele NULL in einer eindeutigen Spalte zu.
    expect(spalte?.notNull).toBe(false);
  });

  it('hält den Sync-Token in der Datenbank, nicht im Container', () => {
    const namen = getTableConfig(matrixBotState).columns.map((c) => c.name);
    expect(namen).toContain('since_token');
    expect(namen).toContain('last_sync_at');
  });

  it('speichert Kopplungscodes nur gehasht', () => {
    const namen = getTableConfig(matrixPairingCodes).columns.map((c) => c.name);
    expect(namen).toContain('code_hash');
    expect(namen).not.toContain('code');
  });
});
