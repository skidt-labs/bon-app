#!/usr/bin/env bash
#
# Veroeffentlicht eine Fassung der Bon-App in die eigene Registry.
#
# Von Hand sind das sechs Schritte, und der, den man vergisst, ist immer derselbe:
# das Schild :latest. Dann zeigt es wochenlang auf etwas Altes und niemand merkt es.
#
#   scripts/release.sh 0.2.0
#
# Voraussetzung: BON_REGISTRY in .env (oder in der Umgebung) und einmalig
# `docker login <registry>`.
set -euo pipefail

ABBILD=bon-app
WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WURZEL"

# Dieselbe Quelle wie compose.yaml, damit Bauen und Betreiben nie auf zwei
# verschiedene Registries zeigen.
REGISTRY="${BON_REGISTRY:-$(sed -n 's/^BON_REGISTRY=//p' .env 2>/dev/null | tail -1)}"
if [ -z "$REGISTRY" ]; then
	echo "FEHLER: BON_REGISTRY ist weder in der Umgebung noch in .env gesetzt." >&2
	exit 64
fi

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
	echo "Aufruf: $0 <version>   z. B. $0 0.2.0" >&2
	exit 64
fi

# Nur echte Semver. "v0.2.0" oder "0.2" wuerden spaeter als Abbild-Schild zwar
# funktionieren, aber nicht mehr zur package.json passen — und genau diese
# stille Abweichung soll die Versionierung ja verhindern.
if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
	echo "FEHLER: '$VERSION' ist keine Semver-Nummer (erwartet z. B. 0.2.0 oder 1.0.0-rc.1)." >&2
	exit 64
fi

# Ein Abbild aus einem schmutzigen Arbeitsbaum ist nicht rueckverfolgbar: der Tag
# zeigt dann auf Quelltext, der so nie gebaut wurde. Unversionierte Dateien stoeren
# nicht — sie liegen ohnehin nicht im Build-Kontext (.dockerignore).
if ! git diff --quiet || ! git diff --cached --quiet; then
	echo "FEHLER: Der Arbeitsbaum hat ungespeicherte Aenderungen." >&2
	git status --short >&2
	exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
	echo "FEHLER: Der Tag v$VERSION gibt es schon." >&2
	exit 1
fi

echo "==> Version in package.json setzen"
npm version "$VERSION" --no-git-tag-version >/dev/null

echo "==> Tests"
npx vitest run

echo "==> Commit und Tag"
git add package.json package-lock.json
git commit -m "Fassung $VERSION"
git tag -a "v$VERSION" -m "Fassung $VERSION"

echo "==> Bauen"
# Bewusst `docker build` und nicht `docker compose build`: compose beschildert das
# Abbild mit dem image:-Eintrag aus compose.yaml — also der Fassung, die dort steht,
# nicht der, die gerade veroeffentlicht wird. Das Schild muss hier aus $VERSION kommen.
docker build --target runtime -t "$REGISTRY/$ABBILD:$VERSION" .
docker tag "$REGISTRY/$ABBILD:$VERSION" "$REGISTRY/$ABBILD:latest"

echo "==> Schieben"
docker push "$REGISTRY/$ABBILD:$VERSION"
docker push "$REGISTRY/$ABBILD:latest"

cat <<ENDE

Fertig: $REGISTRY/$ABBILD:$VERSION (und :latest)

Noch NICHT geschehen — bewusst, das ist eine eigene Entscheidung:
  * compose.yaml zeigt weiterhin auf die Fassung, die dort eingetragen ist
  * die laufenden Container wurden nicht neu gestartet
  * der Tag ist lokal; oeffentlich wird er mit scripts/veroeffentlichen.sh --push
ENDE
