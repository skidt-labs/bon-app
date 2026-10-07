import { describe, it, expect } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { pgCode, pgConstraint, istVoruebergehenderDbFehler } from './fehler';

/** Wie `pg` einen Datenbankfehler wirft (DatabaseError): SQLSTATE in `code`. */
function pgFehler(code: string, teil: Record<string, unknown> = {}): Error {
	return Object.assign(new Error(`Datenbankfehler ${code}`), { code, severity: 'ERROR', ...teil });
}
/** Wie Node einen Netzfehler wirft: Errno-Name in `code`. */
function netzFehler(code: string): Error {
	return Object.assign(new Error(`connect ${code} 127.0.0.1:5432`), { code, syscall: 'connect' });
}
/** Wie drizzle 0.45 beides weiterreicht: als `cause` eines DrizzleQueryError. */
function verpackt(ursache: Error): DrizzleQueryError {
	return new DrizzleQueryError('insert into "receipts" …', [], ursache);
}

describe('pgCode / pgConstraint (N1)', () => {
	it('liest Code und Constraint direkt am pg-Fehler', () => {
		const f = pgFehler('23505', { constraint: 'receipts_matrix_event_id_unique' });
		expect(pgCode(f)).toBe('23505');
		expect(pgConstraint(f)).toBe('receipts_matrix_event_id_unique');
	});

	it('liest sie auch eine Ebene tiefer, wie drizzle sie weiterreicht', () => {
		const f = verpackt(pgFehler('23505', { constraint: 'matrix_links_user_id_unique' }));
		// Genau das sahen ingest.ts und pairing.ts bisher: kein code am aeusseren Fehler.
		expect((f as { code?: unknown }).code).toBeUndefined();
		expect(pgCode(f)).toBe('23505');
		expect(pgConstraint(f)).toBe('matrix_links_user_id_unique');
	});

	it('und zwei Ebenen tiefer (Fehler aus einer Transaktion, neu verpackt)', () => {
		const f = new Error('Transaktion gescheitert', { cause: verpackt(pgFehler('40P01')) });
		expect(pgCode(f)).toBe('40P01');
	});

	it('nennt keinen Code, wo keiner ist — auch nicht den Errno-Namen eines Netzfehlers', () => {
		expect(pgCode(new Error('x'))).toBeUndefined();
		expect(pgCode(netzFehler('EPIPE'))).toBeUndefined();
		expect(pgCode(verpackt(netzFehler('ECONNREFUSED')))).toBeUndefined();
		expect(pgCode(undefined)).toBeUndefined();
		expect(pgCode('23505')).toBeUndefined();
		expect(pgConstraint(pgFehler('23505'))).toBeUndefined();
	});

	it('haelt bei einer ringfoermigen cause-Kette an', () => {
		const a = new Error('a') as Error & { cause?: unknown };
		a.cause = a;
		expect(pgCode(a)).toBeUndefined();
		expect(istVoruebergehenderDbFehler(a)).toBe(false);
	});
});

describe('istVoruebergehenderDbFehler (4.8)', () => {
	it.each(['08000', '08001', '08003', '08006', '57P01', '57P02', '57P03', '53300', '40001', '40P01'])(
		'SQLSTATE %s ist voruebergehend, direkt und verpackt',
		(code) => {
			expect(istVoruebergehenderDbFehler(pgFehler(code))).toBe(true);
			expect(istVoruebergehenderDbFehler(verpackt(pgFehler(code)))).toBe(true);
		}
	);

	it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'])(
		'Netzfehler %s ist voruebergehend, direkt und verpackt',
		(code) => {
			expect(istVoruebergehenderDbFehler(netzFehler(code))).toBe(true);
			expect(istVoruebergehenderDbFehler(verpackt(netzFehler(code)))).toBe(true);
		}
	);

	it('auch die AggregateError, mit der Node einen Verbindungsversuch auf mehrere Adressen meldet', () => {
		const alle = Object.assign(new AggregateError([netzFehler('ECONNREFUSED')], ''), { code: 'ECONNREFUSED' });
		expect(istVoruebergehenderDbFehler(verpackt(alle))).toBe(true);
	});

	it('pg ohne Code, wenn die Verbindung mitten in der Abfrage abbricht', () => {
		expect(istVoruebergehenderDbFehler(verpackt(new Error('Connection terminated unexpectedly')))).toBe(true);
	});

	it.each(['23505', '23503', '22P02', '42P01'])('SQLSTATE %s ist ein echter Fehler, kein Aussetzer', (code) => {
		expect(istVoruebergehenderDbFehler(verpackt(pgFehler(code)))).toBe(false);
	});

	it('alles andere ist kein Datenbank-Aussetzer', () => {
		expect(istVoruebergehenderDbFehler(new Error('irgendwas'))).toBe(false);
		expect(istVoruebergehenderDbFehler(netzFehler('ENOENT'))).toBe(false);
		expect(istVoruebergehenderDbFehler(new TypeError('fetch failed'))).toBe(false);
		expect(istVoruebergehenderDbFehler(null)).toBe(false);
	});
});
