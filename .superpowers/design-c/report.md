# Design-C Umsetzung — laufender Bericht

Auftrag: freigegebene Gestaltungsrichtung (Design C) auf drei Bildschirme umsetzen,
Verhalten unangetastet. Dieser Bericht wächst mit, damit bei einem Abbruch nichts
verloren geht.

## Startpunkt (verifiziert)

- `npx vitest run` → 285 grün, 8 übersprungen (Baseline vor jeder Änderung geprüft)
- `npm run check` → 0 Fehler, 0 Warnungen

## Entscheidungen, die für alle drei Screens gelten

- Schrift Manrope wird NICHT global (app.html/layout.css) eingebunden, sondern je
  Screen per `<svelte:head>` (preconnect + Stylesheet mit `media="print"` →
  `onload` auf `all`, plus `<noscript>`-Fallback). So bleibt die Änderung auf die
  drei Zieldateien beschränkt, blockiert das erste Zeichnen nicht und hat eine
  echte Rückfallkette (`font-[Manrope,system-ui,sans-serif]` auf dem äusseren
  Wrapper — Tailwind-Arbitrary-Value, kein Inline-Style).
- Farben aus der Vorgabe als Tailwind-Arbitrary-Hex-Klassen (`bg-[#1f548a]` etc.),
  keine neue Theme-Datei angelegt — hält den Diff auf die drei Routen beschränkt.
- Emoji ⚠/✓ durch Inline-SVG ersetzt (kleine generische Icon-Pfade: Kreis-Alert,
  Dreieck-Alert, Checkmark, Chevron, Uhr, Kamera, Galerie).
- Grundsatz bei jeder Template-Änderung: nur `class`/rein dekorative Wrapper
  geändert, KEINE Handler, Bindings, Bedingungen, Tags mit Verhalten
  (button/select/input/a) entfernt oder neu hinzugefügt — nur umgestylt.

## Screen 1: src/routes/+page.svelte (Scannen)

Status: FERTIG, committet.

- Kamera-Button und Galerie-Button (beide `<label>` mit verstecktem `<input>`,
  einer mit `capture`, einer mit `multiple`) unverändert in Funktion, nur restyled.
- Wartende-Uploads-Banner (`{#if waiting > 0}`) bewusst AUSSERHALB des
  if/else-Blocks belassen (genau wie vorher) — Kommentar im Code sagt, das ist
  Absicht: sichtbar auf JEDEM Bildschirm (Menü UND Zuschnitt), nicht nur der
  Auswahlseite. Nur die Optik geändert (Amber-Karte mit Uhr-Icon), Platzierung/
  Sichtbarkeitsregel unangetastet.
- Eckenzuschnitt: `h-11 w-11` (44×44 px Trefferfläche) UNVERÄNDERT gelassen (nur
  Farbe des inneren Punktes von `bg-black/60` auf `bg-[#07aeb7]/70` geändert).
  `MIN_CORNER_SCREEN_GAP = 48` im Skript nicht angefasst.
- Font-Loading via `<svelte:head>` in dieser Datei (siehe oben).

### Nicht gebaut / bewusst weggelassen (Startseite)

- Der Entwurf zeigt eine "Posteingang"-Karte mit einer Zahl in einem Kreis-Badge
  ("3") und Untertitel "3 Bons warten auf deine Prüfung". Diese Zahl gibt es auf
  dieser Seite NICHT — `+page.svelte` bekommt hier nur `{ user }` aus dem
  Layout-Load, keine Posteingangs-Zählung. Eine neue Server-Abfrage dafür wäre
  eine Verhaltens-/Datenänderung, keine reine Darstellung. Stattdessen: Karte
  ohne Zahl, mit neutralem Untertitel "Bons ansehen und prüfen".
- Fusszeilen-Links "Haushalt" / "Matrix-Anbindung" aus dem Entwurf NICHT gebaut:
  von dieser Seite aus gab es vorher gar keine Navigation zu den Settings-Seiten
  (auch nicht unstyled) — das wäre neue Funktionalität, keine reine Optik.

## Screen 2: src/routes/inbox/+page.svelte (Posteingang)

Status: ausstehend.

## Screen 3: src/routes/receipts/[id]/+page.svelte (Prüfen)

Status: ausstehend.

## Screen 2: src/routes/inbox/+page.svelte (Posteingang) — Update

Status: FERTIG, committet.

