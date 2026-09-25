import { describe, it, expect } from 'vitest';
import { mitgliedschaftAusZeilen } from './mitglieder';

describe('mitgliedschaftAusZeilen', () => {
	it('liefert Haushalt und Rolle', () => {
		expect(mitgliedschaftAusZeilen([{ householdId: 'h1', rolle: 'verwalter' }])).toEqual({
			householdId: 'h1',
			rolle: 'verwalter'
		});
	});

	it('liefert null ohne Mitgliedschaft', () => {
		expect(mitgliedschaftAusZeilen([])).toBeNull();
	});

	it('wirft bei zwei Mitgliedschaften, statt eine zu raten', () => {
		// Kann die Datenbank nicht zulassen (UNIQUE auf user_id). Traete es doch ein,
		// waere stilles Weiterlaufen der schlimmste Ausgang: der Nutzer saehe zufaellig
		// den einen oder den anderen Haushalt.
		expect(() =>
			mitgliedschaftAusZeilen([
				{ householdId: 'h1', rolle: 'verwalter' },
				{ householdId: 'h2', rolle: 'mitglied' }
			])
		).toThrow(/mehrere Mitgliedschaften/i);
	});
});
