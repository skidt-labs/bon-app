<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import BonListe from '$lib/client/bons/BonListe.svelte';
	import Filterleiste from '$lib/client/bons/Filterleiste.svelte';

	let { data } = $props();

	const untertitel = $derived.by(() => {
		const z = data.zaehler;
		const teile = [
			`${z.brauchtDich} ${z.brauchtDich === 1 ? 'wartet' : 'warten'} auf dich`,
			z.wirdGelesen ? `${z.wirdGelesen} ${z.wirdGelesen === 1 ? 'wird' : 'werden'} gerade gelesen` : null,
			z.fehlgeschlagen ? `${z.fehlgeschlagen} fehlgeschlagen` : null
		];
		return teile.filter(Boolean).join(' · ');
	});
</script>

<Seite titel="Posteingang" {untertitel} haushalt={data.haushalt} nutzer={data.user?.displayName ?? null}>
	{#snippet aktion()}
		<a href="/scan" class="hidden rounded-xl bg-tuerkis px-4 py-2.5 text-sm font-extrabold text-white lg:inline-block">Bon hochladen</a>
	{/snippet}
	<Filterleiste filter={data.filter} zaehler={data.zaehler} mitMonat={false} hinweise={data.hinweise} />
	<BonListe
		bons={data.bons}
		leerText={data.filter.status === 'brauchtDich' ? 'Nichts wartet auf dich.' : 'Keine Bons mit diesem Filter.'}
	/>
</Seite>
