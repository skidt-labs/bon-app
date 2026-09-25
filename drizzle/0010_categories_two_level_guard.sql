-- Handgeschrieben, NICHT von drizzle-kit erzeugt.
--
-- categories.parent_id zeigt auf dieselbe Tabelle. Kommentar und Test im Repo
-- behaupten eine strikte Zweistufigkeit ("Mehr Ebenen sind ausdruecklich nicht
-- vorgesehen"), aber weder ein Zyklus (A->B->A) noch eine dritte Ebene noch eine
-- triviale Selbstreferenz (parent_id = eigene id) waren gesperrt — das FK-Constraint
-- prueft nur, dass der referenzierte Datensatz existiert, nicht die Form des Baums.
-- Empirisch belegt in
-- .superpowers/sdd/2026-09-15-bon-app-phase-2-kategorien/task-2-review.md, Befund
-- "Der Kategoriebaum".
--
-- Selbstreferenz: billig per CHECK abgefangen, macht die Absicht im Schema sichtbar.
-- NULL (Oberkategorie) erfuellt "parent_id <> id" trivially (Vergleich mit NULL ist
-- NULL, ein CHECK laesst NULL/TRUE durch, nur FALSE lehnt ab).
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parent_not_self" CHECK ("parent_id" <> "id");

-- Zyklen und eine dritte Ebene lassen sich nicht mit einem CHECK abfangen (der darf
-- nicht auf andere Zeilen zugreifen) — dafuer braucht es einen Trigger. Zwei Regeln
-- zusammen erzwingen strikt zwei Ebenen:
--
--   (a) Wer einen Elternknoten bekommt, dessen Elternknoten darf selbst keinen
--       Elternknoten haben (sonst waere die neue/geaenderte Zeile in der dritten
--       Ebene). Das faengt nebenbei auch jeden Zyklus: bei A->B->A scheitert das
--       zweite UPDATE (B.parent_id = A), weil A zu diesem Zeitpunkt bereits B als
--       Elternknoten hat.
--
--   (b) Wer selbst schon Unterkategorien hat, darf nicht nachtraeglich einen
--       Elternknoten bekommen. Ohne diese zweite Regel reicht (a) allein NICHT aus:
--       eine Oberkategorie A mit Kind B liesse sich per
--       "UPDATE categories SET parent_id = Z" (Z selbst ohne Elternknoten) trotzdem
--       zum Kind machen — Regel (a) prueft nur Z, nicht ob A bereits Kinder hat.
--       Ergebnis waere Z -> A -> B, drei Ebenen, ohne dass B je angefasst wurde.
--       Regel (b) schliesst genau diese Luecke.
CREATE OR REPLACE FUNCTION fn_categories_enforce_two_levels() RETURNS trigger AS $$
DECLARE
  v_parent_has_parent boolean;
  v_child_count integer;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT parent_id IS NOT NULL INTO v_parent_has_parent
      FROM categories WHERE id = NEW.parent_id;

    IF v_parent_has_parent THEN
      RAISE EXCEPTION
        'categories: Elternknoten % hat selbst einen Elternknoten – der Kategoriebaum erlaubt nur zwei Ebenen (Ober-/Unterkategorie), keine dritte Ebene und keinen Zyklus',
        NEW.parent_id
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_child_count
      FROM categories WHERE parent_id = NEW.id;

    IF v_child_count > 0 THEN
      RAISE EXCEPTION
        'categories: % hat bereits % Unterkategorie(n) – kann nicht nachtraeglich selbst einer Oberkategorie zugeordnet werden (nur zwei Ebenen erlaubt)',
        NEW.id, v_child_count
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER categories_enforce_two_levels_trg
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW
  EXECUTE FUNCTION fn_categories_enforce_two_levels();