- Zeilenstruktur umgebaut von "zwei nebeneinander stehende Spans" auf
  Titel/Preis-Zeile + Datumszeile + optionale Hinweiszeile(n) — reine
  Layout-Umstrukturierung, jede bestehende Bedingung blieb erhalten
  (`r.problems?.length` unverändert als eigener, unveränderter `{#if}`-Block,
  `label[r.status] ?? r.status` unverändert, `r.merchant ?? 'Unbekannter
  Händler'` unverändert, `r.totalGrossCents !== null ? ... : '—'` unverändert).
- NEU (rein zusätzliche Anzeige, keine neue Abfrage): Datum/Uhrzeit aus
  `r.purchasedAt`/`r.createdAt` — beide Felder waren im `+page.server.ts`
  bereits geladen, im Template aber bisher ungenutzt. Format bewusst absolut
  ("15.09.2026, 18:42"), kein "heute/gestern" — das bräuchte einen
  Zeitvergleich beim Rendern, der nach Mitternacht veralten würde.
- NEU (rein aus bereits geladener Liste abgeleitet, keine neue Abfrage):
  Kopfzeile "{wartend} warten auf dich · {bestaetigt} bestätigt" —
  wartend = alle Bons mit status !== 'confirmed', bestaetigt = status ===
  'confirmed'. Judgement-Call: es gibt keine feinere Bucket-Logik im Code
  (kein "braucht Aktion" vs. "läuft noch"), daher bewusst nur der grobe
  Zwei-Wege-Split über das vorhandene `status`-Feld.
- Fehlgeschlagen-Zustand (`status === 'failed'`): NEUER, dauerhaft sichtbarer
  Text "Auslesen fehlgeschlagen. Das Bild ist gespeichert." — bewusst OHNE
  den im Entwurf gezeigten Hinweis auf einen neuen Versuch (siehe unten,
  das ist der im Auftrag genannte Fall).
- `€`-Suffix bei Beträgen ergänzt (reine Formatierung, `formatCents` selbst
  unangetastet) — vorher zeigte die App nirgends ein Euro-Zeichen.
- ⚠/✓ durch Inline-SVG ersetzt (Kreis-Alert amber, Dreieck-Alert rot,
  Checkmark teal).
- "Bon scannen"-Link am Fuss: gleicher `<a href="/">` wie vorher, nur von
  kleinem unterstrichenem Text zu grossem Button (56px) umgestylt.

### Nicht gebaut / bewusst weggelassen (Posteingang)

- Der Entwurf zeigt beim fehlgeschlagenen Bon "tippen für einen neuen
  Versuch" — das gibt es nicht (kein Retry-Mechanismus im Code). Text
  bewusst neutral gehalten, keine Funktion behauptet, die es nicht gibt.
- Positionsanzahl je Bon ("14 Positionen") aus dem Entwurf NICHT gebaut:
  `+page.server.ts` lädt keine Item-Zählung je Bon, das bräuchte eine neue
  Abfrage/einen Join — das wäre eine Datenänderung, keine reine Darstellung.
- Relative "vor 4 Sek."-Anzeige für den "wird ausgelesen"-Zustand NICHT
  gebaut: bräuchte einen laufenden Timer (neues Laufzeitverhalten), keine
  reine Darstellung vorhandener Daten. Stattdessen fester Zeitstempel wie
  bei allen anderen Zeilen.
- 'pending'-Status kommt im Entwurf nicht vor; visuell wie 'extracting'
  behandelt (neutrale Karte, Punkt-Indikator) — Judgement-Call, da beides
  Vorstufen vor 'review' sind.

## Screen 3: src/routes/receipts/[id]/+page.svelte (Prüfen)

Status: FERTIG, committet.

Script-Block: NUR eine rein additive Funktion `formatWann` ans Ende angehängt
(gleiche Formatierung wie im Posteingang, aus bereits geladenem
`data.receipt.purchasedAt`). Keine bestehende Zeile im Script geändert.

Verhalten unangetastet (verifiziert gegen die Schutzliste des Auftrags):
- Sprung-Zoom (`zoom` $derived, `style="transform-origin/scale"` am `<img>`):
  Bindung unverändert übernommen, nur Container drumherum restyled
  (rounded-2xl, Platzhalterfarbe `#eef2f6` statt `bg-gray-100`).
- ⚠-Markierung der umnummerierten Zeile (`item.id === renumberedId`) + die
  Regel, dass für sie NICHT gezoomt wird (`zoom`-Funktion unverändert):
  Emoji durch Inline-SVG (Kreis-Alert) ersetzt, `title`-Attribut mit der
  ausführlichen Erklärung unverändert erhalten (nur jetzt auf dem
  `<span>`-Wrapper um das SVG statt auf einem `<span>` um das Emoji).
- `appliesToLine`-Anzeige inkl. "(nicht gefunden)": Text und Bedingung
  (`broken`) unverändert, nur Farbklassen ausgetauscht.
