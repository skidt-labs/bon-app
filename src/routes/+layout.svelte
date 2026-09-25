<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import Symbolleiste from '$lib/client/geruest/Symbolleiste.svelte';
	import LeisteUnten from '$lib/client/geruest/LeisteUnten.svelte';
	import { aktiveSeite, leisteUntenSichtbar } from '$lib/client/geruest/navigation';

	let { data, children } = $props();

	const aktiv = $derived(aktiveSeite(page.url.pathname));
	// Ohne Nutzer (Anmeldeseiten) oder auf unbekannten Wegen gibt es kein Geruest.
	const mitGeruest = $derived(data.user !== null && aktiv !== null);
	const leisteUnten = $derived(leisteUntenSichtbar(page.url.pathname));
</script>

<svelte:head>
	<!--
		Drei Groessen statt einer: der Browser nimmt die passendste, ohne zu skalieren.
		Sie stammen ALLE aus der maskierbaren Fassung, die das Abzeichen randfuellend
		zeigt — nicht aus icon-192/512. Die tragen einen undurchsichtigen dunkelblauen
		Rahmen (#111a3b); auf einem Startbildschirm sieht der gewollt aus, in einem Tab
		bei 16 Pixeln sieht man fast nur ihn, und das Icon wirkt schwarz.
		Die .ico steht zuerst: Windows-Verknuepfungen und aeltere Browser fragen danach,
		bevor sie ein <link> mit Groessenangabe auswerten.
	-->
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
	<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png" />
	<!-- Manrope einmal fuer alle Seiten, nicht mehr je Seite. Nicht blockierend geladen:
	     als media="print" angefordert und nach dem Laden auf "all" gestellt. Bis dahin
	     (und ohne JavaScript, siehe noscript) greift die Rueckfallkette aus --font-sans. -->
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
		media="print"
		onload={(e) => ((e.currentTarget as HTMLLinkElement).media = 'all')}
	/>
	<noscript>
		<link
			rel="stylesheet"
			href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
		/>
	</noscript>
</svelte:head>

{#if mitGeruest && data.user}
	<div class="min-h-dvh bg-flaeche font-sans text-tinte lg:flex">
		<Symbolleiste
			{aktiv}
			zaehler={data.zaehler.brauchtDich}
			nutzer={data.user.displayName}
			haushalt={data.haushalt}
		/>
		<div class="min-w-0 flex-1" class:pb-24={leisteUnten}>
			{@render children()}
		</div>
		{#if leisteUnten}
			<LeisteUnten {aktiv} zaehler={data.zaehler.brauchtDich} />
		{/if}
	</div>
{:else}
	{@render children()}
{/if}
