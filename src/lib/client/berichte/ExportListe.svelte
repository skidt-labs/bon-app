<!-- src/lib/client/berichte/ExportListe.svelte -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { getContext } from 'svelte';
	import { MENUE_SCHLIESSEN, type MenueSchliessen } from './menue';
	/** Die drei Ausfuhrwege — Inhalt fuer „Export ▾" (Rechner) und „Mehr" (Handy). */
	let { adresse, matrix }: { adresse: string; matrix: 'bereit' | 'nicht_gekoppelt' | 'kein_chat' } = $props();
	// CSV (Herunterladen) und Drucken (neuer Tab) navigieren nicht — ohne das bliebe das Menue offen (1.4).
	const schliessen = getContext<MenueSchliessen | undefined>(MENUE_SCHLIESSEN);
	const eintrag = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left font-bold hover:bg-chip';
	/** Sammelfassung 3.11: gesperrt, bis die Seite nachgeladen hat; eine Ablehnung steht am Knopf. */
	let sendet = $state(false);
	let meldung = $state<string | null>(null);
	const senden: SubmitFunction = () => {
		sendet = true;
		meldung = null;
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure') meldung = String(result.data?.grund ?? 'Senden ging gerade nicht.');
				else await update();
			} finally {
				sendet = false;
			}
		};
	};
</script>

<div class="grid gap-0.5 text-[13px]">
	<a href="/reports/export.csv?{adresse}" class={eintrag} onclick={() => schliessen?.()}>CSV-Tabelle <span class="text-[12px] font-semibold text-gedaempft">mit den Filtern</span></a>
	<a href="/reports/druck?{adresse}" target="_blank" rel="noopener" class={eintrag} onclick={() => schliessen?.()}>Drucken / als PDF <span class="text-[12px] font-semibold text-gedaempft">neuer Tab</span></a>
	{#if matrix === 'bereit'}
		<form method="POST" action="?/matrix" use:enhance={senden}>
			<input type="hidden" name="adresse" value={adresse} />
			<button class="{eintrag} disabled:opacity-60" disabled={sendet} aria-busy={sendet}>
				{sendet ? 'Wird gesendet …' : 'Zusammenfassung per Matrix'}
				<span class="text-[12px] font-semibold text-gedaempft">Direktchat</span>
			</button>
			{#if meldung}<p role="status" class="px-3 pb-1 text-[12px] font-semibold text-rot-dunkel">{meldung}</p>{/if}
		</form>
	{:else}
		<p class="px-3 py-2 text-[12px] text-gedaempft">
			{matrix === 'nicht_gekoppelt'
				? 'Per Matrix: erst unter Einstellungen koppeln.'
				: 'Per Matrix: schreib dem Bon-Bot einmal im Direktchat.'}
			<a href="/settings/matrix" class="font-semibold text-tuerkis-dunkel">Matrix ›</a>
		</p>
	{/if}
	<p class="px-3 pt-1 pb-1 text-[11px] text-gedaempft">
		Alle drei mit den gesetzten Filtern. Per Matrix kommt nur die Zusammenfassung, keine einzelnen Positionen.
	</p>
</div>
