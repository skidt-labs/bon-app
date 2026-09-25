#!/usr/bin/env bash
#
# Bringt den aktuellen Stand in das öffentliche Repository — bereinigt, ohne Historie.
#
#   scripts/veroeffentlichen.sh            zeigt nur, was sich ändern würde
#   scripts/veroeffentlichen.sh --push     committet und schiebt es wirklich
#
# Warum ein eigenes Repository statt `git push`: Die Historie dieses Arbeits-Repos
# enthält Fassungen mit Angaben, die nicht öffentlich sein sollen. Ein einziger
# `git push` machte sie unwiderruflich lesbar, auch wenn sie später gelöscht würden.
# Deshalb hat dieses Repo absichtlich KEIN Remote, und öffentlich wird nur ein
# Schnappschuss von HEAD, der vorher eine Sperrwortsuche bestanden hat.
#
# Alles Instanzspezifische liegt unversioniert unter .veroeffentlichen/:
#   sperrliste   ein erweiterter regulärer Ausdruck je Zeile (Groß/klein egal),
#                '#' leitet Kommentare ein. Ein Treffer bricht ab.
#   ziel         die Git-Adresse des öffentlichen Repos (eine Zeile)
#   repo/        der lokale Klon des öffentlichen Repos (legt das Skript an)
# Die Sperrliste selbst gehört nicht ins Repo: Sie nennt ja genau das, was
# niemand lesen soll.
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WURZEL"
ORT="$WURZEL/.veroeffentlichen"
SPERRLISTE="$ORT/sperrliste"
ZIEL_DATEI="$ORT/ziel"
KLON="$ORT/repo"

# Was nie hinausgeht, auch wenn es versioniert ist. Pfade relativ zur Wurzel.
AUSSCHLIESSEN=(docs)

PUSH=nein
case "${1:-}" in
	'') ;;
	--push) PUSH=ja ;;
	*) echo "Aufruf: $0 [--push]" >&2; exit 64 ;;
esac

fehler() { echo "FEHLER: $*" >&2; exit 1; }

[ -s "$SPERRLISTE" ] || fehler "$SPERRLISTE fehlt oder ist leer. Ohne Sperrliste wird nichts veröffentlicht."
[ -s "$ZIEL_DATEI" ] || fehler "$ZIEL_DATEI fehlt (eine Zeile: Git-Adresse des öffentlichen Repos)."
ZIEL="$(head -1 "$ZIEL_DATEI")"

