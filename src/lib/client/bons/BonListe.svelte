<script lang="ts">
	import { formatCents } from '$lib/money';
	import { describeProblem } from '$lib/bons/beanstandungen';
	import { statusText, quelleText, formatWann, tagesgruppen } from '$lib/bons/anzeige';
	import { erneutLesen } from './erneutLesen';
	import type { BonZeile } from '$lib/server/bons/liste';

	let { bons, leerText }: { bons: BonZeile[]; leerText: string } = $props();

	// Eigene Kopie, damit "Erneut lesen" den Status sofort zeigen kann, ohne die Seite
	// neu zu laden. Wechselt `bons` von aussen (neuer Filter), wird die Kopie ersetzt.
	let zeilen = $state<BonZeile[]>([]);
	$effect(() => {
		zeilen = bons.map((b) => ({ ...b }));
	});
	let meldungen = $state<Record<string, string>>({});
	let laufend = $state<Record<string, boolean>>({});

	const gruppen = $derived(tagesgruppen(zeilen));

	function problemText(b: BonZeile): string {
		if (b.status === 'failed') return b.failureReason ?? 'Auslesen fehlgeschlagen. Das Bild ist gespeichert.';
		return (b.problems ?? []).map(describeProblem).join(' · ');
	}

	async function nochmal(b: BonZeile) {
		laufend[b.id] = true;
		const ergebnis = await erneutLesen(b.id);
		laufend[b.id] = false;
		if (ergebnis.ok) {
			b.status = 'pending';
			b.failureReason = null;
			delete meldungen[b.id];
		} else {
			meldungen[b.id] = ergebnis.meldung;
		}
	}
</script>

{#if zeilen.length === 0}
	<p class="pt-2 text-sm text-leise">{leerText}</p>
{:else}
	<!-- Ab 1024 px: Tabelle. Was man am Schreibtisch wissen will, bevor man klickt —
	     Beanstandung im Klartext, Quelle, Status als Chip. -->
	<div class="hidden overflow-x-auto rounded-2xl bg-papier shadow-[0_0_0_1px_var(--color-linie)] lg:block">
		<table class="w-full border-collapse text-[13px]">
			<thead>
				<tr class="text-left text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">
					<th class="px-3 py-2.5">Datum</th>
					<th class="px-3 py-2.5">Händler</th>
					<th class="px-3 py-2.5 text-right">Summe</th>
					<th class="px-3 py-2.5 text-right">Pos.</th>
					<th class="px-3 py-2.5">Status</th>
					<th class="px-3 py-2.5">Beanstandung</th>
					<th class="px-3 py-2.5">Quelle</th>
					<th class="px-3 py-2.5"></th>
				</tr>
			</thead>
			<tbody>
				{#each zeilen as b (b.id)}
					<tr class="border-t border-linie" class:opacity-70={b.status === 'extracting' || b.status === 'pending'}>
						<td class="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatWann(b.purchasedAt ?? b.createdAt)}</td>
						<td class="px-3 py-2.5 font-semibold">{b.merchant ?? 'Unbekannter Händler'}</td>
						<td class="px-3 py-2.5 text-right tabular-nums" class:text-leise={b.totalGrossCents === null}>
							{b.totalGrossCents !== null ? formatCents(b.totalGrossCents) : '—'}
						</td>
						<td class="px-3 py-2.5 text-right tabular-nums" class:text-leise={b.positionen === 0}>{b.positionen || '—'}</td>
						<td class="px-3 py-2.5 whitespace-nowrap">
							<span
								class="rounded-full px-2 py-0.5 text-[11px] font-bold"
								class:bg-tuerkis-flaeche={b.status === 'review'}
								class:text-tuerkis-dunkel={b.status === 'review'}
								class:bg-rot-flaeche={b.status === 'failed'}
								class:text-rot-dunkel={b.status === 'failed'}
								class:bg-chip={b.status !== 'review' && b.status !== 'failed'}
								class:text-gedaempft={b.status !== 'review' && b.status !== 'failed'}>{statusText(b.status)}</span
							>
						</td>
						<td class="px-3 py-2.5 text-leise" class:text-tuerkis-dunkel={b.status === 'review' && !problemText(b)}>
							{problemText(b) || (b.status === 'review' ? 'keine' : '')}
							{#if meldungen[b.id]}<span class="block text-rot-dunkel">{meldungen[b.id]}</span>{/if}
						</td>
						<td class="px-3 py-2.5 text-leise">{quelleText(b.source)}</td>
						<td class="px-3 py-2.5 text-right whitespace-nowrap">
							{#if b.status === 'failed'}
								<button type="button" class="font-bold text-tuerkis-dunkel" disabled={laufend[b.id]} onclick={() => nochmal(b)}>
									{laufend[b.id] ? 'Wird eingereiht …' : 'Erneut lesen'}
								</button>
							{:else if b.status === 'review' || b.status === 'confirmed'}
								<a href="/receipts/{b.id}" class="font-bold text-tuerkis-dunkel">{b.status === 'review' ? 'Prüfen ›' : 'Ansehen ›'}</a>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Unter 1024 px: Karten nach Tagen, wie bisher im Posteingang. -->
	<div class="space-y-3 lg:hidden">
		{#each gruppen as gruppe (gruppe.tag)}
			<p class="px-1 pt-1 text-[11px] font-bold tracking-[0.08em] text-leise uppercase">{gruppe.tag}</p>
			{#each gruppe.bons as b (b.id)}
				<article
					class="rounded-2xl bg-papier px-4 py-3.5"
					class:bg-chip={b.status === 'confirmed'}
					class:opacity-85={b.status === 'extracting' || b.status === 'pending'}
					class:shadow-[inset_4px_0_0_var(--color-tuerkis)]={b.status === 'review'}
					class:shadow-[inset_4px_0_0_var(--color-rot)]={b.status === 'failed'}
				>
					<a href={b.status === 'review' || b.status === 'confirmed' ? `/receipts/${b.id}` : undefined} class="block">
						<div class="flex items-baseline justify-between gap-3">
							<span class="text-base font-bold" class:text-gedaempft={b.status === 'confirmed'}>{b.merchant ?? 'Unbekannter Händler'}</span>
							<span class="text-base font-bold tabular-nums" class:text-leise={b.totalGrossCents === null}>
								{b.totalGrossCents !== null ? `${formatCents(b.totalGrossCents)} €` : '—'}
							</span>
						</div>
						<p class="mt-0.5 text-sm text-gedaempft">
							{formatWann(b.purchasedAt ?? b.createdAt)} · {b.positionen ? `${b.positionen} Positionen · ` : ''}{quelleText(b.source)} · {statusText(b.status)}
						</p>
						{#if problemText(b)}
							<p class="mt-1.5 text-sm" class:text-bernstein={b.status !== 'failed'} class:text-rot-dunkel={b.status === 'failed'}>{problemText(b)}</p>
						{/if}
					</a>
					{#if b.status === 'failed'}
						<div class="mt-2.5 flex items-center gap-3">
							<button
								type="button"
								class="rounded-xl bg-tuerkis px-3.5 py-2 text-[13px] font-extrabold text-white disabled:opacity-60"
								disabled={laufend[b.id]}
								onclick={() => nochmal(b)}>{laufend[b.id] ? 'Wird eingereiht …' : 'Erneut lesen'}</button
							>
							{#if meldungen[b.id]}<span class="text-sm text-rot-dunkel">{meldungen[b.id]}</span>{/if}
						</div>
					{/if}
				</article>
			{/each}
		{/each}
	</div>
{/if}
