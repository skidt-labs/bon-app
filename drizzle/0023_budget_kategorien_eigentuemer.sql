-- Der aktive Unique-Index, jetzt mit dem Eigentuemer im Schluessel.
--
-- Die alte Fassung (household_id, category_id) WHERE gilt_bis IS NULL sagte: eine
-- Kategorie gehoert je Haushalt zu hoechstens einem Topf. Mit privaten Toepfen ist das zu
-- streng — haetten zwei Mitglieder je einen privaten Topf "Geschenke", lehnte Postgres den
-- zweiten ab, und zwar mit einer Meldung, aus der niemand liest, warum.
--
-- NULLS NOT DISTINCT ist dabei nicht Feinschliff, sondern tragend: geteilte Toepfe haben
-- eigentuemer_id IS NULL, und Postgres behandelt NULLs in einem Unique-Index sonst als
-- verschieden. Ohne die Klausel koennten ZWEI GETEILTE Toepfe dieselbe Kategorie
-- beanspruchen — also genau der Fall, den der Index seit jeher verhindern soll. Postgres
-- 18 kann das; Drizzle 0.45 kann es nicht ausdruecken, deshalb steht der Index hier und
-- nicht in schema.ts.
--
-- Den DROP hat die vorangehende, erzeugte Migration schon erledigt.
CREATE UNIQUE INDEX "budget_kategorien_aktiv_unique"
  ON "budget_kategorien" ("household_id", "category_id", "eigentuemer_id")
  NULLS NOT DISTINCT
  WHERE "gilt_bis" IS NULL;

-- Verhindert den Zustand, in dem etwas privat ist, aber niemandem gehoert — und ebenso
-- den umgekehrten: ein Eigentuemer an einem geteilten Topf. Beides waere eine halbe
-- Aussage, die spaeter jemand als ganze liest.
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_privat_hat_eigentuemer"
  CHECK ((sichtbarkeit = 'privat') = (eigentuemer_id IS NOT NULL));
