-- Einmalig: die Doppel im BESTAND markieren, die es vor der Erkennung schon gab.
--
-- Dieselbe Regel wie src/lib/server/bons/doppelt.ts (vermutetesOriginal): gleicher
-- Haushalt, gleiche Endsumme auf den Cent, Kaufzeiten hoechstens fuenf Minuten
-- auseinander, das Original fuer den Hochladenden sichtbar (eigen oder geteilt), beide
-- ausgelesen. Markiert wird je Paar der JUENGERE Bon, das Original ist der aelteste
-- Treffer — genau wie der Worker es ab jetzt fuer jeden neuen Bon tut.
--
-- Entschieden wird hier NICHTS. Der markierte Bon steht danach in 'review' mit Hinweis,
-- und ein Mensch sagt „doppelt" oder „eigener Einkauf". War er schon bestaetigt, geht er
-- dafuer zurueck in 'review' und faellt bis zur Entscheidung aus den Berichten — richtig
-- so, er stand dort bis jetzt doppelt. confirmed_at/confirmed_by werden geleert: ein Bon
-- in 'review' mit Bestaetigungszeit waere ein Widerspruch in sich, und beim erneuten
-- Bestaetigen werden beide ohnehin neu gesetzt.
--
-- Beim Bau (23.09.2026) traf das vier Paare: ALDI 16.09. (beide bestaetigt), Jack
-- Wolfskin 25.08., Lidl 05.08. (19:20 gegen 19:21 gelesen) und Lidl 26.08. — das vierte
-- fand nur die Regel OHNE Haendler: einmal als "LIDL" ohne zugeordneten Haendler gelesen,
-- einmal als "Lidl".
WITH paare AS (
	SELECT DISTINCT ON (neu.id) neu.id AS neu_id, alt.id AS alt_id
	FROM receipts neu
	JOIN receipts alt
		ON alt.household_id = neu.household_id
		AND alt.id <> neu.id
		AND alt.created_at < neu.created_at
		AND alt.total_gross_cents = neu.total_gross_cents
		AND abs(extract(epoch FROM neu.purchased_at - alt.purchased_at)) <= 300
		AND (alt.sichtbarkeit = 'geteilt' OR alt.uploaded_by = neu.uploaded_by)
	WHERE neu.status IN ('review', 'confirmed')
		AND alt.status IN ('review', 'confirmed')
		AND neu.vermutetes_original_id IS NULL
	ORDER BY neu.id, alt.created_at
)
UPDATE receipts r
SET vermutetes_original_id = p.alt_id,
	status = 'review',
	confirmed_at = NULL,
	confirmed_by = NULL,
	needs_review_reason = CASE
		WHEN coalesce(r.needs_review_reason, '[]'::jsonb) ? 'moeglicher_doppelbon' THEN r.needs_review_reason
		ELSE coalesce(r.needs_review_reason, '[]'::jsonb) || '["moeglicher_doppelbon"]'::jsonb
	END
FROM paare p
WHERE r.id = p.neu_id;
