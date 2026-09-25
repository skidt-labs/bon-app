<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import BonListe from '$lib/client/bons/BonListe.svelte';
	import Filterleiste from '$lib/client/bons/Filterleiste.svelte';

	let { data } = $props();

	const untertitel = $derived(
		`${data.bons.length} ${data.bons.length === 1 ? 'Bon' : 'Bons'}${data.filter.monat ? ` im ${data.filter.monat}` : ''} · ${data.zaehler.bestaetigt} bestätigt insgesamt`
	);
</script>

<Seite titel="Bons" {untertitel} haushalt={data.haushalt} nutzer={data.user?.displayName ?? null}>
	<Filterleiste filter={data.filter} zaehler={data.zaehler} mitMonat={true} hinweise={data.hinweise} />
	<BonListe bons={data.bons} leerText="Keine Bons mit diesem Filter." />
</Seite>
