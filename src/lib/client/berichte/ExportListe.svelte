<!-- src/lib/client/berichte/ExportListe.svelte -->
<script lang="ts">
	/** Die drei Ausfuhrwege — Inhalt fuer „Export ▾" (Rechner) und „Mehr" (Handy). */
	let { adresse, matrix }: { adresse: string; matrix: 'bereit' | 'nicht_gekoppelt' | 'kein_chat' } = $props();
	const eintrag = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left font-bold hover:bg-chip';
</script>

<div class="grid gap-0.5 text-[13px]">
	<a href="/reports/export.csv?{adresse}" class={eintrag}>CSV-Tabelle <span class="text-[12px] font-semibold text-gedaempft">mit den Filtern</span></a>
	<a href="/reports/druck?{adresse}" target="_blank" rel="noopener" class={eintrag}>Drucken / als PDF <span class="text-[12px] font-semibold text-gedaempft">neuer Tab</span></a>
	{#if matrix === 'bereit'}
		<form method="POST" action="?/matrix">
			<input type="hidden" name="adresse" value={adresse} />
			<button class={eintrag}>Zusammenfassung per Matrix <span class="text-[12px] font-semibold text-gedaempft">Direktchat</span></button>
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
