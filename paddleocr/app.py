"""
bon-paddleocr — PaddleOCR hinter einer schmalen HTTP-Schnittstelle.

Der Dienst LIEST, er deutet nicht. Er gibt die Erkennungen so zurueck, wie PaddleOCR
sie erzeugt (Text, Confidence, Rahmen), dazu die eigene Laufzeit, die Versionen und
die tatsaechlich benutzten Optionen. Das Zusammensetzen zum Bon-Text und die
Entscheidung, ob daraus etwas Lesbares wurde, passieren im Aufrufer
(`src/lib/server/ocr/paddle.ts`) — dort liegen die Tests und die eingefrorenen
Vorlagen, hier liegt nur die Engine.

Drei Auflagen aus der Machbarkeitsprobe (Etappe 0), alle drei hier verankert:
  1. Basis-Abbild `paddlepaddle/paddle:2.6.2` — die einzige Kombination, die laeuft.
  2. det_limit_side_len=8000 / det_limit_type='max' — FEST, kein Anfrageparameter.
  3. Gesundheit erst nach einem gelesenen Probebild, nicht wenn der Prozess laeuft.
"""

import io
import logging
import os
import time

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from PIL import Image

logging.basicConfig(level=logging.INFO, format="[paddleocr] %(levelname)s %(message)s")
log = logging.getLogger("bon-paddleocr")

# --- Auflage 2 ---------------------------------------------------------------------
# Die Standardeinstellung verkleinert lange Bilder intern. Auf dem langen Lidl-Bon
# (1130x8000) fand PaddleOCR damit 5 von 15 Artikelnamen — bei Confidence 0,92, also
# ohne jedes Warnzeichen. Mit diesen Werten: 15 von 15.
#
# Bewusst KEIN Anfrageparameter. Waere es einer, liefe irgendwann eine Messung unter
# der falschen Bedingung, ohne dass es jemandem auffiele — genau so ist in Etappe 0
# der falsche Betrag 48,61 entstanden. Der Wert geht stattdessen in jeder Antwort
# zurueck und landet beim Aufrufer in extraction_runs.ocr_options: die Messung traegt
# die Bedingung mit, unter der sie entstand.
DET_LIMIT_SIDE_LEN = 8000
DET_LIMIT_TYPE = "max"
SPRACHE = os.environ.get("PADDLE_LANG", "german")

# --- Kachelung ---------------------------------------------------------------------
# Gemessen am 2026-09-16 an einem echten 838x5164-Bon, aus einem frisch gestarteten
# Dienst und mit aufsteigender Bildhoehe:
#
#     800 px -> 483 MB     1200 px -> 793 MB     1600 px -> 1111 MB
#    2000 px -> 1634 MB    3000 px -> 2438 MB    5164 px -> rund 5900 MB
#
# (Diese Reihe stammt vom 838 px breiten Bon; die Zahlen fuer die Kachelhoehe unten
#  sind am breitesten Bon im Bestand gemessen, 1130 px.)
#
# Der Verbrauch waechst linear mit der Hoehe, und — das ist der eigentliche Punkt — er
# wird NICHT zurueckgegeben: derselbe Prozess blieb danach bei 5,9 GB stehen, auch bei
# winzigen Folgebildern. Ein langer Bon setzt den Hochwasserstand also dauerhaft.
#
# Ohne Kachelung hat dieser Dienst den 2-GB-Deckel beim ersten echten Bon gesprengt
# (Kernel-OOM, Container-Neustart). Mit Kachelung haengt der Verbrauch an der KACHEL,
# nicht an der Bonlaenge — ein Bon mit 200 Positionen kostet so viel wie einer mit 20.
#
# Die Hoehe ist an der MAXIMAL MOEGLICHEN Bonbreite bemessen, nicht am breitesten
# vorhandenen Bon: `storage/images.ts` deckelt die Breite bei 1600 px, so breit darf
# also jeder kuenftige Bon werden. Gemessen am 1130 px breiten Bon (dem breitesten im
# Bestand), aus einem frisch gestarteten Dienst:
#
#     800 px -> 536 MB    1000 px -> 858 MB    1200 px -> 1387 MB
#    1400 px -> 1516 MB   1600 px -> 1705 MB
#
# 1600 px Kachelhoehe kostete damit 1705 MB anon plus rund 214 MB Dateiseiten und hat
# den 2-GB-Deckel gesprengt — gemessen, nicht befuerchtet: Kernel-OOM beim echten Bon.
# Bei 1000 px sind es 858 MB; hochgerechnet auf die volle Breite von 1600 px rund
# 1,2 GB. Unter dem 2-GB-Deckel bleibt damit auch der breitestmoegliche Bon.
#
# Zeitlich kostet die kleinere Kachel nichts: ein 8000 px hoher Bon braucht rund zehn
# Durchgaenge zu je etwa einer Sekunde — gegen 15,6 s fuer denselben Bon am Stueck.
MAX_KACHEL_HOEHE = int(os.environ.get("PADDLE_KACHEL_HOEHE", "1000"))
# Eine Bonzeile ist 30 bis 50 px hoch. 200 px Ueberlappung stellt sicher, dass JEDE
# Zeile in mindestens einer Kachel VOLLSTAENDIG liegt — eine an der Schnittkante
# halbierte Zeile waere sonst zweimal halb erkannt und nirgends ganz.
KACHEL_UEBERLAPPUNG = int(os.environ.get("PADDLE_KACHEL_UEBERLAPPUNG", "200"))
# Ab welcher Deckungsgleichheit zwei Funde aus benachbarten Kacheln als DERSELBE gelten.
KACHEL_DECKUNG = 0.5

