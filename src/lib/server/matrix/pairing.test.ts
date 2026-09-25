import { describe, it, expect, vi, beforeEach } from 'vitest';
import { erzeugeCode, hashCode, PAIRING_ALPHABET, CODE_LAENGE } from './pairing';

describe('Kopplungscode', () => {
  it('ist acht Zeichen lang und nutzt nur das verwechslungsarme Alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = erzeugeCode();
      expect(code).toHaveLength(CODE_LAENGE);
      for (const z of code) expect(PAIRING_ALPHABET).toContain(z);
    }
  });

  // 0/O und 1/I/L sind auf einem Handybildschirm nicht auseinanderzuhalten. Ein Code,
  // den man falsch abtippt, erzeugt einen Fehlversuch und damit unnötigen Verdacht.
  it('enthält keine verwechselbaren Zeichen', () => {
    for (const z of ['0', 'O', '1', 'I', 'L']) {
      expect(PAIRING_ALPHABET).not.toContain(z);
    }
  });

  it('wiederholt sich praktisch nie', () => {
    const gesehen = new Set(Array.from({ length: 500 }, () => erzeugeCode()));
    expect(gesehen.size).toBe(500);
  });

  it('hasht stabil und gibt den Code nicht preis', () => {
    const h = hashCode('ABCDEFGH');
    expect(h).toBe(hashCode('ABCDEFGH'));
    expect(h).not.toContain('ABCDEFGH');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalisiert Gross- und Kleinschreibung beim Hashen', () => {
    // Der Nutzer tippt den Code im Chat ab; ob er ihn gross oder klein schreibt,
    // darf über Erfolg oder Fehlschlag nicht entscheiden.
    expect(hashCode('abcdefgh')).toBe(hashCode('ABCDEFGH'));
    expect(hashCode(' ABCDEFGH ')).toBe(hashCode('ABCDEFGH'));
  });
});

const mocks = vi.hoisted(() => ({
  codeZeilen: [] as any[],
  linkZeilen: [] as any[],
  versuchZeilen: [] as any[],
  // Befund R02: Standardmässig HAT der Code-Besitzer eine Mitgliedschaft (der
  // Normalfall in allen bestehenden Tests unten) — nur der neue Test weiter unten
  // setzt das gezielt auf `[]`, um den entfernten Nutzer zu simulieren.
  mitgliedschaftZeilen: [{ id: 'm1' }] as any[],
  geschrieben: [] as { tabelle: string; werte: unknown }[],
  // Simuliert einen Postgres-Fehler (23505) beim nächsten Insert in die genannte
  // Tabelle — für die Gürtel-und-Hosenträger-Prüfung, die codeEinloesen() abfängt.
  naechsterInsertFehler: null as null | { tabelle: string; fehler: unknown },
  // Simuliert einen UNERWARTETEN Fehler (kein 23505) beim nächsten Select auf die
  // genannte Tabelle — für die Prüfung, dass codeEinloesen() dabei NIE wirft.
  naechsterSelectFehler: null as null | { tabelle: string; fehler: unknown }
}));

vi.mock('../db', async () => {
  // getTableName() statt Symbol.for('drizzle:Name'): das ist die öffentliche
  // Schnittstelle von drizzle-orm und bricht nicht bei einem internen Update.
  const { getTableName } = await import('drizzle-orm');
  const treffer = (tabelle: any) => {
    const name = getTableName(tabelle);
    if (name === 'matrix_pairing_codes') return mocks.codeZeilen;
    if (name === 'matrix_links') return mocks.linkZeilen;
    if (name === 'matrix_pairing_attempts') return mocks.versuchZeilen;
    if (name === 'household_members') return mocks.mitgliedschaftZeilen;
    return [];
  };
  return {
    db: {
      select: () => ({
        from: (t: any) => ({
          where: () => {
            const name = getTableName(t);
            const fehlerKonfig = mocks.naechsterSelectFehler;
            if (fehlerKonfig && fehlerKonfig.tabelle === name) {
              mocks.naechsterSelectFehler = null;
              const p = Promise.reject(fehlerKonfig.fehler);
              return Object.assign(p, { for: () => p });
            }
            // .for('update') ist an echten Drizzle-Selects verkettbar (Zeilensperre
            // in der Transaktion); die Attrappe muss dieselbe Kette anbieten, sonst
            // bricht codeEinloesen() schon am Verketten statt am eigentlichen Test.
            const p = Promise.resolve(treffer(t));
            return Object.assign(p, { for: () => p });
          }
        })
      }),
      insert: (t: any) => ({
        values: (werte: any) => {
          const name = getTableName(t);
          const fehlerKonfig = mocks.naechsterInsertFehler;
          if (fehlerKonfig && fehlerKonfig.tabelle === name) {
            mocks.naechsterInsertFehler = null;
            const p = Promise.reject(fehlerKonfig.fehler);
            return Object.assign(p, { returning: () => p, onConflictDoUpdate: () => p });
          }
          mocks.geschrieben.push({ tabelle: name, werte });
          const p = Promise.resolve([{ id: 'neu' }]);
          return Object.assign(p, {
            returning: () => p,
            onConflictDoUpdate: () => {
              // Simuliert den Zähler-Upsert aus codeEinloesen(): existiert schon eine
              // Zeile für diesen Absender, liefert RETURNING ihren GESPEICHERTEN Stand
              // (das No-Op-Update ändert failedCount/windowStartedAt nicht) — sonst
              // wurde gerade neu eingefügt, RETURNING liefert die eingefügten Werte.
              // Die Attrappe filtert nicht nach matrixUserId (macht sie an keiner
              // Stelle), jeder Test setzt darum genau die eine Zeile, die zum
              // geprüften Absender gehört.
              const vorhandene = mocks.versuchZeilen[0];
              const stand = vorhandene ?? werte;
              const rp = Promise.resolve([
                { failedCount: stand.failedCount, windowStartedAt: stand.windowStartedAt }
              ]);
              return Object.assign(rp, { returning: () => rp });
            }
          });
        }
      }),
      update: (t: any) => ({
        set: (werte: unknown) => ({
          where: () => {
            mocks.geschrieben.push({ tabelle: getTableName(t), werte });
            return Promise.resolve();
          }
        })
      }),
      // Die Attrappe kennt keine echten Transaktionen — reicht die (gemockte) db
      // selbst als tx durch. Das genügt, um die Verzweigungen in codeEinloesen() zu
      // prüfen; ob die Sperren echte Nebenläufigkeit serialisieren, kann nur ein
      // Test gegen die laufende Datenbank zeigen (pairing.db.test.ts).
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn((await import('../db')).db)
    }
  };
});