# Muster einlesen: Kommentare und Leerzeilen weg. Leere Liste ist ein Fehler, keine
# Freigabe — eine versehentlich geleerte Datei darf nicht alles durchwinken.
mapfile -t MUSTER < <(sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$SPERRLISTE" | grep -v '^$' || true)
[ "${#MUSTER[@]}" -gt 0 ] || fehler "$SPERRLISTE enthält keine Muster."

# Nur Committetes geht hinaus. Ungespeicherte Änderungen würden sonst zwar nicht
# veröffentlicht, aber man hielte sie für veröffentlicht.
if ! git diff --quiet || ! git diff --cached --quiet; then
	git status --short >&2
	fehler "Der Arbeitsbaum hat ungespeicherte Änderungen."
fi

STAND="$(git rev-parse --short HEAD)"
VERSION="$(node -p "require('./package.json').version")"
TAG="$(git describe --exact-match --tags HEAD 2>/dev/null || true)"

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
EXPORT="$ARBEIT/export"
mkdir -p "$EXPORT"

echo "==> Schnappschuss von HEAD ($STAND, Fassung $VERSION)"
git archive HEAD | tar -x -C "$EXPORT"
for p in "${AUSSCHLIESSEN[@]}"; do rm -rf "${EXPORT:?}/$p"; done

echo "==> Sperrwortsuche (${#MUSTER[@]} Muster)"
TREFFER="$ARBEIT/treffer"
: > "$TREFFER"
for m in "${MUSTER[@]}"; do
	# Inhalt, auch in Binärdateien (-a): ein Name in den Metadaten eines Bildes ist
	# genauso veröffentlicht wie einer im Quelltext. Ausgegeben wird nur die Datei,
	# nicht die Zeile — Binärzeilen wären unlesbar.
	#
	# Bewusst ohne sed und ohne `|| true` über der ganzen Kette: ein Muster wie
	# `10\.(7|24)` zerlegte einen sed-Ausdruck mit '|' als Trenner, sed scheiterte,
	# und die Treffer gingen still verloren. grep liefert 1 für „nichts gefunden",
	# alles darüber ist ein echter Fehler und bricht ab.
	rc=0; dateien="$(grep -rilaE -- "$m" "$EXPORT")" || rc=$?
	[ "$rc" -le 1 ] || fehler "grep scheiterte an Muster [$m] (Rückgabe $rc)."
	while IFS= read -r d; do
		[ -n "$d" ] && printf '  Inhalt  [%s]  %s\n' "$m" "${d#"$EXPORT"/}" >> "$TREFFER"
	done <<< "$dateien"
	# Datei- und Verzeichnisnamen
	rc=0; namen="$(cd "$EXPORT" && find . -print | grep -iE -- "$m")" || rc=$?
	[ "$rc" -le 1 ] || fehler "grep scheiterte an Muster [$m] (Rückgabe $rc)."
	while IFS= read -r d; do
		[ -n "$d" ] && printf '  Name    [%s]  %s\n' "$m" "${d#./}" >> "$TREFFER"
	done <<< "$namen"
done
# Echte Geheimwerte aus .env und secrets/ — ohne sie irgendwo aufzuschreiben. Nur
# Schlüssel mit Geheimnis-Namen: eine Adresse oder ein Modellname in .env darf auch
# im Quelltext stehen. Ausgegeben wird der NAME, nie der Wert.
if [ -f .env ]; then
	while IFS='=' read -r name wert; do
		[ "${#wert}" -ge 8 ] || continue
		if grep -rqaF -- "$wert" "$EXPORT"; then echo "  Geheimwert aus .env: $name" >> "$TREFFER"; fi
	done < <(grep -E '^[A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD|PASSWORT)[A-Z0-9_]*=' .env || true)
fi
for f in secrets/*; do
	[ -f "$f" ] || continue
	wert="$(head -1 "$f")"
	[ "${#wert}" -ge 8 ] || continue
	if grep -rqaF -- "$wert" "$EXPORT"; then echo "  Geheimwert aus $f" >> "$TREFFER"; fi
done
if [ -s "$TREFFER" ]; then
	sort -u "$TREFFER" >&2
	fehler "Sperrwörter gefunden — nichts veröffentlicht. Erst im Arbeits-Repo bereinigen und committen."
fi
echo "    keine Treffer"

echo "==> Öffentliches Repo abgleichen"
if [ ! -d "$KLON/.git" ]; then
	git clone -q "$ZIEL" "$KLON"
fi
# Dieselbe Identität wie hier, sonst stünde im öffentlichen Repo, was der Rechner
# gerade global eingestellt hat.
git -C "$KLON" config user.name "$(git config user.name)"
git -C "$KLON" config user.email "$(git config user.email)"
git -C "$KLON" fetch -q origin
ZWEIG="$(git -C "$KLON" symbolic-ref --short HEAD)"
# Der Klon ist nur Durchgangsstation. Sollte dort jemand von Hand etwas geändert
# haben, gilt trotzdem der Stand auf GitHub plus dieser Schnappschuss.
git -C "$KLON" reset -q --hard "origin/$ZWEIG"
git -C "$KLON" clean -qfdx
rsync -a --delete --exclude=.git "$EXPORT/" "$KLON/"
git -C "$KLON" add -A

if git -C "$KLON" diff --cached --quiet; then
	echo "    nichts Neues — das öffentliche Repo ist auf diesem Stand."
	if [ -n "$TAG" ] && ! git -C "$KLON" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
		echo "    (Tag $TAG fehlt dort noch; er wird mit dem nächsten --push gesetzt.)"
		[ "$PUSH" = ja ] || exit 0
		git -C "$KLON" tag -a "$TAG" -m "Fassung ${TAG#v}"
		git -C "$KLON" push -q origin "$TAG"
		echo "==> Tag $TAG geschoben"
	fi
	exit 0
fi

git -C "$KLON" diff --cached --stat | tail -25

NACHRICHT="Stand $VERSION"
[ -n "$TAG" ] && NACHRICHT="Fassung ${TAG#v}"

if [ "$PUSH" != ja ]; then
	echo
	echo "Probelauf: nichts committet, nichts geschoben."
	echo "Veröffentlichen mit:  $0 --push   (Nachricht: \"$NACHRICHT\"${TAG:+, Tag $TAG})"
	git -C "$KLON" reset -q --hard "origin/$ZWEIG"
	exit 0
fi

git -C "$KLON" commit -q -m "$NACHRICHT"
git -C "$KLON" push -q origin "$ZWEIG"
if [ -n "$TAG" ] && ! git -C "$KLON" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	git -C "$KLON" tag -a "$TAG" -m "Fassung ${TAG#v}"
	git -C "$KLON" push -q origin "$TAG"
fi
echo "==> Veröffentlicht: $NACHRICHT ($(git -C "$KLON" rev-parse --short HEAD))${TAG:+, Tag $TAG}"
