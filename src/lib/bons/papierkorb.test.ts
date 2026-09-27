import { describe, it, expect } from 'vitest';
import { PAPIERKORB_TAGE, restTage } from './papierkorb';

describe('restTage', () => {
	const am = new Date('2026-09-01T10:00:00Z');
	it('ist direkt nach dem Verwerfen die volle Frist', () => {
		expect(restTage(am, new Date('2026-09-01T10:05:00Z'))).toBe(PAPIERKORB_TAGE);
	});
	it('zaehlt angebrochene Tage als ganzen Tag', () => {
		expect(restTage(am, new Date('2026-09-30T11:00:00Z'))).toBe(1);
		expect(restTage(am, new Date('2026-09-30T09:00:00Z'))).toBe(2);
	});
	it('wird nie negativ', () => {
		expect(restTage(am, new Date('2026-11-01T00:00:00Z'))).toBe(0);
	});
	it('nimmt auch einen Text, wie er aus JSON kommt', () => {
		expect(restTage('2026-09-01T10:00:00.000Z', new Date('2026-09-11T10:00:00Z'))).toBe(20);
	});
});
