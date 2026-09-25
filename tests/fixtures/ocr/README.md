# OCR-Testvorlagen für die Qualitätsprüfung

Echte Tesseract-Ausgaben (`deu`, `--psm 6`) von Bons des Betreibers, aufgenommen am
2026-09-15 zur Messung aus
[`docs/superpowers/specs/2026-09-15-bon-app-lokale-auslesung-design.md`](../../../docs/superpowers/specs/2026-09-15-bon-app-lokale-auslesung-design.md).
Sie dienen `pruefeOcrQualitaet` (`src/lib/server/ocr/qualitaet.ts`) als Testfälle in
beide Richtungen: vier müssen bestehen, einer muss durchfallen.

| Datei | Bon | Breite | Urteil |
|---|---|---|---|
| `jack-wolfskin-838px-app.txt` | Jack Wolfskin, Upload über die App | 838 px | lesbar |
| `jack-wolfskin-366px-matrix.txt` | derselbe Bon, über Matrix gesendet | 366 px | lesbar |
| `lidl-lang-1130px.txt` | Lidl, lang, 24 Positionen mit Rabatten | 1130 px | sehr gut lesbar |
| `lidl-kurz-448px.txt` | Lidl, kurz | 448 px | gut lesbar |
| `unlesbar-297px.txt` | Lidl, stark komprimiertes Foto | 297 px | Kauderwelsch — muss durchfallen |

## Anonymisierung

Die Rohtexte enthielten TSE-Nummern, Signaturzähler, Prüfwerte, Kartennummern und
Terminal-Nummern aus echten Zahlungsvorgängen. Diese Felder wurden **formbewahrend**
ersetzt: jede Ziffer/jeder Buchstabe wurde durch einen Wert aus einem festen,
zyklischen Alphabet an derselben Position ersetzt (Satzzeichen, Leerraum und
Zeilenumbrüche unverändert) — die Form (Länge, Zeichenklasse je Position, mehrzeilige
Blöcke) bleibt dieselbe wie im OCR-Original, der Inhalt ist aber garantiert nicht mehr
der echte Wert. Betroffen: `Beleg`-/Transaktionsnummern, `Terminal-Nr.`, `Trace-Nr.`,
`Karten-Nr.`/`Kartennr.`, `Folge-Nr.`, `AID` (kurzer Sitzungscode, NICHT der
kartennetzweite `EMV-AID`-Standardwert — der ist öffentlich und auf jedem Beleg
gleich), `TSE Transaktionsnummer`, `Seriennr. Kasse`, `Seriennr. TSE`, `Prüfwert`,
`Signaturzähler` samt der beiden TSE-Zeitstempel, `VU-Nummer`, `Autorisierungsnummer`,
`T-ID`/`TA-Nr.`/`Beleg-Nr.`. Der unlesbare Signatur-/QR-Rest am Ende der beiden
Jack-Wolfskin-Belege (nach den Händler-Stammdaten) wurde vorsorglich komplett
ziffernneutralisiert, da er vermutlich weitere TSE-Reste enthält, aber ohnehin nicht
mehr als Fließtext lesbar ist.

Artikelnamen, Preise, Rabatte, Datum/Uhrzeit und die Händler-Stammdaten (Name, Adresse,
USt-ID) blieben unverändert — sie sind der eigentliche Prüfgegenstand der
Qualitätsprüfung (Beträge, Summenzeile, Datum) bzw. ohnehin öffentliche Geschäftsdaten,
keine personenbezogenen Zahlungsdaten.

## TSV-Vorlagen (seit 2026-09-16)

| Datei | Zweck |
|---|---|
| `lidl-kurz-448px.tsv` | echte Tesseract-TSV (`deu`, `--psm 6`, Konfiguration `tsv`) desselben Bons wie `lidl-kurz-448px.txt` |
| `lidl-kurz-448px.tsv.erwartet.txt` | der daraus zusammengebaute Text — friert die Zusammenbau-Regel ein |

**Warum es diese Vorlagen gibt.** Fuer Koordinaten und Confidence braucht Tesseract die
TSV-Ausgabe statt `stdout`. Damit stellt sich die Frage, ob der aus TSV zusammengebaute
Text derselbe ist wie der bisherige — denn der Text ist das, was das Modell zu sehen
bekommt, und er darf sich durch die OCR-Abstraktion nicht veraendern. **Gemessen am
2026-09-16 im ausgelieferten Abbild an allen sechs Bildern: zeichengenau gleich**
(1251, 1467, 2032, 1942, 1703 und 187 Zeichen). Der Test gegen diese Vorlage friert die
Regel ein, damit sie nicht spaeter still abdriftet.

**Anonymisierung der TSV.** Die Textspalte wurde wortgenau aus der bereits anonymisierten
`lidl-kurz-448px.txt` uebernommen — 52 der 54 Zeilen liessen sich so eins zu eins
abbilden. Die zwei Zeilen, bei denen die urspruengliche Anonymisierung Leerzeichen
zusammengezogen hatte (ein verstuemmeltes Signaturfragment und die Kartennummer), wurden
stattdessen **vollstaendig** formerhaltend neutralisiert — im Zweifel mehr ersetzen, nicht
weniger. Die Rekonstruktion weicht deshalb genau an diesen beiden Zeilen von der
`.txt`-Vorlage ab; Artikelzeilen, Betraege und Summe sind identisch.
