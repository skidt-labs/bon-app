<!-- src/lib/client/berichte/Export.svelte -->
<script lang="ts">
	import { filterAlsAdresse, type BerichtFilter } from '$lib/berichte/filter';
	import Aufklapper from './Aufklapper.svelte';
	import ExportListe from './ExportListe.svelte';

	let { filter, matrix }: { filter: BerichtFilter; matrix: 'bereit' | 'nicht_gekoppelt' | 'kein_chat' } = $props();
	const adresse = $derived(filterAlsAdresse(filter));
</script>

<!-- Nur am Rechner; am Handy steckt der Export in „Mehr". -->
<div class="hidden sm:block">
	<Aufklapper
		titel="Export"
		ausrichtung="rechts"
		breite="sm:w-[300px]"
		knopfKlasse="block rounded-xl border border-linie bg-papier px-4 py-2.5 text-sm font-bold"
	>
		{#snippet knopf()}Export ▾{/snippet}
		<ExportListe {adresse} {matrix} />
	</Aufklapper>
</div>
