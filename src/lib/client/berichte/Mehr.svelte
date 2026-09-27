<!-- src/lib/client/berichte/Mehr.svelte -->
<script lang="ts">
	import { filterAlsAdresse, hatFilter, type BerichtFilter } from '$lib/berichte/filter';
	import Aufklapper from './Aufklapper.svelte';
	import GespeichertListe from './GespeichertListe.svelte';
	import SpeichernFormular from './SpeichernFormular.svelte';
	import ExportListe from './ExportListe.svelte';

	/**
	 * Nur am Handy: EIN Knopf statt „Gespeicherte Berichte", „Speichern unter …" und „Export"
	 * nebeneinander — deren Menues verdeckten sich dort gegenseitig (Rueckmeldung 27.09.2026).
	 */
	type Eintrag = { id: string; name: string; erstellerName: string | null; darfAendern: boolean };
	let {
		gespeicherte,
		aktivId,
		filter,
		matrix
	}: {
		gespeicherte: Eintrag[];
		aktivId: string | null;
		filter: BerichtFilter;
		matrix: 'bereit' | 'nicht_gekoppelt' | 'kein_chat';
	} = $props();

	const adresse = $derived(filterAlsAdresse(filter));
	const ABSCHNITT = 'mt-4 mb-1.5 text-[10.5px] font-extrabold tracking-[0.08em] text-gedaempft uppercase first:mt-0';
</script>

<div class="sm:hidden">
	<Aufklapper titel="Mehr" ausrichtung="rechts" knopfKlasse="flex min-h-11 items-center gap-1 rounded-xl border border-linie bg-papier px-3.5 text-sm font-bold">
		{#snippet knopf()}Mehr <span aria-hidden="true">▾</span>{/snippet}
		<h3 class={ABSCHNITT}>Gespeicherte Berichte</h3>
		<GespeichertListe {gespeicherte} {aktivId} {adresse} />
		{#if hatFilter(filter) || filter.umfang === 'meine'}
			<h3 class={ABSCHNITT}>Speichern unter …</h3>
			<SpeichernFormular {adresse} />
		{/if}
		<h3 class={ABSCHNITT}>Export</h3>
		<ExportListe {adresse} {matrix} />
	</Aufklapper>
</div>
