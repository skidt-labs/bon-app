import { describe, it, expect } from 'vitest';
import { households, users, sessions, householdMembers } from './schema';
import { getTableName } from 'drizzle-orm';

describe('Grundschema', () => {
	it('legt die drei Basistabellen an', () => {
		expect(getTableName(households)).toBe('households');
		expect(getTableName(users)).toBe('users');
		expect(getTableName(sessions)).toBe('sessions');
	});
	it('verankert Nutzer an einem Haushalt', () => {
		// users.household_id ist am 18.09.2026 gefallen. Die Zugehoerigkeit liegt seither
		// ausschliesslich in household_members — zusammen mit der Rolle, zu der sie gehoert.
		expect('householdId' in users).toBe(false);
	});
	it('macht oidc_sub eindeutig', () => {
		expect(users.oidcSub.isUnique).toBe(true);
	});
});

describe('Mitgliedschaft', () => {
	it('legt household_members an', () => {
		expect(getTableName(householdMembers)).toBe('household_members');
	});
	it('laesst einen Nutzer nur EINER Mitgliedschaft zuordnen', () => {
		// Die Eindeutigkeit steht auf user_id, nicht auf dem Paar (householdId, userId) —
		// siehe Kommentar an householdMembers in schema.ts. Zwei Mitgliedschaften fuer
		// denselben Nutzer waeren nicht entscheidbar, welcher Haushalt gemeint ist.
		expect(householdMembers.userId.isUnique).toBe(true);
	});
	it('verlangt fuer jede Mitgliedschaft eine Rolle', () => {
		expect(householdMembers.rolle.notNull).toBe(true);
	});
});
