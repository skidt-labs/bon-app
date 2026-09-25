import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pruefeOcrQualitaet, MAX_UEBERHANG_GROESSTER_BETRAG } from './qualitaet';

const hier = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(hier, '..', '..', '..', '..', 'tests', 'fixtures', 'ocr');

function laden(datei: string): string {
  return readFileSync(join(FIXTURES, datei), 'utf8');
}

describe('pruefeOcrQualitaet — Kunstbeispiele', () => {
  it('lässt einen sauberen Bontext bestehen', () => {
    const text = [
      'Supermarkt Musterstadt',
      'Milch 1,29 A',
      'Brot 2,49 A',
      'Zu zahlen 3,78',
      'Datum: 01.01.2026 12:00'
    ].join('\n');
    expect(pruefeOcrQualitaet(text).brauchbar).toBe(true);
  });

  it('lässt Kauderwelsch ohne jedes Signal durchfallen', () => {
    const text = 'L$DL\nA,\nAAl\n3 A\nmin ö eten 9 äreen\nE\n| Aa';
    const ergebnis = pruefeOcrQualitaet(text);
    expect(ergebnis.brauchbar).toBe(false);
    expect(ergebnis.anzahlBetraege).toBe(0);
    expect(ergebnis.hatSummenzeile).toBe(false);
    expect(ergebnis.hatDatum).toBe(false);
  });

  it('lässt leeren Text durchfallen', () => {
    expect(pruefeOcrQualitaet('').brauchbar).toBe(false);
  });

  it('verlangt mindestens zwei Beträge — einer allein reicht nicht, selbst mit Summenzeile', () => {
    // Bewusst OHNE Datumszeile: ein deutsches Datum (TT.MM.JJJJ) hat dieselbe Form wie
    // ein Betrag (Ziffern-Trenner-zwei Ziffern) und würde sonst selbst als Beleg für
    // "genug Beträge" mitzählen — das ist am Regex gemessen, nicht angenommen.
    const text = 'Zu zahlen 3,78';
    const ergebnis = pruefeOcrQualitaet(text);
    expect(ergebnis.anzahlBetraege).toBe(1);
    expect(ergebnis.brauchbar).toBe(false);
  });

  it('lässt einen Bon ohne Summenzeile bestehen, wenn Beträge UND Datum da sind', () => {
    // Beschnittenes Foto: die letzte Zeile mit "Zu zahlen" fehlt, der Rest ist lesbar.
    const text = 'Milch 1,29 A\nBrot 2,49 A\nWurst 3,99 A\nDatum: 01.01.2026 12:00';
    const ergebnis = pruefeOcrQualitaet(text);
    expect(ergebnis.hatSummenzeile).toBe(false);
    expect(ergebnis.brauchbar).toBe(true);
  });

  it('lässt einen Bon ohne Datum bestehen, wenn Beträge UND Summenzeile da sind', () => {
    // Der Datumsstempel ist genau die Zeile, die auf dem Foto abgeschnitten wurde.
    const text = 'Milch 1,29 A\nBrot 2,49 A\nGesamtbetrag 3,78';
    const ergebnis = pruefeOcrQualitaet(text);
    expect(ergebnis.hatDatum).toBe(false);
    expect(ergebnis.brauchbar).toBe(true);
  });

  it('lässt viele Beträge ohne jede Summe oder Datum NICHT bestehen', () => {
    // Zwei von drei Signalen fehlen gleichzeitig — genau der Fall, in dem markiert
    // werden soll, auch wenn zufällig ein paar Kommazahlen im Text stehen.
    const text = '1,29 3,49 7,99 2,10 5,00 zufaellige Kommazahlen ohne jeden Bonbezug';
    expect(pruefeOcrQualitaet(text).brauchbar).toBe(false);
  });

  it('erkennt die Summenzeile auch mit Lidl-typischem OCR-Leerraum ("40 , 01")', () => {
    const text = 'Mango 1,49 A\nBrot 2,49 A\nzu zahlen 40 , 01';
    const ergebnis = pruefeOcrQualitaet(text);
    expect(ergebnis.hatSummenzeile).toBe(true);
    expect(ergebnis.anzahlBetraege).toBeGreaterThanOrEqual(2);
  });

  it('erkennt ein Datum auch mit OCR-Rutscher auf Komma ("25,08,26")', () => {
    const text = 'Milch 1,29 A\nBrot 2,49 A\nDatum: 25,08,26 Zeit: 17:04';
    expect(pruefeOcrQualitaet(text).hatDatum).toBe(true);
  });
});

