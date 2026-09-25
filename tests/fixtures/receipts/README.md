# Goldenes Testset

Je Bon zwei Dateien mit gleichem Namensstamm:
- `<name>.webp`         — das Bild (gitignored, enthält echte Einkaufsdaten)
- `<name>.expected.json` — das von Hand geprüfte Soll-Ergebnis (im git)

Ein neuer Fall entsteht so:
1. Bon in der App scannen und in der Prüf-Ansicht vollständig korrigieren.
2. Bild aus `data/receipts/<jahr>/<monat>/` hierher kopieren.
3. `docker exec bon-db psql -U bon -d bon -t -c "select raw_json from extraction_runs
   where receipt_id = '<id>' order by created_at desc limit 1"` als Ausgangspunkt nehmen,
   die korrigierten Werte eintragen und als `.expected.json` ablegen.

Gedeckt sein sollten mindestens: Pfand, Leergut-Rückgabe, Rabattzeile,
Gewichtsware, Mehrfachmenge, ein zerknitterter oder verblasster Bon.
