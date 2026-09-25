"""
Prueft die beiden reinen Funktionen der Kachelung — ohne Engine, ohne Bild.

Laeuft zur BAUZEIT (siehe Dockerfile), damit eine kaputte Zusammenfuehrung den Bau
scheitern laesst und nicht erst den ersten langen Bon. Die vitest-Suite des Projekts
erfasst diese Datei nicht: sie liegt in einem anderen Container und in einer anderen
Sprache, und genau deshalb braucht sie einen eigenen Waechter.
"""

from app import _deckung, _ohne_doppelte, MAX_KACHEL_HOEHE, KACHEL_UEBERLAPPUNG


def f(text, conf, x, y, b=100, h=30):
    return {"text": text, "confidence": conf, "box": [x, y, b, h]}


def pruefe(bedingung, was):
    if not bedingung:
        raise AssertionError(was)


# --- _deckung ----------------------------------------------------------------------
pruefe(_deckung([0, 0, 10, 10], [20, 20, 10, 10]) == 0.0, "getrennte Rechtecke decken sich nicht")
pruefe(_deckung([0, 0, 10, 10], [0, 0, 10, 10]) == 1.0, "identische Rechtecke decken sich ganz")
# Beruehrung an der Kante ist keine Ueberschneidung — sonst wuerden zwei aufeinander
# folgende Bonzeilen als dieselbe gelten und eine davon verschwaende.
pruefe(_deckung([0, 0, 10, 10], [0, 10, 10, 10]) == 0.0, "Kantenberuehrung ist keine Deckung")
pruefe(0.3 < _deckung([0, 0, 10, 10], [0, 5, 10, 10]) < 0.4, "halbe Ueberlappung ergibt rund 1/3")

# --- _ohne_doppelte ----------------------------------------------------------------
# Derselbe Fund aus zwei Kacheln: der sicherere gewinnt, die Position des ersten bleibt.
zusammen = _ohne_doppelte([f("Milch 1,09", 0.71, 10, 100), f("Milch 1,O9", 0.94, 11, 101)])
pruefe(len(zusammen) == 1, f"zwei Lesungen derselben Zeile ergeben eine, nicht {len(zusammen)}")
pruefe(zusammen[0]["confidence"] == 0.94, "die sicherere Lesung gewinnt")

# Rein geometrisch, NICHT ueber den Text: wenn zwei Kacheln dieselbe Zeile verschieden
# lesen, ist genau das der Fall, in dem man die sicherere will. Ein Textvergleich haette
# hier beide behalten und die Zeile doppelt in den Bontext geschrieben.
pruefe(zusammen[0]["text"] == "Milch 1,O9", "der Text folgt der Confidence, nicht dem Zufall")

# Zwei verschiedene Zeilen untereinander bleiben zwei.
pruefe(len(_ohne_doppelte([f("Milch", 0.9, 10, 100), f("Butter", 0.9, 10, 140)])) == 2,
       "verschiedene Zeilen werden nicht zusammengelegt")

# Die Lesereihenfolge von oben nach unten bleibt erhalten — sie ist das, was das Modell
# spaeter als Bon zu sehen bekommt.
reihe = _ohne_doppelte([f("A", 0.9, 0, 0), f("B", 0.9, 0, 50), f("A", 0.95, 0, 1), f("C", 0.9, 0, 100)])
pruefe([e["text"] for e in reihe] == ["A", "B", "C"], f"Reihenfolge blieb nicht erhalten: {reihe}")

# --- Die Masse selbst ---------------------------------------------------------------
# Eine Bonzeile ist 30 bis 50 px hoch. Faellt die Ueberlappung darunter, kann eine Zeile
# an der Schnittkante in BEIDEN Kacheln halbiert sein — und damit in keiner ganz.
pruefe(KACHEL_UEBERLAPPUNG >= 100, "Ueberlappung deckt eine Bonzeile nicht sicher ab")
pruefe(MAX_KACHEL_HOEHE > 2 * KACHEL_UEBERLAPPUNG,
       "Kachel muss deutlich groesser sein als ihre Ueberlappung, sonst kommt sie nicht voran")

print(f"Kachelung geprueft: {MAX_KACHEL_HOEHE} px Kachel, {KACHEL_UEBERLAPPUNG} px Ueberlappung")