# Groesse, ab der wir gar nicht erst anfangen. 12 MB ist das Bild-Limit der App; der
# Dienst ist nicht von aussen erreichbar, aber ein Deckel gehoert trotzdem hierhin,
# damit ein Fehler im Aufrufer nicht den Host unter Speicherdruck setzt.
MAX_BILD_BYTES = 16 * 1024 * 1024

app = FastAPI(title="bon-paddleocr", docs_url=None, redoc_url=None)

_ocr = None
_versionen: dict[str, str] = {}
# Auflage 3: kein bool, sondern der Befund selbst — "noch nicht geprueft" muss von
# "geprueft und durchgefallen" unterscheidbar sein, sonst meldet ein Dienst, dessen
# Probe nie lief, dasselbe wie einer, dessen Probe scheiterte.
_probe: dict | None = None


def _optionen() -> dict:
    """Was der Engine tatsaechlich uebergeben wurde — nicht, was konfiguriert ist."""
    return {
        "sprache": SPRACHE,
        "detLimitSideLen": DET_LIMIT_SIDE_LEN,
        "detLimitType": DET_LIMIT_TYPE,
        "angleClassifier": False,
        "kachelHoehe": MAX_KACHEL_HOEHE,
        "kachelUeberlappung": KACHEL_UEBERLAPPUNG,
    }


def _lade_engine():
    global _ocr, _versionen
    import paddle
    import paddleocr

    _versionen = {"paddleocr": paddleocr.__version__, "paddlepaddle": paddle.__version__}
    # use_angle_cls=False: Bons stehen aufrecht. Der Klassifizierer kostet Zeit und
    # kann eine korrekt gelesene Zeile auf den Kopf stellen. show_log=False, weil
    # PaddleOCR sonst je Bild mehrere Zeilen ins Log schreibt.
    _ocr = paddleocr.PaddleOCR(
        lang=SPRACHE,
        use_angle_cls=False,
        show_log=False,
        det_limit_side_len=DET_LIMIT_SIDE_LEN,
        det_limit_type=DET_LIMIT_TYPE,
    )
    log.info("Engine geladen: %s", _versionen)


# Das Probebild wird zur BAUZEIT erzeugt (siehe Dockerfile) und liegt im Abbild.
# Erzeugen statt einchecken, weil ein Binaerblob im Repo niemand liest; zur Bauzeit
# statt zur Laufzeit, damit ein kaputtes Erzeugen den BAU scheitern laesst und nicht
# erst den ersten Bon.
PROBEBILD_PFAD = os.environ.get("PADDLE_PROBEBILD", "/app/probe.png")
PROBEBILD_ERWARTET = "12,34"


