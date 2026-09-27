<script lang="ts">
	import { formatCents } from '$lib/money';
	import { describeProblem, keinBonCode } from '$lib/bons/beanstandungen';
	import { statusText, quelleText, formatWann, tagesgruppen } from '$lib/bons/anzeige';
	import { invalidateAll } from '$app/navigation';
	import { erneutLesen } from './erneutLesen';
	import { papierkorbAktion } from './papierkorb';
	import { restTage } from '$lib/bons/papierkorb';
	import Aufklapper from '$lib/client/berichte/Aufklapper.svelte';
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
	/** Pro Bon: steht die zweite Stufe fuer einen bestaetigten Bon bzw. fuers Loeschen offen? */
	let nachfrage = $state<Record<string, 'verwerfen' | 'loeschen' | undefined>>({});

	const gruppen = $derived(tagesgruppen(zeilen));

	function problemText(b: BonZeile): string {
		// Sieht es gar nicht wie ein Kassenbon aus, ist das die verstaendlichere Auskunft als
		// der technische Grund der Vorpruefung.
		const keinBon = keinBonCode(b.problems);
		if (b.status === 'failed') return keinBon ? describeProblem(keinBon) : (b.failureReason ?? 'Auslesen fehlgeschlagen. Das Bild ist gespeichert.');
		return (b.problems ?? []).map(describeProblem).join(' · ');
	}

	/**
	 * Papierkorb (bons/papierkorb.ts). Zweistufig, wo es weh tut: einen bestaetigten Bon
	 * verwerfen und endgueltig loeschen — der erste Klick fragt nach, der zweite handelt.
	 */
	async function korb(b: BonZeile, aktion: 'verwerfen' | 'wiederherstellen' | 'loeschen') {
		const braucht = aktion === 'loeschen' || (aktion === 'verwerfen' && b.status === 'confirmed');
		if (braucht && nachfrage[b.id] !== aktion) {
			nachfrage[b.id] = aktion;
			return;
		}
		laufend[b.id] = true;
		const r = await papierkorbAktion(
			b.id,
			aktion,
			aktion === 'verwerfen' ? { bestaetigtWegnehmen: b.status === 'confirmed' } : {}
		);
		laufend[b.id] = false;
		nachfrage[b.id] = undefined;
		if (!r.ok) {
			meldungen[b.id] = r.meldung;
			return;
		}
		// Liste und Zaehler neu vom Server: der Bon wechselt den Filter.
		await invalidateAll();
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
						<td class="px-3 py-2.5 font-semibold">
							{#if b.status === 'failed' || b.status === 'verworfen'}
								<!-- Ohne Bild waere ein fehlgeschlagener Bon nicht zu erkennen: kein Haendler,
								     keine Summe, nur ein Fehlergrund (27.09.2026). -->
								<a href="/receipts/{b.id}" class="flex items-center gap-2.5" aria-label="Bon ansehen und von Hand eintragen">
									<img src="/receipts/{b.id}/image?vorschau" alt="" loading="lazy" class="h-12 w-9 shrink-0 rounded-md bg-chip object-cover object-top" />
									<span>{b.merchant ?? 'Unbekannter Händler'}</span>
								</a>
							{:else}
								{b.merchant ?? 'Unbekannter Händler'}
							{/if}
						</td>
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
								<a href="/receipts/{b.id}" class="ml-3 font-bold text-tuerkis-dunkel">Eintragen ›</a>
							{:else if b.status === 'review' || b.status === 'confirmed' || b.status === 'verworfen' || b.status === 'doppelt'}
								<a href="/receipts/{b.id}" class="font-bold text-tuerkis-dunkel">{b.status === 'review' ? 'Prüfen ›' : 'Ansehen ›'}</a>
							{/if}
							<!-- Direkt in der Zeile statt als Menue: die Tabelle rollt waagerecht
							     (overflow-x-auto), ein aufklappender Kasten wuerde darin abgeschnitten. -->
							{#if b.status === 'verworfen'}
								<span class="ml-3 text-[12px] font-semibold text-leise">noch {b.verworfenAm ? restTage(b.verworfenAm, new Date()) : 0} Tage</span>
								{#if b.darfVerwerfen}
									<button type="button" class="ml-3 font-bold text-tuerkis-dunkel" disabled={laufend[b.id]} onclick={() => korb(b, 'wiederherstellen')}>Wiederherstellen</button>
									<button type="button" class="ml-3 font-bold text-rot-dunkel" disabled={laufend[b.id]} onclick={() => korb(b, 'loeschen')}>
										{nachfrage[b.id] === 'loeschen' ? 'Wirklich endgültig löschen?' : 'Löschen'}
									</button>
								{/if}
							{:else if b.darfVerwerfen}
								<button type="button" class="ml-3 font-bold text-rot-dunkel" disabled={laufend[b.id]} onclick={() => korb(b, 'verwerfen')}>
									{nachfrage[b.id] === 'verwerfen' ? 'Bestätigt – trotzdem verwerfen?' : 'Verwerfen'}
								</button>
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
					class="relative rounded-2xl bg-papier px-4 py-3.5"
					class:bg-chip={b.status === 'confirmed'}

					class:shadow-[inset_4px_0_0_var(--color-tuerkis)]={b.status === 'review'}
					class:shadow-[inset_4px_0_0_var(--color-rot)]={b.status === 'failed'}
				>
					<a
						href={b.status === 'review' || b.status === 'confirmed' || b.status === 'failed' || b.status === 'verworfen'
							? `/receipts/${b.id}`
							: undefined}
						class="flex gap-3"
						class:opacity-85={b.status === 'extracting' || b.status === 'pending'}
						class:opacity-70={b.status === 'verworfen'}
					>
						<!-- Die Deckkraft liegt HIER, nicht auf der Karte: auf der Karte erzeugte sie einen
						     eigenen Stapelkontext, und das Menue-Blatt darin (fixed, z-50) lag unter der
						     unteren Leiste und den folgenden Karten und war selbst durchscheinend. -->
						{#if b.status === 'failed' || b.status === 'verworfen'}
							<img src="/receipts/{b.id}/image?vorschau" alt="" loading="lazy" class="h-16 w-12 shrink-0 rounded-md bg-chip object-cover object-top" />
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline justify-between gap-3" class:pr-10={b.darfVerwerfen}>
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
							{#if b.status === 'verworfen' && b.verworfenAm}
								<p class="mt-1.5 text-sm font-semibold text-gedaempft">Noch {restTage(b.verworfenAm, new Date())} Tage im Papierkorb</p>
							{/if}
						</div>
					</a>
					{#if b.darfVerwerfen}
						<div class="absolute top-2.5 right-2.5">
							<Aufklapper
								titel={b.merchant ?? 'Unbekannter Händler'}
								ausrichtung="rechts"
								breite="sm:w-[260px]"
								label="Aktionen für diesen Bon"
								knopfKlasse="grid h-9 w-9 place-items-center rounded-full border border-linie bg-papier text-[15px] font-extrabold text-gedaempft"
							>
								{#snippet knopf()}⋯{/snippet}
								<div class="grid gap-1 text-[15px] font-bold">
									{#if b.status === 'verworfen'}
										<button type="button" class="min-h-11 rounded-lg px-2 text-left" disabled={laufend[b.id]} onclick={() => korb(b, 'wiederherstellen')}>Wiederherstellen</button>
										<button type="button" class="min-h-11 rounded-lg px-2 text-left text-rot-dunkel" disabled={laufend[b.id]} onclick={() => korb(b, 'loeschen')}>
											{nachfrage[b.id] === 'loeschen' ? 'Wirklich endgültig löschen' : 'Jetzt löschen'}
										</button>
										{#if nachfrage[b.id] === 'loeschen'}
											<p class="px-2 text-[13px] font-semibold text-gedaempft">Bild und Daten sind danach weg.</p>
										{/if}
									{:else}
										<button type="button" class="min-h-11 rounded-lg px-2 text-left text-rot-dunkel" disabled={laufend[b.id]} onclick={() => korb(b, 'verwerfen')}>
											{nachfrage[b.id] === 'verwerfen' ? 'Trotzdem in den Papierkorb' : 'Verwerfen'}
										</button>
										{#if nachfrage[b.id] === 'verwerfen'}
											<p class="px-2 text-[13px] font-semibold text-gedaempft">Dieser Bon ist bestätigt. Im Papierkorb zählt er nicht mehr in Berichten und Budgets.</p>
										{:else}
											<p class="px-2 text-[13px] font-semibold text-gedaempft">30 Tage lang lässt er sich wiederherstellen.</p>
										{/if}
									{/if}
									{#if meldungen[b.id]}<p class="px-2 text-[13px] text-rot-dunkel">{meldungen[b.id]}</p>{/if}
								</div>
							</Aufklapper>
						</div>
					{/if}
					{#if b.status === 'failed'}
						<div class="mt-2.5 flex items-center gap-3">
							<button
								type="button"
								class="rounded-xl bg-tuerkis px-3.5 py-2 text-[13px] font-extrabold text-white disabled:opacity-60"
								disabled={laufend[b.id]}
								onclick={() => nochmal(b)}>{laufend[b.id] ? 'Wird eingereiht …' : 'Erneut lesen'}</button
							>
							<a href="/receipts/{b.id}" class="text-[13px] font-bold text-tuerkis-dunkel">Von Hand eintragen ›</a>
							{#if b.darfVerwerfen && keinBonCode(b.problems)}
								<!-- Sieht nicht wie ein Kassenbon aus: Verwerfen gleich hier, nicht erst im Menue. -->
								<button type="button" class="text-[13px] font-bold text-rot-dunkel" disabled={laufend[b.id]} onclick={() => korb(b, 'verwerfen')}>Verwerfen</button>
							{/if}
							{#if meldungen[b.id]}<span class="text-sm text-rot-dunkel">{meldungen[b.id]}</span>{/if}
						</div>
					{/if}
				</article>
			{/each}
		{/each}
	</div>
{/if}
