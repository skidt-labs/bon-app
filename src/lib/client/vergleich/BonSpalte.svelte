<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { VergleichBon } from '$lib/server/bons/vergleich';
	import type { Unterschied } from '$lib/bons/vergleich';
	import { bildVersion, formatWann, statusText } from '$lib/bons/anzeige';
	import { formatCents } from '$lib/money';

	/**
	 * Eine Spalte der Gegenueberstellung (Doppel vergleichen, 0.12.0): Bild, die fuenf Werte und
	 * darunter die Knoepfe (Snippet der Seite). Was sich vom anderen Bon unterscheidet, steht mit
	 * Text daneben („abweichend" bzw. „fehlt"), nicht nur farbig.
	 */
	let {
		bon,
		titel,
		unterschiede,
		onbild,
		knoepfe
	}: {
		bon: VergleichBon;
		titel: string;
		unterschiede: Set<Unterschied>;
		onbild: () => void;
		knoepfe: Snippet;
	} = $props();

	/** Wie im Entwurf: „bestätigt", „in Prüfung", „fehlgeschlagen", „doppelt". */
	const STATUS: Record<string, string> = { confirmed: 'bestätigt', review: 'in Prüfung', failed: 'fehlgeschlagen', doppelt: 'doppelt' };

	const werte = $derived([
		{ art: 'laden' as const, name: 'Laden', wert: bon.merchantNameRaw?.trim() || null },
		{ art: 'kaufzeit' as const, name: 'Kaufzeit', wert: bon.purchasedAt ? formatWann(bon.purchasedAt) : null },
		{ art: 'summe' as const, name: 'Endsumme', wert: bon.totalGrossCents !== null ? `${formatCents(bon.totalGrossCents)} €` : null },
		{ art: 'positionen' as const, name: 'Positionen', wert: String(bon.anzahlPositionen) }
	]);
</script>

<section class="grid content-start gap-3 rounded-2xl border border-linie bg-papier p-4" aria-label={titel}>
	<div class="flex items-baseline justify-between gap-3">
		<h2 class="text-[15px] font-extrabold">{titel}</h2>
		<a href="/receipts/{bon.id}" class="text-[13px] font-semibold text-gedaempft underline">Zum Bon</a>
	</div>

	<button
		type="button"
		class="block overflow-hidden rounded-xl border border-linie bg-chip"
		aria-label="{titel}: Bild groß ansehen"
		onclick={onbild}
	>
		<img
			src="/receipts/{bon.id}/image?v={bildVersion(bon.imagePath)}"
			alt=""
			class="mx-auto block max-h-[60vh] w-full object-contain object-top"
		/>
	</button>

	<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
		{#each werte as w (w.art)}
			{@const anders = unterschiede.has(w.art)}
			<dt class="text-gedaempft">{w.name}</dt>
			<dd class="min-w-0" class:font-bold={anders}>
				<span class:text-leise={w.wert === null}>{w.wert ?? '—'}</span>
				{#if anders}
					<span class="ml-1.5 rounded-full bg-bernstein-flaeche px-2 py-0.5 text-[11px] font-bold text-bernstein"
						>{w.wert === null ? 'fehlt' : 'abweichend'}</span
					>
				{/if}
			</dd>
		{/each}
		<dt class="text-gedaempft">Status</dt>
		<dd>{STATUS[bon.status] ?? statusText(bon.status)}</dd>
	</dl>
	<p class="text-[12.5px] text-gedaempft">
		Hochgeladen am {formatWann(bon.createdAt)}{#if bon.hochgeladenVon}&nbsp;von {bon.hochgeladenVon}{/if}
	</p>

	<div class="grid gap-2">
		{@render knoepfe()}
	</div>
</section>
