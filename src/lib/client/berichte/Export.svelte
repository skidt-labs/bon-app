<script lang="ts">
	import { filterAlsAdresse, type BerichtFilter } from '$lib/berichte/filter';

	let { filter, matrix }: { filter: BerichtFilter; matrix: 'bereit' | 'nicht_gekoppelt' | 'kein_chat' } = $props();

	const adresse = $derived(filterAlsAdresse(filter));
	const eintrag = 'block w-full rounded-lg px-3 py-2 text-left font-bold hover:bg-chip';
</script>

<details class="relative">
	<summary class="cursor-pointer list-none rounded-xl border border-linie bg-papier px-4 py-2.5 text-sm font-bold [&::-webkit-details-marker]:hidden">Export ▾</summary>
	<div class="absolute right-0 z-30 mt-2 grid w-[300px] max-w-[calc(100vw-32px)] gap-0.5 rounded-2xl bg-papier p-2 text-[13px] shadow-[0_8px_30px_rgba(17,26,59,0.18)]">
		<a href="/reports/export.csv?{adresse}" class={eintrag}>CSV-Tabelle</a>
		<a href="/reports/druck?{adresse}" target="_blank" rel="noopener" class={eintrag}>Drucken / als PDF</a>
		{#if matrix === 'bereit'}
			<form method="POST" action="?/matrix">
				<input type="hidden" name="adresse" value={adresse} />
				<button class={eintrag}>Zusammenfassung per Matrix</button>
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
</details>
