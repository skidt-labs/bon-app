<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const ROLLEN_TEXT: Record<string, string> = { verwalter: 'Verwalter', mitglied: 'Mitglied' };

	const FEHLER_TEXT: Record<string, string> = {
		abgelaufen: 'Diese Einladung ist abgelaufen — bitte um einen neuen Link.',
		verbraucht: 'Diese Einladung wurde bereits eingelöst.',
		'haushalt-nicht-leer':
			'Dein aktueller Haushalt hat noch Bons, Töpfe oder weitere Mitglieder — du kannst ihn deshalb nicht verlassen. Erst müsste er leer sein.'
	};
</script>

<Seite
	titel="Haushalt beitreten"
	haushalt={data.haushalt}
	nutzer={data.user?.displayName ?? null}
>
	<div class="rounded border p-4">
		<p class="text-sm">
			Du wurdest eingeladen, <strong>„{data.haushaltsname}"</strong> als
			<strong>{ROLLEN_TEXT[data.rolle] ?? data.rolle}</strong> beizutreten.
		</p>
		<p class="mt-2 text-xs text-gray-500">
			Dein bisheriger Haushalt geht dabei verloren — das funktioniert nur, wenn er leer ist
			(keine Bons, keine Töpfe, keine weiteren Mitglieder). Das ist normalerweise der Fall bei
			einer frischen Anmeldung.
		</p>

		{#if form?.ergebnis}
			<p class="mt-3 text-sm text-red-700">{FEHLER_TEXT[form.ergebnis] ?? 'Das hat nicht geklappt.'}</p>
		{/if}

		<form method="POST" use:enhance class="mt-4">
			<button class="rounded bg-black px-4 py-2 text-sm text-white">Beitreten</button>
		</form>
	</div>
</Seite>
