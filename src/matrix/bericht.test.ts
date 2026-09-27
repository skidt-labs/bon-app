import { describe, it, expect, vi } from 'vitest';
import { berichtZustellen, TEXT_HOECHSTENS, type ZustellDeps } from './bericht';

const NUTZER = '3f2a0b7c-1111-2222-3333-444444444444';
const BOT = '@bon:example.org';
const ERIKA = '@erika:example.org';

function deps(x: Partial<{ chat: { matrixUserId: string; raum: string | null } | null; mitglieder: string[] }> = {}) {
	const senden = vi.fn(async () => {});
	const vergessen = vi.fn(async () => {});
	const d: ZustellDeps = {
		direktchatFuer: vi.fn(async () => ('chat' in x ? x.chat! : { matrixUserId: ERIKA, raum: '!dm:example.org' })),
		mitglieder: vi.fn(async () => x.mitglieder ?? [BOT, ERIKA]),
		botId: vi.fn(async () => BOT),
		senden,
		vergessen
	};
	return { d, senden, vergessen };
}

describe('berichtZustellen', () => {
	it('sendet in den gemerkten Direktchat', async () => {
		const { d, senden } = deps();
		expect(await berichtZustellen({ userId: NUTZER, text: 'Bericht' }, d)).toBe('gesendet');
		expect(senden).toHaveBeenCalledWith('!dm:example.org', 'Bericht');
	});

	it('weist unbrauchbare Auftraege ab, ohne zu senden', async () => {
		for (const job of [null, {}, { userId: 'x', text: 'a' }, { userId: NUTZER, text: '' }, { userId: NUTZER, text: 'a'.repeat(TEXT_HOECHSTENS + 1) }]) {
			const { d, senden } = deps();
			expect(await berichtZustellen(job, d)).toBe('ungueltig');
			expect(senden).not.toHaveBeenCalled();
		}
	});

	it('sendet nicht ohne Kopplung und nicht ohne bekannten Direktchat', async () => {
		const ohne = deps({ chat: null });
		expect(await berichtZustellen({ userId: NUTZER, text: 'Bericht' }, ohne.d)).toBe('nicht_gekoppelt');
		const ohneRaum = deps({ chat: { matrixUserId: ERIKA, raum: null } });
		expect(await berichtZustellen({ userId: NUTZER, text: 'Bericht' }, ohneRaum.d)).toBe('kein_chat');
		expect(ohne.senden).not.toHaveBeenCalled();
		expect(ohneRaum.senden).not.toHaveBeenCalled();
	});

	// Ein Direktchat kann nachtraeglich weitere Mitglieder bekommen. Dann ist er kein
	// Direktchat mehr, und ein Bericht darin laese mit, wer nicht sollte.
	it('sendet nicht, sobald ausser Bot und Konto noch jemand im Raum ist', async () => {
		for (const mitglieder of [[BOT, ERIKA, '@dritte:example.org'], [BOT], [BOT, '@fremd:example.org'], [ERIKA, '@fremd:example.org']]) {
			const { d, senden } = deps({ mitglieder });
			expect(await berichtZustellen({ userId: NUTZER, text: 'Bericht' }, d)).toBe('raum_nicht_privat');
			expect(senden).not.toHaveBeenCalled();
		}
	});
});

// Abschlusspruefung Stufe 3: blieb der Raum „nicht privat", scheiterte jede weitere
// Anfrage still, und die App zeigte weiter „bereit". Jetzt vergisst der Bot den Raum —
// die App sagt dann „schreib dem Bon-Bot einmal im Direktchat".
describe('berichtZustellen: Raum vergessen', () => {
	it('vergisst einen Raum, der kein Direktchat mehr ist', async () => {
		const { d, vergessen } = deps({ mitglieder: [BOT, ERIKA, '@dritte:example.org'] });
		expect(await berichtZustellen({ userId: NUTZER, text: 'Bericht' }, d)).toBe('raum_nicht_privat');
		expect(vergessen).toHaveBeenCalledWith(ERIKA, '!dm:example.org');
	});

	it('vergisst nichts, wenn zugestellt wurde', async () => {
		const { d, vergessen } = deps();
		expect(await berichtZustellen({ userId: NUTZER, text: 'Bericht' }, d)).toBe('gesendet');
		expect(vergessen).not.toHaveBeenCalled();
	});
});
