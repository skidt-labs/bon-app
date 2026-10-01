# Bon-App

Kassenbons fotografieren, auslesen lassen, prüfen, auswerten — für einen Haushalt,
selbst betrieben.

Ein Bon kommt per Handy-Kamera in der App oder als Foto über einen Matrix-Chat herein.
Eine OCR-Engine liest den Text, ein Sprachmodell macht daraus Händler, Datum, Positionen
und Beträge, ein Mensch prüft das Ergebnis gegen das Bild. Danach zählt der Bon in den
Berichten: Ausgaben je Monat, Kategorie und Händler, Budgets („Töpfe"), CSV-Export.

## Was die App kann

- **Scannen:** Foto aus der Kamera oder mehrere auf einmal aus der Galerie. Die App sucht
  den Rand des Bons selbst, entzerrt ein schräges Foto, dreht in Vierteln und fein. Ohne
  Netz wartet das Foto in einer Warteschlange im Browser und geht raus, sobald es geht.
- **Auslesen im Hintergrund:** Eine Vorprüfung lässt Kauderwelsch nicht zum Modell;
  angeschnittene Fotos kommen trotzdem durch. Ist das Bild gar kein Kassenbon (kaum Text,
  Text ohne Preise, Kartenbeleg), sagt die App das und bietet Verwerfen oder „Doch ein Bon“ an.
- **Prüfen:** Bild und Positionen nebeneinander, die gewählte Zeile ist im Bild markiert.
  Rechenprobe je Zeile, Hinweis auf vermutete Doppel (zweites Foto desselben Einkaufs).
  Ein fehlgeschlagener Bon lässt sich von Hand eintragen, das Bild nachträglich zuschneiden
  und neu lesen — das Original bleibt erhalten.
- **Kategorien:** zuerst aus dem Gelernten, dann vom Sprachmodell (übersprungene Zeilen
  werden nachgefragt). Jede Korrektur von Hand wird zur Regel für den nächsten Bon.
- **Papierkorb:** Jeder Bon lässt sich verwerfen und 30 Tage lang wiederherstellen; danach
  löscht der Worker ihn samt Bildern.
- **Berichte:** Monat, Jahr oder Zeitraum; Filter nach Laden, Kategorie, Person, Betrag,
  Topf, Suchbegriff; gespeicherte Berichte; CSV, Druckansicht und eine Zusammenfassung per
  Matrix.

## Grundsätze

- **Das Foto bleibt im Haus.** Voreingestellt ist der Textweg: die OCR läuft auf dem
  eigenen Server, an das Sprachmodell gehen nur die gelesenen Zeichen. Wer das Bild
  selbst an ein Modell schicken will, muss das ausdrücklich bestätigen
  (`EXTRACTION_BILDWEG_BESTAETIGT=ja`).
- **Kein stiller Rückfall.** Fehlt eine Einstellung oder ist sie falsch, startet der Dienst
  mit einer klaren Meldung nicht, statt still etwas anderes zu tun.
- **Geteilt und privat.** Bons und Töpfe sind entweder für den ganzen Haushalt sichtbar
  oder nur für die Person, die sie angelegt hat. Auch Verwalter sehen fremde private Bons
  nicht.
- **Der Betreiber verwaltet, sieht nicht hinein.** Die Betriebsseite (`/betrieb`) regelt
  KI-Anbieter und Protokoll, gibt aber keinen Zugang zu den Bons der Haushalte.

## Bausteine

| Dienst | Aufgabe |
|---|---|
| `bon-web` | SvelteKit-Oberfläche und API |
| `bon-worker` | Auslese-Warteschlange (pg-boss): OCR, Sprachmodell, Plausibilitätsprüfung, Kategorien; leert täglich den Papierkorb |
| `bon-matrix` | Matrix-Bot: nimmt Bonfotos im Direktchat an, koppelt Konten per Code |
| `bon-paddleocr` | optionale zweite OCR-Engine (Vorgabe ist Tesseract im Worker) |
| `bon-db` | PostgreSQL |

Anmeldung läuft über OpenID Connect (getestet mit Authentik). Als Sprachmodell geht jeder
OpenAI-kompatible Endpunkt — lokal (LM Studio, Ollama, MLX, llama.cpp) oder in der Cloud.
Anbieter lassen sich zur Laufzeit unter `/betrieb/ki` eintragen; ihre Schlüssel liegen
verschlüsselt in der Datenbank (`SECRETS_KEY`).

## Einrichten

Voraussetzungen: Docker mit Compose, ein OIDC-Anbieter, ein Reverse-Proxy. Die
mitgelieferte `compose.yaml` ist für Traefik im externen Netz `proxy` geschrieben; bei
einem anderen Proxy die `labels` anpassen.

```sh
cp .env.example .env              # Werte eintragen; jede Variable ist dort erklärt
mkdir -p secrets
openssl rand -base64 32 > secrets/db-password
chmod 600 secrets/db-password

docker compose build
docker compose up -d bon-db
npm ci
DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" npm run db:migrate
docker compose up -d
```

Wer die Abbilder in eine eigene Registry schiebt: `BON_REGISTRY` in `.env` setzen, dann
`scripts/release.sh <version>` (Tests, Tag, Bauen, Schieben).

## Entwickeln

```sh
npm ci
npm run dev
npm test          # Vitest
npm run check     # svelte-check
```

Tests gegen eine echte Datenbank laufen nur mit `RUN_DB_TESTS=1` und `DATABASE_URL` —
bitte nie gegen eine Produktionsdatenbank.

## Lizenz

[GNU Affero General Public License v3.0](LICENSE) oder neuer. Wer eine veränderte Fassung
als Dienst für andere betreibt, muss deren Quelltext ebenfalls zugänglich machen.
