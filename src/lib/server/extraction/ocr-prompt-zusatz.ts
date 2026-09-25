/**
 * Prompt-Zusatz für den Textweg (Aufgabe 2, Entwurf E7).
 *
 * Der bestehende `SYSTEM_PROMPT` (`prompt.ts`) ist für BILDER geschrieben — das Modell
 * soll dort jede sichtbare Zeile eines Fotos einordnen. Beim Textweg bekommt es
 * stattdessen den kompletten OCR-Text, und der reicht bis in die Fußzeile (TSE-Nummern,
 * Kartennummer, Werbung, Öffnungszeiten). Ohne diesen Zusatz lief das Modell am
 * 2026-09-15 zweimal ins Token-Limit, weil es versuchte, JEDE Zeile bis zum Bonende
 * einzuordnen (siehe Entwurf, Ausgangsmessungen).
 *
 * Wortlaut UNVERÄNDERT übernommen aus der Session vom 2026-09-15, in der diese Wirkung
 * an einem echten 24-Positionen-Lidl-Bon GEMESSEN wurde: saubere Artikelnamen statt
 * `"Mango 1,49 x 3 4,47 A"`, und alle acht Rabatte korrekt ihrer Zeile zugeordnet —
 * beides vorher falsch. NICHT behoben: eine erfundene 25. Zeile (eine `deposit`-Position
 * über +1,00 EUR, abgeleitet aus einer echten Pfandrückgabe von −1,00 EUR). Der
 * Korrekturversuch dafür steht in `OCR_PROMPT_ZUSATZ_PFAND_KORREKTUR` weiter unten —
 * getrennt von diesem Block, weil DESSEN Wortlaut nicht mehr der gemessene ist.
 */
export const OCR_PROMPT_ZUSATZ = `=== DIESER TEXT STAMMT AUS EINER TEXTERKENNUNG (OCR), NICHT AUS EINEM BILD ===

WO DIE POSITIONEN ANFANGEN UND AUFHÖREN — das ist die wichtigste Regel
- Positionen stehen NUR zwischen dem Kopf (Händler, Anschrift, Datum) und der
  Summenzeile (SUMME / ZU ZAHLEN / GESAMTBETRAG / TOTAL).
- Alles NACH der Summenzeile ist Beiwerk: Zahlungsart, Kartennummer, Terminal-Nr.,
  MwSt-Block, TSE-Nummern, Prüfwerte, Signaturzähler, Werbung, Öffnungszeiten,
  Dankesformeln. Daraus wird NIEMALS eine Position.
- Gib KEINE "info"-Zeilen aus. Trägt eine Zeile keinen Betrag, der in die Summe
  eingeht, gehört sie nicht in "items".

WAS IN "rawText" GEHÖRT
- NUR die Artikelbezeichnung. Ohne Menge, ohne Einzelpreis, ohne Zeilenbetrag,
  ohne MwSt-Kennzeichen, ohne Artikelnummer.
    "Mango 1,49 x 3 4,47 A"    -> rawText "Mango"
    "Bioland Broccoli 2,29 A"  -> rawText "Bioland Broccoli"
  Die Zahlen derselben Zeile gehören in quantity, unitPriceCents, totalPriceCents
  und vatClass — nicht noch einmal in den Namen.

URSPRUNGS- UND DURCHGESTRICHENE PREISE
- Steht bei einem Artikel ein früherer Preis ("Orig. Preis:", "statt", "UVP"), ist
  das NICHT der bezahlte Betrag. "totalPriceCents" ist immer der Betrag, der
  tatsächlich in die Summe eingeht.

RABATTE ZUORDNEN
- Eine Rabattzeile steht fast immer DIREKT unter dem Artikel, auf den sie sich
  bezieht. Trage dessen "lineNo" in "appliesToLine" ein.
- Nur ein Rabatt, der erkennbar für den ganzen Bon gilt, behält appliesToLine null.

OCR MACHT FEHLER
- Ziffern und Buchstaben werden verwechselt (O/0, l/1, S/5). Korrigiere das NUR,
  wenn es eindeutig ist.
- Ist eine Zeile so verstümmelt, dass du ihren Betrag nicht sicher lesen kannst,
  LASS SIE WEG. Erfinde niemals eine Position und niemals einen Betrag.

PRÜFE DICH SELBST, BEVOR DU ANTWORTEST
- Die Summe aller "totalPriceCents" muss "totalGrossCents" ergeben. Weicht sie ab,
  hast du eine Zeile zu viel oder zu wenig.`;

/**
 * Prompt-Runde gegen den bekannten Restfehler (E7/Aufgabe 2): das Modell erfand am
 * langen Lidl-Bon eine 25. Zeile — eine `deposit`-Position über +1,00 EUR — obwohl der
 * OCR-Text dafür keine eigene Zeile hergibt. Die einzige plausible Quelle im Text ist
 * die echte Pfandrückgabe:
 *
 *   Pfandrückgabe -1,00 B
 *   -4 x 0,25
 *
 * — zwei Zeilen, aber EINE Position (die zweite ist nur die Stückzahl-Aufschlüsselung
 * der ersten). Der Zusatz unten benennt dieses Muster explizit.
 *
 * WICHTIG (siehe Task-2-Bericht): dieser Zusatz ist NICHT wie `OCR_PROMPT_ZUSATZ` oben
 * an echten Modell-Antworten gemessen — der Live-Zugriff auf den Mac war in dieser
 * Session nicht mit einem gültigen Schlüssel möglich (das in `.env` hinterlegte
 * `EXTRACTION_API_KEY` gehört zum Cloud-Anbieter, nicht zu `mlx.example.org`; ein
 * Testaufruf dorthin schlug mit HTTP 401 fehl). Ob dieser Text den Fehler tatsächlich
 * abstellt, ist deshalb UNBEWIESEN. Die Absicherung, die tatsächlich greift, ist die
 * Code-Regel in `ocr-text-provider.ts` (`entferneUnbelegtePfandzeilen`): eine
 * `deposit`-Zeile ohne eigenen, nicht-negierten Beleg im OCR-Text wird dort entfernt,
 * unabhängig davon, ob dieser Prompt-Zusatz hilft.
 */
export const OCR_PROMPT_ZUSATZ_PFAND_KORREKTUR = `PFANDRÜCKGABE MIT EIGENER MENGENZEILE — KEINE ZWEITE POSITION
- Nach einer Zeile "Pfandrückgabe" oder "Leergut" steht auf Lidl-Bons oft eine EIGENE
  Zeile mit der Stückzahl, z. B. "-4 x 0,25" unter "Pfandrückgabe -1,00". Das ist KEINE
  zweite Position, sondern nur die Aufschlüsselung DERSELBEN Zeile (4 Flaschen à
  0,25 EUR = 1,00 EUR Rückgabe). Erzeuge daraus NIEMALS eine zusätzliche Position.
- Eine "deposit"-Position (Pfand-AUFSCHLAG, positiver Betrag) gibt es NUR, wenn eine
  EIGENE Zeile mit einem POSITIVEN Pfand-Betrag auf dem Bon steht (z. B. "PFAND 0,25"
  beim Kauf). Leite niemals aus einer Pfand-RÜCKGABE (negativer Betrag) eine
  gespiegelte, positive "deposit"-Zeile ab — eine Rückgabe bleibt eine einzige Zeile
  mit negativem Betrag ("deposit_return").`;
