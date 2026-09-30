import { describe, it, expect, vi } from 'vitest';
import { bildHochladen, originalHolen } from './bild';
import { bildVersion } from '$lib/bons/anzeige';

describe('bildVersion', () => {
	it('nimmt den Dateinamen ohne Endung — er aendert sich mit jedem neuen Bild', () => {
		expect(bildVersion('2026/09/1f2e3d.webp')).toBe('1f2e3d');
		expect(bildVersion('abc')).toBe('abc');
	});
});

describe('bildHochladen', () => {
	it('schickt das Bild als Feld image', async () => {
		const f = vi.fn(async (_url: string, init: RequestInit) => {
			expect((init.body as FormData).get('image')).toBeInstanceOf(Blob);
			return new Response('{"ok":true}', { status: 200 });
		});
		expect(await bildHochladen('b1', new Blob(['x']), f as never)).toEqual({ ok: true });
		expect(f.mock.calls[0][0]).toBe('/api/receipts/b1/bild');
	});
	it('gibt die Meldung des Endpunkts weiter', async () => {
		const f = vi.fn(async () => new Response('{"message":"Bild zu groß (max. 12 MB)"}', { status: 413 }));
		expect(await bildHochladen('b1', new Blob(['x']), f as never)).toEqual({ ok: false, meldung: 'Bild zu groß (max. 12 MB)' });
	});
});

describe('originalHolen', () => {
	it('ruft den Endpunkt und faengt einen Netzfehler ab', async () => {
		const ok = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
		expect(await originalHolen('b1', ok as never)).toEqual({ ok: true });
		expect(ok).toHaveBeenCalledWith('/api/receipts/b1/bild-original', { method: 'POST' });
		const weg = vi.fn(async () => {
			throw new TypeError('offline');
		});
		expect(await originalHolen('b1', weg as never)).toMatchObject({ ok: false });
	});
});