describe('pruefeOcrQualitaet — echte Testvorlagen (anonymisiert, tests/fixtures/ocr/)', () => {
  it('lässt den Jack-Wolfskin-Bon über die App bestehen (838px, lesbar)', () => {
    expect(pruefeOcrQualitaet(laden('jack-wolfskin-838px-app.txt')).brauchbar).toBe(true);
  });

  it('lässt denselben Bon über Matrix bestehen (366px, lesbar)', () => {
    expect(pruefeOcrQualitaet(laden('jack-wolfskin-366px-matrix.txt')).brauchbar).toBe(true);
  });

  it('lässt den langen Lidl-Bon mit Rabattzeilen bestehen (1130px, sehr gut lesbar)', () => {
    const ergebnis = pruefeOcrQualitaet(laden('lidl-lang-1130px.txt'));
    expect(ergebnis.brauchbar).toBe(true);
    expect(ergebnis.anzahlBetraege).toBeGreaterThan(20);
  });

  it('lässt den kurzen Lidl-Bon bestehen (448px, gut lesbar)', () => {
    expect(pruefeOcrQualitaet(laden('lidl-kurz-448px.txt')).brauchbar).toBe(true);
  });

  it('lässt das Kauderwelsch-Foto durchfallen (297px, kein Feld lesbar)', () => {
    const ergebnis = pruefeOcrQualitaet(laden('unlesbar-297px.txt'));
    expect(ergebnis.brauchbar).toBe(false);
    expect(ergebnis.anzahlBetraege).toBe(0);
    expect(ergebnis.hatSummenzeile).toBe(false);
    expect(ergebnis.hatDatum).toBe(false);
  });
});

describe('pruefeOcrQualitaet — ein Betrag darf die Liste nicht beherrschen', () => {
	// Der Anlass, gemessen am 2026-09-16: Auf einem stark komprimierten Foto (297 px)
	// lieferte PaddleOCR mit seiner Standard-Groessengrenze nur Fragmente — aber darunter
	// eine Zahl, die wie eine Endsumme aussieht: `Betrag 48,61 EUR`. Der Bon ist in
	// Wahrheit 40,01 EUR. Beträge und ein Datum waren da, also passierte der Text den
	// Tuersteher in seiner alten Fassung. Das Modell haette daraus einen ordentlich
	// aussehenden, falschen Bon gebaut.
	//
	// Das Signal dahinter: Auf einem echten Bon steht jeder Betrag mehrfach — einmal als
	// Position, einmal in der Summenbildung, und die Endsumme meist noch bei der Zahlart.
	// Ein einzelner Betrag kann die Liste deshalb nie beherrschen. Tut er es doch, fehlen
	// die Positionen und uebrig blieb ein Fragment mit einer Summe obendrauf.
	it('laesst einen Text durchfallen, in dem ein Betrag fast alles ausmacht', () => {
		const fragment = 'L&DL\n1,49x3\nPfandrückgabe\n0,25\n05.08.2026\nBetrag\n48,61 EUR';
		const urteil = pruefeOcrQualitaet(fragment);

		expect(urteil.anzahlBetraege).toBeGreaterThanOrEqual(2);
		expect(urteil.hatDatum).toBe(true);
		// Die alten Signale sprechen alle dafuer — und trotzdem ist es kein Bon.
		expect(urteil.brauchbar).toBe(false);
	});

	it('laesst einen kurzen, aber vollstaendigen Bon bestehen', () => {
		// Ein Artikel, Summe, Zahlart: der groesste Betrag macht hier ein Drittel aus.
		const kurz = 'Bioland Broccoli 2,29 A\nZu zahlen 2,29\nKreditkarte 2,29\n05.08.2026';
		expect(pruefeOcrQualitaet(kurz).brauchbar).toBe(true);
	});
});

describe('pruefeOcrQualitaet — PaddleOCR-Vorlagen desselben Bons (echte Endsumme 40,01)', () => {
	// Beide Texte stammen vom SELBEN Foto und derselben Engine — der einzige Unterschied
	// ist die Groessengrenze der Erkennung. Das macht sie zum schaerfsten denkbaren
	// Testpaar: was der Tuersteher hier trennt, trennt er an einem echten Unterschied.
	it('laesst die Fassung mit Standardgrenze durchfallen — sie behauptet 48,61', () => {
		const urteil = pruefeOcrQualitaet(laden('paddle-297px-standard.txt'));
		expect(urteil.brauchbar).toBe(false);
	});

	it('laesst die Fassung mit heraufgesetzter Grenze bestehen — sie liest 40,01', () => {
		const urteil = pruefeOcrQualitaet(laden('paddle-297px-gross.txt'));
		expect(urteil.brauchbar).toBe(true);
		expect(urteil.hatSummenzeile).toBe(true);
	});
});

