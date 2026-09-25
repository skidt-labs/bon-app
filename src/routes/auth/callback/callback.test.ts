import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Bewertung 25.09.2026, Befund „hoch": Der Callback loeschte das Einladungs-Cookie in
 * aufraeumen() und fragte es bei der Erstanmeldung danach ERNEUT ab. Nach dem Loeschen
 * liefert SvelteKit dort keinen Wert mehr — ein Eingeladener bekam bei abgeschalteter
 * Selbstbedienung „Für diese Instanz braucht es eine Einladung", obwohl er eine hatte.
 *
 * Die Attrappe der Cookies bildet genau dieses Verhalten nach: was geloescht ist, ist weg.
 */
const mocks = vi.hoisted(() => ({
	selbstbedienung: false,
	bestehend: [] as { id: string }[],
	angelegt: [] as string[]
}));

vi.mock('$lib/server/auth/oidc', () => ({
	exchangeCode: vi.fn(async () => ({ sub: 'sub-neu', name: 'Erika Mustermann', email: 'erika@example.org' }))
}));
vi.mock('$lib/server/auth/session', () => ({
	SESSION_COOKIE: 'session',
	createSession: vi.fn(async () => ({ id: 'sitzung-1', expiresAt: new Date('2030-01-01T00:00:00Z') }))
}));
vi.mock('$lib/server/db', () => ({
	db: { select: () => ({ from: () => ({ where: async () => mocks.bestehend }) }) }
}));
vi.mock('$lib/server/betrieb/verwaltung', () => ({
	selbstbedienungLesen: vi.fn(async () => mocks.selbstbedienung)
}));
vi.mock('$lib/server/household', () => ({
	erstanmeldungAnlegen: vi.fn(async (profil: { sub: string }) => {
		mocks.angelegt.push(profil.sub);
		return { userId: 'u-neu' };
	}),
	mitgliedschaftWiederherstellen: vi.fn()
}));
vi.mock('$lib/server/haushalt/mitglieder', () => ({ mitgliedschaftLaden: vi.fn(async () => ({})) }));

import { GET } from './+server';
import { EINLADUNG_TOKEN_COOKIE } from '$lib/server/haushalt/einladungen';

function keks(start: Record<string, string>) {
	const werte = new Map(Object.entries(start));
	return {
		get: (n: string) => werte.get(n),
		delete: (n: string) => void werte.delete(n),
		set: (n: string, v: string) => void werte.set(n, v)
	};
}

async function aufruf(cookies: ReturnType<typeof keks>) {
	try {
		await GET({ url: new URL('https://bon.example.org/auth/callback?code=c&state=s'), cookies } as never);
	} catch (e) {
		return e as { status: number; location?: string };
	}
	throw new Error('Der Callback endet immer mit einer Weiterleitung oder einem Fehler.');
}

beforeEach(() => {
	mocks.selbstbedienung = false;
	mocks.bestehend = [];
	mocks.angelegt = [];
});

describe('/auth/callback: Erstanmeldung mit Einladung', () => {
	it('legt das Konto an und leitet zur Einladung, auch wenn die Selbstbedienung aus ist', async () => {
		const antwort = await aufruf(
			keks({ oidc_verifier: 'v', oidc_state: 's', [EINLADUNG_TOKEN_COOKIE]: 'token-123' })
		);
		expect(antwort).toMatchObject({ status: 302, location: '/einladung/token-123' });
		expect(mocks.angelegt).toEqual(['sub-neu']);
	});

	it('weist eine Erstanmeldung OHNE Einladung ab, wenn die Selbstbedienung aus ist', async () => {
		const antwort = await aufruf(keks({ oidc_verifier: 'v', oidc_state: 's' }));
		expect(antwort).toMatchObject({ status: 403 });
		expect(mocks.angelegt).toEqual([]);
	});

	it('laesst die Erstanmeldung ohne Einladung zu, wenn die Selbstbedienung an ist', async () => {
		mocks.selbstbedienung = true;
		const antwort = await aufruf(keks({ oidc_verifier: 'v', oidc_state: 's' }));
		expect(antwort).toMatchObject({ status: 302, location: '/' });
		expect(mocks.angelegt).toEqual(['sub-neu']);
	});
});
