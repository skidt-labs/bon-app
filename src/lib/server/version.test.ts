import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { versionAusPaket, VERSION } from './version';

describe('versionAusPaket', () => {
	it('liest die Version aus dem Paket', () => {
		expect(versionAusPaket('{"name":"bon-app","version":"1.2.3"}')).toBe('1.2.3');
	});

	it('nimmt auch eine Vorabfassung', () => {
		expect(versionAusPaket('{"version":"0.2.0-rc.1"}')).toBe('0.2.0-rc.1');
	});

	// Die Voreinstellung eines frischen SvelteKit-Projekts ist "0.0.1" — eine Zahl,
	// die nie jemand gesetzt hat. Sie ist gueltig und darf durch; der Riegel hier
	// richtet sich gegen FEHLENDE oder unsinnige Angaben, nicht gegen kleine Zahlen.
	it('laesst 0.0.1 durch', () => {
		expect(versionAusPaket('{"version":"0.0.1"}')).toBe('0.0.1');
	});

	// Lieber werfen als etwas Erfundenes anzeigen: eine Oberflaeche, die "1.0.0"
	// behauptet, obwohl nichts dort steht, macht jede Fehlersuche wertlos.
	it('wirft, wenn keine Version dasteht', () => {
		for (const murks of ['{}', '{"version":null}', '{"version":42}', '{"version":"latest"}', '{"version":""}']) {
			expect(() => versionAusPaket(murks), murks).toThrow(/version/i);
		}
	});

	it('wirft bei kaputtem JSON', () => {
		expect(() => versionAusPaket('{kein json')).toThrow();
	});
});

describe('VERSION', () => {
	// Der eigentliche Nachweis. Die reine Funktion zu pruefen zeigt nur, dass der
	// Parser stimmt — nicht, dass das Modul die Datei auch FINDET. Genau daran
	// scheitert es im Container, wenn das Arbeitsverzeichnis ein anderes ist.
	it('stimmt mit der package.json dieses Projekts ueberein', () => {
		const erwartet = JSON.parse(readFileSync('package.json', 'utf8')).version;
		expect(VERSION).toBe(erwartet);
	});

	it('ist nicht der Rueckfallwert', () => {
		expect(VERSION).not.toBe('unbekannt');
	});
});
