# Auflage 1 aus der Machbarkeitsprobe (Etappe 0): NUR dieses Abbild funktioniert.
# Drei andere Wege wurden gemessen und scheiterten — python:3.11-slim (libgomp.so.1
# fehlt), dito mit libgomp1 (ConvertPirAttribute2RuntimeAttribute auf PP-OCRv5 UND v6),
# python:3.10-slim mit paddlepaddle 2.6.2 per pip (Segfault beim Import, inflateReset2).
# Das Abbild ist mit 4,66 GB gross; das ist der Preis dafuer, dass es laeuft.
FROM paddlepaddle/paddle:2.6.2

# Versionen gepinnt. paddleocr 3.x wird ausdruecklich NICHT verfolgt: sie wirft den
# Laufzeitfehler oben, und der Gewinn laege im Prozentbereich.
RUN pip install --no-cache-dir \
      "paddleocr==2.9.1" \
      "fastapi==0.115.6" \
      "uvicorn==0.34.0" \
      "python-multipart==0.0.20"

WORKDIR /app

# Probebild zur Bauzeit erzeugen — ein kaputtes Erzeugen soll den BAU scheitern
# lassen, nicht erst den ersten Bon.
COPY probe.py /app/probe.py
RUN python3 /app/probe.py

COPY app.py /app/app.py

# Die Kachel-Logik liegt in Python und wird von der vitest-Suite des Projekts nicht
# erfasst. Ihr Waechter laeuft deshalb hier: eine kaputte Zusammenfuehrung soll den BAU
# scheitern lassen und nicht erst den ersten langen Bon.
COPY test_kacheln.py /app/test_kacheln.py
RUN python3 /app/test_kacheln.py

# Auflage 3: der Modell-Cache liegt hier und wird im Compose ein Volume. Erstladen mit
# Download 74 s, mit Cache 0,9 s.
ENV PADDLE_HOME=/root/.paddleocr

EXPOSE 8000

# Ein Arbeiter. PaddleOCR haelt das Modell je Prozess im Speicher (Spitze 1126 MB
# gemessen); zwei Arbeiter verdoppelten das, und der Aufrufer schickt ohnehin einen
# Bon nach dem anderen.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
