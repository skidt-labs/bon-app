<script lang="ts">
	import Bonbild from './Bonbild.svelte';
	import type { OcrZeileKurz } from '$lib/server/ocr/anbieter';

	let {
		bonId,
		zeilen,
		gewaehlt,
		onwaehlen,
		onschliessen
	}: {
		bonId: string;
		zeilen: OcrZeileKurz[] | null;
		gewaehlt: number | null;
		onwaehlen: (index: number) => void;
		onschliessen: () => void;
	} = $props();

	/**
	 * Der Bon gross, ueber allem. Innen steckt dieselbe Komponente wie am Schreibtisch —
	 * damit gibt es Zoom, Rahmen und die Treffersuche hier geschenkt, statt ein zweites
	 * Mal geschrieben und ein zweites Mal falsch.
	 */
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onschliessen()} />

<div class="fixed inset-0 z-50 flex flex-col bg-tinte/95" role="dialog" aria-modal="true" aria-label="Bon im Vollbild">
	<div
		class="flex items-center justify-between px-4 text-papier"
		style="padding-top: calc(env(safe-area-inset-top, 0px) + 10px); padding-bottom: 10px"
	>
		<span class="text-[13px] font-bold">Bon</span>
		<button
			type="button"
			class="rounded-xl border border-papier/30 px-3.5 py-1.5 text-[13px] font-bold"
			onclick={onschliessen}>Schließen</button
		>
	</div>
	<div class="min-h-0 flex-1">
		<Bonbild {bonId} {zeilen} {gewaehlt} {onwaehlen} />
	</div>
</div>
