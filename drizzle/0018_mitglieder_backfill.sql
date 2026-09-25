-- Custom SQL migration file, put your code below! --
-- Bestandsuebernahme: der vorhandene Nutzer wird Verwalter seines vorhandenen Haushalts.
-- Ohne diese Zeile hat nach der Migration niemand eine Mitgliedschaft und die Anmeldung
-- schlaegt fehl — der Backfill gehoert deshalb in dieselbe Migrationsfolge, nicht in ein
-- Skript, das jemand von Hand starten muss.
INSERT INTO household_members (household_id, user_id, rolle)
SELECT household_id, id, 'verwalter' FROM users
ON CONFLICT (user_id) DO NOTHING;
