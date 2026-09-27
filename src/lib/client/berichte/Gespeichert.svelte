<script lang="ts">
	import { filterAlsAdresse, hatFilter, type BerichtFilter } from '$lib/berichte/filter';
	import Aufklapper from './Aufklapper.svelte';
	import GespeichertListe from './GespeichertListe.svelte';
	import SpeichernFormular from './SpeichernFormular.svelte';

	type Eintrag = { id: string; name: string; erstellerName: string | null; darfAendern: boolean };
	type Aktiv = { id: string; name: string; darfAendern: boolean; geaendert: boolean };
	let {
		gespeicherte,
		aktiv,
		filter,
		fehler = null
	}: { gespeicherte: Eintrag[]; aktiv: Aktiv | null; filter: BerichtFilter; fehler?: string | null } = $props();

	const adresse = $derived(filterAlsAdresse(filter));
	const knopfStil = 'block rounded-full border border-linie bg-papier px-3 py-1.5 whitespace-nowrap';
	// Am Handy stehen die beiden Menues in „Mehr"; was hier bleibt, ist nur der Zustand.
	const sichtbar = $derived(aktiv !== null || fehler !== null);
</script>

<div class="mb-3 flex-wrap items-center gap-2 text-[13px] font-bold sm:flex" class:flex={sichtbar} class:hidden={!sichtbar}>
	<div class="hidden sm:contents">
		<Aufklapper titel="Gespeicherte Berichte" knopfKlasse={knopfStil}>
			{#snippet knopf()}Gespeicherte Berichte ▾{/snippet}
			<GespeichertListe {gespeicherte} aktivId={aktiv?.id ?? null} {adresse} />
		</Aufklapper>

		{#if hatFilter(filter) || filter.umfang === 'meine'}
			<Aufklapper titel="Speichern unter …" knopfKlasse={knopfStil}>
				{#snippet knopf()}Speichern unter …{/snippet}
				<SpeichernFormular {adresse} />
			</Aufklapper>
		{/if}
	</div>

	{#if aktiv}
		<span class="rounded-full bg-chip px-3 py-1.5">Gespeichert: {aktiv.name}</span>
		{#if aktiv.darfAendern && aktiv.geaendert}
			<form method="POST" action="?/aendern">
				<input type="hidden" name="id" value={aktiv.id} />
				<input type="hidden" name="adresse" value={adresse} />
				<button class="rounded-full border border-linie bg-papier px-3 py-1.5">Änderungen speichern</button>
			</form>
		{/if}
	{/if}

	{#if fehler}
		<p class="w-full rounded-xl bg-rot-flaeche px-3.5 py-2.5 text-rot-dunkel">{fehler}</p>
	{/if}
</div>
