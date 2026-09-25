<script lang="ts">
	import Pruefen from '$lib/client/pruefen/Pruefen.svelte';

	let { data } = $props();
</script>

<!--
	Eine Ansicht fuer beide Breiten. Bis zum 17.09.2026 standen hier zwei: die alte
	Handy-Seite und, ab 1024 px, die neue Zwei-Spalten-Ansicht, ausgewaehlt per
	Medienabfrage. Das kostete nicht nur doppelte Pflege — die alte Seite kannte weder
	Einzelpreis noch Verschieben noch die Rechenprobe, und bei einem bestaetigten Bon
	bot sie einen Bestaetigen-Knopf an, der mit einem Fehler abprallte. Jetzt entscheidet
	CSS ueber die Anordnung, und es gibt nur noch eine Wahrheit.
-->
<Pruefen {data} />
