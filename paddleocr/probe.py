"""
Erzeugt das Probebild fuer die Gesundheitspruefung — zur BAUZEIT, nicht zur Laufzeit.

Ein Betrag in Bon-Groesse auf weissem Grund. Absichtlich schlicht: die Probe soll
beantworten "laeuft die Kette Bild -> Erkennung -> Text ueberhaupt", nicht "wie gut
liest die Engine". Scheitert dieses Skript, scheitert der Bau — besser hier als beim
ersten echten Bon.
"""

from PIL import Image, ImageDraw, ImageFont

SCHRIFT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
TEXT = "12,34"

bild = Image.new("RGB", (240, 90), "white")
zeichner = ImageDraw.Draw(bild)
zeichner.text((20, 18), TEXT, fill="black", font=ImageFont.truetype(SCHRIFT, 48))
bild.save("/app/probe.png")
print(f"Probebild erzeugt: {TEXT}")