def _probe_lauf() -> dict:
    """
    Auflage 3: gesund heisst "hat ein Bild gelesen", nicht "der Prozess laeuft".

    Ein Dienst, der antwortet, aber bei jedem Bon nichts findet, ist der teuerste
    Zustand von allen — er sieht gesund aus und liefert lautlos leere Ergebnisse.
    """
    try:
        with open(PROBEBILD_PFAD, "rb") as f:
            bild = f.read()
    except OSError as e:
        return {"ok": False, "grund": f"Probebild nicht lesbar: {e}"}
    try:
        begonnen = time.monotonic()
        erkennungen = _erkenne(bild)
        dauer_ms = int((time.monotonic() - begonnen) * 1000)
    except Exception as e:  # noqa: BLE001 — der Grund gehoert in die Antwort
        return {"ok": False, "grund": f"Probelauf warf: {type(e).__name__}: {e}"}

    gelesen = " ".join(e["text"] for e in erkennungen)
    if not erkennungen:
        return {"ok": False, "grund": "Probelauf fand keine einzige Erkennung"}
    # Nicht nur "irgendwas gefunden": der erwartete Betrag muss darin vorkommen. Eine
    # Engine, die auf einem sauber gerenderten "12,34" etwas anderes liest, ist nicht
    # gesund — sie wuerde auf echten Bons Betraege verfaelschen, und genau das ist der
    # Fehler, den hinterher niemand mehr bemerkt. Ziffern-Vergleich ohne Leerraum,
    # damit ein zusaetzliches Leerzeichen den Dienst nicht grundlos krankschreibt.
    if PROBEBILD_ERWARTET.replace(",", "") not in gelesen.replace(" ", "").replace(",", "").replace(".", ""):
        return {
            "ok": False,
            "grund": f"Probelauf las {gelesen!r} statt {PROBEBILD_ERWARTET!r}",
        }
    return {
        "ok": True,
        "erkennungen": len(erkennungen),
        "text": gelesen,
        "durationMs": dauer_ms,
    }


def _deckung(a: list[int], b: list[int]) -> float:
    """Flaechenanteil der Ueberschneidung zweier Rechtecke [x, y, breite, hoehe]."""
    x = max(a[0], b[0])
    y = max(a[1], b[1])
    rechts = min(a[0] + a[2], b[0] + b[2])
    unten = min(a[1] + a[3], b[1] + b[3])
    if rechts <= x or unten <= y:
        return 0.0
    schnitt = (rechts - x) * (unten - y)
    vereinigung = a[2] * a[3] + b[2] * b[3] - schnitt
    return schnitt / vereinigung if vereinigung > 0 else 0.0


def _ohne_doppelte(erkennungen: list[dict]) -> list[dict]:
    """
    Funde aus dem Ueberlappungsbereich zweier Kacheln zusammenfuehren.

    Rein geometrisch, nicht ueber den Text: wenn zwei Kacheln dieselbe Zeile
    verschieden lesen, ist genau das der Fall, in dem man die sicherere Lesung will —
    ein Textvergleich haette beide behalten. Die Reihenfolge des ERSTEN Fundes bleibt
    erhalten, damit die Lesereihenfolge von oben nach unten nicht durcheinandergeraet.
    """
    behalten: list[dict] = []
    for e in erkennungen:
        for i, vorhanden in enumerate(behalten):
            if _deckung(e["box"], vorhanden["box"]) >= KACHEL_DECKUNG:
                if e["confidence"] > vorhanden["confidence"]:
                    behalten[i] = {**e, "box": vorhanden["box"]}
                break
        else:
            behalten.append(e)
    return behalten


