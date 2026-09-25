import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import { datenbankUrl } from './url';

// Bewusst process.env statt $env/dynamic/private: Dieselbe Datei wird vom Worker
// importiert, der außerhalb von SvelteKit läuft und $env nicht auflösen kann.
//
// Die Zeichenfolge baut datenbankUrl() zusammen — das Passwort kommt aus einer Datei,
// nicht aus der Umgebung, wo `docker inspect` es jedem zeigt (siehe url.ts).
const pool = new pg.Pool({ connectionString: datenbankUrl() });
// Ein unbehandeltes 'error'-Ereignis auf einem EventEmitter ist in Node kein
// Logeintrag, sondern ein Prozessabbruch. Ohne diesen Listener beendet ein Fehler
// eines IDLE Clients (Netzhänger, Datenbank-Neustart) bon-web bzw. bon-worker.
// Gemessen: drizzle() registriert selbst keinen — listenerCount('error') war 0.
pool.on('error', (err) => console.error('[db] Fehler eines idle Clients', err));
export const db = drizzle(pool, { schema });
export { schema };
