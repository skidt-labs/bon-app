<script lang="ts">
	import Scannen from '$lib/client/scannen/Scannen.svelte';
	import Startseite from '$lib/client/dashboard/Startseite.svelte';

	let { data } = $props();

	/**
	 * Die Eingangstuer. Am Handy ist die Kamera das Richtige, am Schreibtisch der
	 * Ueberblick — Entscheidung des Betreibers am 17.09.2026.
	 *
	 * Beide Ansichten stehen im Markup und CSS entscheidet: keine Medienabfrage, keine
	 * Umleitung. Eine Umleitung zeigte am Schreibtisch erst die Kamera und spraenge dann
	 * weg; und die Adresse per replaceState umzuschreiben, damit die Leiste „Start"
	 * hervorhebt, war Kosmetik mit Nebenwirkung — replaceState ist fuer flaches Routing
	 * INNERHALB derselben Route gedacht, und danach stand `page.url` auf /dashboard,
	 * waehrend die geladene Route weiter / war. `hidden` nimmt die jeweils andere
	 * Haelfte auch aus dem Tab-Weg.
	 */
</script>

<div class="lg:hidden"><Scannen {data} /></div>
<div class="hidden lg:block"><Startseite {data} /></div>