def _erkenne_feld(feld) -> list[dict]:
    """Ein einzelner PaddleOCR-Lauf ueber ein fertiges BGR-Feld."""
    roh = _ocr.ocr(feld, cls=False)
    # paddleocr 2.9 gibt eine Liste je Seite zurueck; bei einem Bild ist das [seite],
    # und eine Seite ohne Fund ist None (nicht []). Beides faengt diese Zeile ab.
    seite = roh[0] if roh else None
    if not seite:
        return []

    erkennungen = []
    for eintrag in seite:
        ecken, (text, confidence) = eintrag
        xs = [p[0] for p in ecken]
        ys = [p[1] for p in ecken]
        # Der Rahmen kommt als vier Eckpunkte (kann schraeg sein). Wir geben das
        # umschliessende Rechteck als [x, y, breite, hoehe] zurueck — dieselbe Form
        # wie bei Tesseract, damit der Aufrufer nur EINE Rahmenform kennen muss.
        erkennungen.append(
            {
                "text": text,
                "confidence": float(confidence),
                "box": [
                    int(min(xs)),
                    int(min(ys)),
                    int(max(xs) - min(xs)),
                    int(max(ys) - min(ys)),
                ],
            }
        )
    return erkennungen


def _erkenne(daten: bytes) -> list[dict]:
    """
    Bild -> Erkennungen, bei Bedarf ueber mehrere Kacheln.

    Ein kurzer Bon laeuft in EINEM Durchgang durch — buchstaeblich derselbe Aufruf wie
    vorher. Erst ein Bon, der hoeher ist als `MAX_KACHEL_HOEHE`, wird in ueberlappende
    Streifen zerlegt. Die Rahmen werden um den Versatz der Kachel nach unten
    verschoben, sodass sie durchgehend im Koordinatensystem des GANZEN Bildes liegen —
    der Aufrufer merkt von der Kachelung nichts ausser an `options`.
    """
    with Image.open(io.BytesIO(daten)) as bild:
        # PaddleOCR erwartet BGR wie OpenCV. WebP, PNG und JPEG kommen alle hier
        # durch; die Umwandlung nach RGB faengt Graustufen und Palettenbilder mit ab.
        voll = np.array(bild.convert("RGB"))[:, :, ::-1]

    hoehe = voll.shape[0]
    if hoehe <= MAX_KACHEL_HOEHE:
        return _erkenne_feld(voll)

    schritt = MAX_KACHEL_HOEHE - KACHEL_UEBERLAPPUNG
    gesammelt: list[dict] = []
    oben = 0
    while oben < hoehe:
        unten = min(oben + MAX_KACHEL_HOEHE, hoehe)
        for e in _erkenne_feld(voll[oben:unten]):
            e["box"][1] += oben
            gesammelt.append(e)
        if unten >= hoehe:
            break
        oben += schritt

    return _ohne_doppelte(gesammelt)


@app.on_event("startup")
def _start():
    global _probe
    _lade_engine()
    _probe = _probe_lauf()
    if _probe["ok"]:
        log.info("Probelauf bestanden: %s", _probe)
    else:
        log.error("Probelauf DURCHGEFALLEN: %s", _probe["grund"])


@app.get("/health")
def health():
    if _probe is None:
        return JSONResponse({"status": "startet", "probe": None}, status_code=503)
    if not _probe["ok"]:
        return JSONResponse({"status": "krank", "probe": _probe}, status_code=503)
    return {"status": "gesund", "probe": _probe, "versionen": _versionen, "optionen": _optionen()}


@app.post("/ocr")
async def ocr(request: Request):
    daten = await request.body()
    if not daten:
        return JSONResponse({"fehler": "leerer Rumpf"}, status_code=400)
    if len(daten) > MAX_BILD_BYTES:
        return JSONResponse(
            {"fehler": f"Bild groesser als {MAX_BILD_BYTES} Bytes"}, status_code=413
        )

    begonnen = time.monotonic()
    try:
        erkennungen = _erkenne(daten)
    except Exception as e:  # noqa: BLE001
        # Der Aufrufer muss "die Engine hat versagt" von "nichts gefunden"
        # unterscheiden koennen — deshalb 500 mit Grund, nicht eine leere Liste.
        log.exception("OCR-Lauf gescheitert")
        return JSONResponse(
            {"fehler": f"{type(e).__name__}: {e}"},
            status_code=500,
        )
    dauer_ms = int((time.monotonic() - begonnen) * 1000)

    return {
        "erkennungen": erkennungen,
        "durationMs": dauer_ms,
        "engineVersion": _versionen.get("paddleocr"),
        "versionen": _versionen,
        "options": _optionen(),
    }