- Rote Markierung unlesbarer Preiseingaben: `aria-invalid`, `ungueltigePreise`-
  Zustand und die Weigerung von `confirm()` (offeneEingaben > 0) unverändert;
  nur `border-red-500`/`bg-red-50` durch `border-[#c2553f]`/`bg-[#fbeae7]`
  ersetzt (kein offizieller Fehler-Flächenton in der Vorgabe enthalten, daher
  ein heller Farbton aus derselben Fehler-Familie #c2553f gewählt).
- Abgleich auf Bon-ID im `$effect`: nicht angefasst.
- "Braucht dich"-Bereich: gleiche Schleife über `attention`, gleicher
  `idx`-Lookup, gleiche Select-/Input-Felder je Zeile, nur als eigene
  gerundete Karte statt randloser Sektion und mit ≥44px hohen Feldern.
- Alle Positionen (`items`-Liste): JEDE Zeile behält Select (`lineType`) und
  Preis-Input wie vorher — die Reihen wurden NICHT wie im Entwurf auf
  "kompakt vs. aufgeklappt" reduziert (der Entwurf zeigt bei nicht-
  ausgewählten Zeilen nur Name+Preis ohne Eingabefelder). Das hätte bedeutet,
  Bedienelemente für nicht-ausgewählte Zeilen aus dem DOM zu nehmen und den
  Bearbeitungsweg auf "erst antippen, dann bearbeiten" umzustellen — eine
  Verhaltensänderung, keine reine Darstellung. Stattdessen: alle Zeilen
  bleiben gleich bedienbar, die ausgewählte Zeile bekommt nur einen
  auffälligeren Rahmen (`ring-2 ring-[#07aeb7]` statt `bg-gray-50`).
- ✓/⚠ im Kopf- und Fussbereich (Summen-Abgleich) durch Inline-SVG ersetzt,
  Logik (`sumOk`-Vergleich) unverändert.
- Alle Select-/Input-Felder auf ≥44px Höhe gebracht (vorher `text-xs`,
  `py-0.5`/`py-1` — deutlich unter 44px).

Zusätzlich (rein aus bereits geladenen Daten, keine neue Abfrage): Kopfzeile
zeigt jetzt auch Bon-Summe (`data.receipt.totalGrossCents`, war bereits
geladen, nur bisher nur im Footer gezeigt) und "Datum, Uhrzeit · N Positionen"
(`data.receipt.purchasedAt`, `items.length`).

### Nicht gebaut / bewusst weggelassen (Prüfen)

- Das "Zeile N"-Abzeichen auf dem Bon-Foto aus dem Entwurf NICHT gebaut.
  Zwar liesse sich `items[selected].lineNo` anzeigen (das Feld existiert),
  aber genau für die umnummerierte Zeile wäre diese Zahl irreführend: das
  Bild bleibt für sie bewusst ungezoomt, weil ihre wahre Position auf dem
  Papier laut Ruling 58 in grouping.ts nicht rekonstruierbar ist. Eine
  Zeilennummer trotzdem als Bildunterschrift zu zeigen, würde in genau dem
  Fall, den der Code besonders sorgfältig behandelt, einen falschen Eindruck
  von Präzision erwecken.
- Das "im Foto"-Abzeichen (grüner Pill an der ausgewählten Position im
  Entwurf) NICHT gebaut: kein Feld im Code entspricht eindeutig dieser
  Aussage: das wäre Raten.
- Der Entwurf zeigt bei nicht-ausgewählten Positionen keine Eingabefelder
  (kompakt vs. aufgeklappt) — siehe oben, bewusst nicht umgesetzt, da
  Verhaltensänderung.

## Nachtrag: Sackgassen schliessen (vom Betreiber freigegeben, nach Screen 3)

Auftrag erweitert: `/settings/household`, `/settings/matrix` und
`/receipts/[id]` sind Sackgassen (nur Browser-Zurück). Je ein schlichter
Rückweg ergänzt, KEIN Menü/keine Navigationsleiste, `+layout.svelte`
unangetastet:
- `/settings/household` → Link zur Startseite ("/")
- `/settings/matrix` → Link zur Startseite ("/")
- `/receipts/[id]` → Link zum Posteingang ("/inbox")
- `/inbox` und `/` unverändert (hatten bereits Wege zueinander)

Status: siehe unten.

Umgesetzt (nach Fertigstellung von Screen 3, eigener Commit):
- `src/routes/settings/household/+page.svelte`: Link "Start" (Chevron-Link +
  Text) oben in `<main>` eingefügt, führt zu `/`. 44px hohe Trefferfläche
  (`h-11`), Inline-SVG-Chevron, Rest der Seite unangetastet (bewusst nicht
  auf Design C umgestylt — das ist nicht Teil dieses Auftrags).
- `src/routes/settings/matrix/+page.svelte`: identischer "Start"-Link, gleiche
  Stelle, Rest unangetastet.
- `src/routes/receipts/[id]/+page.svelte`: Icon-only-Rückweg (44×44px,
  `aria-label="Zurück zum Posteingang"`) zu `/inbox`, oberhalb der
  "Bon prüfen"-Kopfzeile, im Stil von Design C (gleiche Chevron-Form wie bei
  den Settings-Seiten, aber ohne Text — der Kopfbereich ist dort schon eng).
- `+layout.svelte`/`layout.css` NICHT angefasst.
- `npm run check` weiterhin 0/0, `npx vitest run` weiterhin 285 grün / 8
  übersprungen.

Alle drei Rückwege sind reine `<a>`-Links zu bereits existierenden Routen
("/" bzw. "/inbox") — keine neue Route, kein neuer Zustand, kein Menü.

## Korrekturrunde nach Rückmeldung des Betreibers

Zwei Punkte aus meinem ersten Durchlauf wurden korrigiert (Details siehe
Nachricht des Koordinators, hier nur die Umsetzung):

### 1) Kompakte Positionsliste jetzt doch gebaut (Prüf-Ansicht)

Ich hatte das Aufklappen weggelassen, weil das Entfernen von Bedienelementen
für nicht ausgewählte Zeilen wie eine Verhaltensänderung aussah. Klargestellt:
der Entwurf wurde genau wegen dieser Eigenschaft freigegeben (sonst bei 14+
Positionen eine sehr lange Liste voller Formularfelder) — das war ein
Widerspruch zwischen Auftrag und freigegebenem Entwurf, keine offene Frage
mehr.

Umsetzung in `src/routes/receipts/[id]/+page.svelte`: JEDE `<li>` verzweigt
jetzt auf `{#if selected === i}`:
- **Ausgewählt** (aufgeklappt): zeigt weiterhin `select` (lineType) und
  `input` (Preis) — exakt dieselben Bindings/Handler wie vorher
  (`bind:value={item.lineType}`, `oninput={(e) => setPrice(i, ...)}`,
  `onfocus={() => (selected = i)}`), nur jetzt nicht mehr in einem `<button>`
  verschachtelt (vorher stand ein `<select>` innerhalb eines `<button>` —
  ungültiges HTML-Nesting; jetzt sind beide Felder direkte Kinder eines
  `<div>`, funktional identisch, technisch sauberer).
- **Nicht ausgewählt** (kompakt, ~46px hoch): `<button onclick={() =>
  (selected = i)}>` mit Name, Betrag, der ⚠-Markierung der umnummerierten
  Zeile (`item.id === renumberedId`, gleiches `title`-Attribut) und dem
  `appliesToLine`-Hinweis inkl. "(nicht gefunden)" (`broken`-Bedingung
  unverändert) — alles wie vorher sichtbar, nur ohne Auswahl-/Preisfeld.
  Antippen waehlt die Zeile aus (`selected = i`), treibt denselben
  Sprung-Zoom wie vorher (keine neue Zustandsvariable, wie im Auftrag
  gefordert) und klappt sie dadurch auf.
- "Braucht dich"-Bereich unverändert immer aufgeklappt (dort war es so
  vorgesehen).

Kosten (vom Betreiber akzeptiert): eine Preis-/Typkorrektur an Zeile 9
braucht jetzt einen Tipp mehr (erst antippen zum Aufklappen), dafür ist die
Liste bei langen Bons deutlich kürzer.

### 2) Posteingang-Kopfzeile behauptete zu viel

`wartend` zählte vorher `status !== 'confirmed'` — das schloss `pending` und
`extracting` ein, die auf die Maschine warten, nicht auf den Menschen. Der
Satz "X warten auf dich" behauptete damit eine Handlung, die in dem Moment
niemand leisten kann.

Korrigiert in `src/routes/inbox/+page.svelte`: `wartend` zählt jetzt nur noch
`status === 'review' || status === 'failed'`. `pending`/`extracting` werden
in der Kopfzeile nicht mehr mitgezählt (weder eigens benannt noch
fälschlich als "wartet auf dich" verbucht) — sie bleiben in der Liste
selbst über das Punkt-Icon/den gedämpften Stil erkennbar.

### Verifikation nach beiden Korrekturen

- `npx vitest run` → 285 grün, 8 übersprungen
- `npm run check` → 0 Fehler, 0 Warnungen
- `npm run build` → erfolgreich
