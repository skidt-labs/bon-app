/**
 * Fehler der Datenbank erkennen — auch wenn drizzle sie verpackt (Sammelfassung 0.11.0, 4.8 und N1).
 *
 * drizzle 0.45 wirft bei einem gescheiterten Statement einen `DrizzleQueryError`; der Fehler aus
 * `pg` (SQLSTATE in `code`, dazu `constraint`) haengt eine Ebene tiefer als `cause`, nach einer
 * Transaktion womoeglich noch eine weiter. Wer `err.code` direkt liest, sieht nichts — ein
 * doppelt zugestelltes Matrix-Foto wurde so zum Alarm, ein kurzer Datenbank-Aussetzer liess einen
 * Bon endgueltig scheitern. Deshalb laeuft hier jede Pruefung die ganze cause-Kette ab.
 */

const TIEFE = 10;

/** err, err.cause, err.cause.cause … — hoechstens TIEFE Glieder; ein Ring endet. */
function kette(err: unknown): Record<string, unknown>[] {
	const glieder: Record<string, unknown>[] = [];
	let e: unknown = err;
	while (e !== null && typeof e === 'object' && glieder.length < TIEFE && !glieder.includes(e as Record<string, unknown>)) {
		glieder.push(e as Record<string, unknown>);
		e = (e as { cause?: unknown }).cause;
	}
	return glieder;
}

/**
 * SQLSTATE: fuenf Zeichen aus Ziffern und Grossbuchstaben. Errno-Namen wie `EPIPE` sehen genauso
 * aus; keine SQLSTATE-Klasse beginnt mit E, deshalb sind sie hier ausgeschlossen.
 */
const SQLSTATE = /^(?!E)[0-9A-Z]{5}$/;

function pgGlied(err: unknown): Record<string, unknown> | undefined {
	return kette(err).find((g) => {
		const code = g.code;
		return typeof code === 'string' && SQLSTATE.test(code);
	});
}

export function pgCode(err: unknown): string | undefined {
	const code = pgGlied(err)?.code;
	return typeof code === 'string' ? code : undefined;
}

/** Der Constraint am SELBEN Glied wie der Code. */
export function pgConstraint(err: unknown): string | undefined {
	const c = pgGlied(err)?.constraint;
	return typeof c === 'string' ? c : undefined;
}

/** 57P01–03: Server faehrt herunter/startet neu; 53300: zu viele Verbindungen; 40001/40P01: Serialisierung, Deadlock. */
const VORUEBERGEHEND_SQLSTATE = new Set(['57P01', '57P02', '57P03', '53300', '40001', '40P01']);
const VORUEBERGEHEND_ERRNO = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);

/** „Gleich nochmal": die Verbindung zur Datenbank, nicht die Abfrage ist das Problem. */
export function istVoruebergehenderDbFehler(err: unknown): boolean {
	return kette(err).some((g) => {
		const code = g.code;
		if (typeof code === 'string') {
			if (SQLSTATE.test(code) && (code.startsWith('08') || VORUEBERGEHEND_SQLSTATE.has(code))) return true;
			if (VORUEBERGEHEND_ERRNO.has(code)) return true;
		}
		// pg selbst, wenn die Verbindung mitten in einer Abfrage wegbricht — ohne code.
		return typeof g.message === 'string' && g.message.startsWith('Connection terminated');
	});
}
