import { starteMatrixBot } from './client';

// Signalbehandlung (SIGTERM/SIGINT) lebt in `starteMatrixBot()` selbst — dort, wo
// Client und Speicher tatsächlich im Gültigkeitsbereich stehen, statt hier blind
// zu loggen und ohne sauberes Stoppen des Sync-Loops zu beenden.
starteMatrixBot().catch((err) => {
	console.error('[matrix] Start fehlgeschlagen', err);
	process.exit(1);
});
