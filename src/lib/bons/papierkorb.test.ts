import { describe, it, expect } from 'vitest';
import { PAPIERKORB_TAGE, restTage, restTageText, naechsterLeerlauf } from './papierkorb';

describe('restTage', () => {
	const am = new Date('2026-09-01T10:00:00Z');
	it('ist direkt nach dem Verwerfen die volle Frist', () => {
		expect(restTage(am, new Date('2026-09-01T10:05:00Z'))).toBe(PAPIERKORB_TAGE);
	});
	// Seit 0.11.0: gezaehlt werden die Naechte bis zu dem Lauf um 04:30, der ihn loescht —
	// nicht angebrochene 24-Stunden-Spannen. Morgens und abends desselben Tages gilt dieselbe Zahl.
	it('zaehlt die Naechte bis zum Lauf, der ihn loescht — morgens wie abends', () => {
		expect(restTage(am, new Date('2026-09-30T11:00:00Z'))).toBe(1);
		expect(restTage(am, new Date('2026-09-30T09:00:00Z'))).toBe(1);
	});
	it('wird nie negativ', () => {
		expect(restTage(am, new Date('2026-11-01T00:00:00Z'))).toBe(0);
	});
	it('nimmt auch einen Text, wie er aus JSON kommt', () => {
		expect(restTage('2026-09-01T10:00:00.000Z', new Date('2026-09-11T10:00:00Z'))).toBe(20);
	});
	// Review-Fokus 07.10.: nachts verworfen (02:00 Berliner Zeit) laeuft die Frist um 02:00 ab,
	// und der Lauf um 04:30 DERSELBEN Nacht loescht ihn. Am Abend davor ist es „heute Nacht".
	it('nachts verworfen: am Abend vor dem Lauf ist es „heute Nacht"', () => {
		const nachts = new Date('2026-09-01T00:00:00Z');
		expect(restTage(nachts, new Date('2026-09-30T18:00:00Z'))).toBe(0);
		expect(restTage(nachts, new Date('2026-09-01T00:05:00Z'))).toBe(PAPIERKORB_TAGE);
	});
	// Gegenprobe: tagsueber verworfen, uebersteht er diese Nacht noch.
	it('tagsueber verworfen: am selben Abend noch 1 Tag', () => {
		expect(restTage(new Date('2026-09-01T08:00:00Z'), new Date('2026-09-30T18:00:00Z'))).toBe(1);
	});
	// 25.10.2026 und 29.03.2026: ein 25- bzw. 23-Stunden-Tag liegt dazwischen.
	it('zaehlt ueber die Zeitumstellung ganze Naechte', () => {
		expect(restTage(new Date('2026-09-26T10:00:00Z'), new Date('2026-10-23T20:00:00Z'))).toBe(3);
		expect(restTage(new Date('2026-02-28T10:00:00Z'), new Date('2026-03-27T20:00:00Z'))).toBe(3);
	});
});

describe('naechsterLeerlauf', () => {
	it('liefert den naechsten Lauf um 04:30 Berliner Zeit, streng danach', () => {
		expect(naechsterLeerlauf(new Date('2026-09-30T18:00:00Z')).toISOString()).toBe('2026-10-01T02:30:00.000Z');
		// Genau zum Lauf: der naechste ist morgen — wie pg-boss previewSchedule.
		expect(naechsterLeerlauf(new Date('2026-10-01T02:30:00Z')).toISOString()).toBe('2026-10-02T02:30:00.000Z');
		// Am Umstellungstag selbst schon Winterzeit: 04:30 ist 03:30 UTC.
		expect(naechsterLeerlauf(new Date('2026-10-25T00:30:00Z')).toISOString()).toBe('2026-10-25T03:30:00.000Z');
		expect(naechsterLeerlauf(new Date('2026-12-31T23:59:00Z')).toISOString()).toBe('2027-01-01T03:30:00.000Z');
	});
});

describe('restTageText', () => {
	it('sagt bei einem Tag „Tag“, sonst „Tage“', () => {
		expect(restTageText(1)).toBe('noch 1 Tag');
		expect(restTageText(2)).toBe('noch 2 Tage');
		expect(restTageText(PAPIERKORB_TAGE)).toBe('noch 30 Tage');
	});
	it('sagt bei 0, dass er heute Nacht geht', () => {
		expect(restTageText(0)).toBe('wird heute Nacht gelöscht');
	});
	it('passt zu restTage am letzten Tag — auch beim nachts verworfenen Bon', () => {
		const am = new Date('2026-09-01T10:00:00Z');
		expect(restTageText(restTage(am, new Date('2026-09-30T11:00:00Z')))).toBe('noch 1 Tag');
		expect(restTageText(restTage(am, new Date('2026-10-01T12:00:00Z')))).toBe('wird heute Nacht gelöscht');
		expect(restTageText(restTage(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T18:00:00Z')))).toBe(
			'wird heute Nacht gelöscht'
		);
	});
});
