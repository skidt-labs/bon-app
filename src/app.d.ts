// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SessionUser } from '$lib/server/auth/session';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

declare global {
	namespace App {
		interface Error {
			message: string;
			/**
			 * Bei 409 aus Speichern/Bestaetigen (0.13.0): welcher Ausweg passt.
			 * `veraltet` → „Meine Fassung speichern“, `status`/`doppel` → neu laden.
			 */
			code?: 'veraltet' | 'status' | 'doppel';
		}
		interface Locals {
			user: SessionUser | null;
			zugriff: Zugriffskontext | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
