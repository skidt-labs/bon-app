import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Sammelfassung 4.7: starteMatrixBot braucht einen Homeserver und laesst sich nicht als Ganzes
 * testen (client.ts, Kommentar bei erzeugeSpeicherWrapper). Die Logik steckt in
 * berichtsdienst.ts und ist dort getestet — hier nur, dass client.ts sie auch benutzt.
 */
const quelle = readFileSync('src/matrix/client.ts', 'utf8');

describe('bon-matrix: Berichtsdienst verdrahtet (4.7)', () => {
	it('holt pg-boss nur im Berichtsdienst, nicht vorab im Start', () => {
		const start = quelle.indexOf('berichtsdienstStarten({');
		const ende = quelle.indexOf('melden:', start);
		const aufrufe = [...quelle.matchAll(/getBoss\(\)/g)].map((m) => m.index);
		expect(start).toBeGreaterThan(-1);
		expect(aufrufe.length).toBeGreaterThan(0);
		expect(aufrufe.filter((i) => i < start || i > ende)).toEqual([]);
	});

	it('stoppt pg-boss beim Beenden, nach der Kette', () => {
		expect(quelle).toContain('void beendeSauber(() => kette, (frist) => berichte.beenden(frist));');
		expect(quelle).toContain('await berichteBeenden(stoppFrist(Date.now() - start));');
	});
});