/** Baut einen Fehler, wie ihn `pg` bei einer verletzten Eindeutigkeitsbedingung wirft. */
function eindeutigkeitsFehler(constraint: string) {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: '23505',
    constraint
  });
}

describe('Code einlösen', () => {
  const JETZT = new Date('2026-09-14T12:00:00Z');
  const gueltig = () => ({
    id: 'c1',
    userId: 'u1',
    codeHash: hashCode('ABCDEFGH'),
    expiresAt: new Date('2026-09-14T12:09:00Z'),
    usedAt: null
  });

  beforeEach(() => {
    mocks.codeZeilen = [];
    mocks.linkZeilen = [];
    mocks.versuchZeilen = [];
    mocks.mitgliedschaftZeilen = [{ id: 'm1' }];
    mocks.geschrieben = [];
    mocks.naechsterInsertFehler = null;
    mocks.naechsterSelectFehler = null;
  });

  it('verknüpft bei gültigem Code', async () => {
    const { codeEinloesen } = await import('./pairing');
    mocks.codeZeilen = [gueltig()];
    const r = await codeEinloesen('ABCDEFGH', '@erika:example.org', JETZT);
    expect(r).toEqual({ ok: true, userId: 'u1' });
    expect(mocks.geschrieben.some((g) => g.tabelle === 'matrix_links')).toBe(true);
  });

  it('nimmt den Code auch klein geschrieben an', async () => {
    const { codeEinloesen } = await import('./pairing');
    mocks.codeZeilen = [gueltig()];
    expect(await codeEinloesen('abcdefgh', '@erika:example.org', JETZT)).toEqual({ ok: true, userId: 'u1' });
  });

  it('lehnt einen unbekannten Code ab', async () => {
    const { codeEinloesen } = await import('./pairing');
    mocks.codeZeilen = [];
    expect(await codeEinloesen('ZZZZZZZZ', '@fremd:example.org', JETZT)).toEqual({
      ok: false,
      grund: 'unbekannt'
    });
  });

  // Ein abgelaufener Code darf NICHT wie ein unbekannter aussehen: der rechtmässige
  // Nutzer soll erfahren, dass er sich einen neuen holen muss, statt zu rätseln.
  it('unterscheidet abgelaufen von unbekannt', async () => {
    const { codeEinloesen } = await import('./pairing');
    mocks.codeZeilen = [{ ...gueltig(), expiresAt: new Date('2026-09-14T11:50:00Z') }];
    expect(await codeEinloesen('ABCDEFGH', '@erika:example.org', JETZT)).toEqual({
      ok: false,
      grund: 'abgelaufen'
    });
  });

  it('lehnt einen bereits verbrauchten Code ab', async () => {
    const { codeEinloesen } = await import('./pairing');
    mocks.codeZeilen = [{ ...gueltig(), usedAt: new Date('2026-09-14T11:55:00Z') }];
    expect(await codeEinloesen('ABCDEFGH', '@erika:example.org', JETZT)).toEqual({
      ok: false,
      grund: 'verbraucht'
    });
  });

  // Befund R02: ein Mitglied, das sich VOR seinem Ausschluss einen Code erzeugt hat,
  // darf sich damit NICHT mehr koppeln, sobald es entfernt wurde — auch wenn der Code
  // selbst noch gültig (nicht abgelaufen/verbraucht) ist. Ohne diese Prüfung würde
  // `nutzerZuMatrixId()` danach über den alten Haushalt auflösen.
  it('lehnt einen gültigen Code ab, dessen Besitzer keine Mitgliedschaft mehr hat', async () => {
    const { codeEinloesen } = await import('./pairing');
    mocks.codeZeilen = [gueltig()];
    mocks.mitgliedschaftZeilen = [];
    expect(await codeEinloesen('ABCDEFGH', '@erika:example.org', JETZT)).toEqual({
      ok: false,
      grund: 'kein_mitglied'
    });
    // Entscheidend: KEINE Verknüpfung, obwohl der Code stimmte.
    expect(mocks.geschrieben.some((g) => g.tabelle === 'matrix_links')).toBe(false);
  });

  it('lehnt ein Matrix-Konto ab, das schon verknüpft ist', async () => {
    const { codeEinloesen } = await import('./pairing');
    mocks.codeZeilen = [gueltig()];
    mocks.linkZeilen = [{ userId: 'u2', matrixUserId: '@erika:example.org' }];
    expect(await codeEinloesen('ABCDEFGH', '@erika:example.org', JETZT)).toEqual({
      ok: false,
      grund: 'schon_verknuepft'
    });
  });

  // Der Zähler hängt am Absender, nicht am Code: ein geratener Code trifft gar keine
  // Zeile, deren Zähler man erhöhen könnte.
  it('sperrt einen Absender nach zu vielen Fehlversuchen', async () => {
    const { codeEinloesen, MAX_FEHLVERSUCHE } = await import('./pairing');
    mocks.versuchZeilen = [
      { matrixUserId: '@boes:example.org', failedCount: MAX_FEHLVERSUCHE, windowStartedAt: JETZT }
    ];
    mocks.codeZeilen = [gueltig()];
    expect(await codeEinloesen('ABCDEFGH', '@boes:example.org', JETZT)).toEqual({
      ok: false,
      grund: 'zu_viele_versuche'
    });
    // Entscheidend: KEINE Verknüpfung, obwohl der Code stimmte.
    expect(mocks.geschrieben.some((g) => g.tabelle === 'matrix_links')).toBe(false);
  });

  it('lässt die Sperre nach Ablauf des Zeitfensters wieder fallen', async () => {
    const { codeEinloesen, MAX_FEHLVERSUCHE, VERSUCHSFENSTER_MS } = await import('./pairing');
    mocks.versuchZeilen = [
      {
        matrixUserId: '@erika:example.org',
        failedCount: MAX_FEHLVERSUCHE,
        windowStartedAt: new Date(JETZT.getTime() - VERSUCHSFENSTER_MS - 1000)
      }
    ];
    mocks.codeZeilen = [gueltig()];
    expect(await codeEinloesen('ABCDEFGH', '@erika:example.org', JETZT)).toEqual({ ok: true, userId: 'u1' });
  });

  // Korrekturrunde 1: Die vorherige SELECT-Prüfung "schon verknüpft?" schliesst eine
  // gleichzeitige zweite Einlösung nicht aus — erst die Eindeutigkeitsbedingung der
  // Datenbank tut das zuverlässig. 'schon_verknuepft' wäre hier die FALSCHE Auskunft:
  // es sagt "dein Matrix-Konto ist schon verknüpft", obwohl in Wahrheit das
  // APP-Konto bereits eine andere Verknüpfung trägt — der Nutzer müsste die lösen,
  // nicht ahnungslos einen neuen Code anfordern.
  it('meldet konto_schon_gekoppelt statt eines rohen Datenbankfehlers, wenn das App-Konto schon eine andere Verknüpfung trägt', async () => {
    const { codeEinloesen } = await import('./pairing');
    mocks.codeZeilen = [gueltig()];
    mocks.naechsterInsertFehler = {
      tabelle: 'matrix_links',
      fehler: eindeutigkeitsFehler('matrix_links_user_id_unique')
    };
    await expect(codeEinloesen('ABCDEFGH', '@neu:example.org', JETZT)).resolves.toEqual({
      ok: false,
      grund: 'konto_schon_gekoppelt'
    });
  });

  // Korrekturrunde 2: codeEinloesen() darf UNTER KEINEN UMSTÄNDEN werfen — sonst
  // bekommt der Bot-Nutzer gar keine Antwort. 'unbekannt' wäre hier aber eine
  // FALSCHE Behauptung: der Code könnte richtig sein, es liegt an unserer Seite.
  it('gibt bei einem unerwarteten Datenbankfehler ehrlich fehler zurück statt zu werfen', async () => {
    const { codeEinloesen } = await import('./pairing');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.naechsterSelectFehler = {
        tabelle: 'matrix_pairing_codes',
        fehler: new Error('Verbindung zur Datenbank verloren')
      };
      await expect(codeEinloesen('ABCDEFGH', '@erika:example.org', JETZT)).resolves.toEqual({
        ok: false,
        grund: 'fehler'
      });
      // Der echte Fehler geht ins Log (kann Endpunkte/Konfiguration nennen) — nie
      // an den Nutzer, aber er darf auch nicht spurlos verschwinden.
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