// Beide Faelle am 2026-09-16 an echten Bons gemessen, aufgedeckt durch PaddleOCRs
// andere Kasteneinteilung — aber engine-unabhaengig: Tesseract kann dieselben
// Zeichenketten auf einem anderen Bon erzeugen.
describe('pruefeOcrQualitaet — Zahlen, die keine Betraege sind', () => {
	// PaddleOCR zog zwei Spalten in EINEN Kasten ohne Leerzeichen: aus "16,80" und
	// "67,20" wurde "16,8067,20". Daraus las die alte Regex 8067,20 EUR — genug, um die
	// Verhaeltnispruefung zu sprengen und einen einwandfreien Bon durchfallen zu lassen.
	it('erfindet aus zwei zusammengelaufenen Zahlen keinen dritten Betrag', () => {
		const bon = [
			'Bioland Broccoli 2,29 A',
			'Beleg-Rabattanteilig 16,8067,20',
			'Milch 1,09 A',
			'Zu zahlen 3,38',
			'Datum: 05.08.2026'
		].join('\n');

		const urteil = pruefeOcrQualitaet(bon);

		expect(urteil.brauchbar).toBe(true);
		// Der Ueberhang bleibt klein: der erfundene Riesenbetrag taucht gar nicht erst auf.
		expect(urteil.ueberhangGroessterBetrag).toBeLessThan(2);
	});

	// PaddleOCR liess aus der TSE-Zeile das Bruchstueck "2026.08" als eigenen Kasten
	// stehen. Als Betrag gelesen waeren das 2026,08 EUR.
	it('haelt eine Jahr-Monat-Angabe nicht fuer einen Betrag', () => {
		const bon = ['Milch 1,09 A', 'Butter 2,29 A', 'Zu zahlen 3,38', '2026.08'].join('\n');

		const urteil = pruefeOcrQualitaet(bon);

		expect(urteil.brauchbar).toBe(true);
		expect(urteil.ueberhangGroessterBetrag).toBeLessThan(2);
	});

	// Die Jahreszahl ist auf 19xx/20xx eingegrenzt, damit ein echter vierstelliger
	// Betrag nicht mit ausgeschlossen wird — 1234,56 EUR ist ein moeglicher Bon.
	it('schliesst einen echten vierstelligen Betrag nicht als Datum aus', () => {
		const bon = ['Fernseher 1234,56 A', 'Zubehoer 1200,00 A', 'Zu zahlen 2434,56'].join('\n');

		expect(pruefeOcrQualitaet(bon).brauchbar).toBe(true);
	});
});

describe('pruefeOcrQualitaet — Prozentangaben sind keine Betraege', () => {
	// Am 2026-09-17 an einem echten Bon gemessen: dort stand "219,00%". Als Betrag
	// gelesen sind das 219,00 EUR — genug, um die Verhaeltnispruefung zu sprengen. Der
	// Bon wurde dadurch als unlesbar VERWORFEN, obwohl er einwandfrei war (Ueberhang
	// 2,19 statt 0,22).
	it('haelt eine Prozentangabe nicht fuer einen Geldbetrag', () => {
		const bon = ['Milch 1,09 A', 'Butter 2,29 A', 'Zu zahlen 3,38', 'Rabatt 219,00%'].join('\n');

		const urteil = pruefeOcrQualitaet(bon);

		expect(urteil.brauchbar).toBe(true);
		// Der direkte Beweis: 219,00 taucht gar nicht erst als Betrag auf. Ohne den
		// Ausschluss waere der Ueberhang 32,4 gewesen — der Bon faellt durch.
		expect(urteil.anzahlBetraege).toBe(3);
		expect(urteil.ueberhangGroessterBetrag).toBeLessThan(MAX_UEBERHANG_GROESSTER_BETRAG);
	});

	// Auch mit Leerzeichen davor — so steht der Steuersatz auf fast jedem deutschen Bon.
	it('schliesst auch einen Steuersatz mit Leerzeichen aus', () => {
		const bon = ['Milch 1,09 A', 'Butter 2,29 A', 'Zu zahlen 3,38', 'A 19,00 % MwSt'].join('\n');

		expect(pruefeOcrQualitaet(bon).anzahlBetraege).toBe(3);
	});

	// Die Gegenprobe: ein Betrag, dem KEIN Prozentzeichen folgt, zaehlt weiter mit.
	it('laesst einen gewoehnlichen Betrag unberuehrt', () => {
		const bon = ['Fernseher 219,00 A', 'Halterung 200,00 A', 'Zu zahlen 419,00'].join('\n');

		expect(pruefeOcrQualitaet(bon).anzahlBetraege).toBe(3);
	});
});
