<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Seite from '$lib/client/geruest/Seite.svelte';
	import BonSpalte from '$lib/client/vergleich/BonSpalte.svelte';
	import Vollbild from '$lib/client/pruefen/Vollbild.svelte';
	import { dialog } from '$lib/client/dialog';
	import { unterschiede as unterschiedeVon, rueckfrageSatz } from '$lib/bons/vergleich';
	import { bildVersion } from '$lib/bons/anzeige';
	import type { VergleichBon } from '$lib/server/bons/vergleich';

	let { data } = $props();

	const NICHT_BERECHTIGT = 'Das darf nur, wer den Bon hochgeladen hat, oder der Verwalter.';

	/** Am Handy nur eine Spalte auf einmal; am Rechner beide (Umschalter dort ausgeblendet). */
	let ansicht = $state<'a' | 'b'>('a');
	let vollbild = $state<VergleichBon | null>(null);

	type Handlung = { art: 'behalten' | 'bild'; bleibt: VergleichBon; geht: VergleichBon };
	let rueckfrage = $state<Handlung | null>(null);
	let rueckfrageFehler = $state('');
	let busy = $state(false);

	const u = $derived(data.a && data.b ? unterschiedeVon(data.a, data.b) : new Set<never>());

	function fragen(h: Handlung) {
		rueckfrageFehler = '';
		rueckfrage = h;
	}

	function schliessen() {
		if (busy) return;
		rueckfrage = null;
		rueckfrageFehler = '';
	}

	/**
	 * „Diesen behalten": POST an den bleibenden mit `weg`. „Nur das Bild uebernehmen": POST an
	 * den bestaetigten (bleibt) mit `quelle` (geht). Ein Fehler steht in der Rueckfrage, sie
	 * bleibt offen; danach zur Pruefansicht des bleibenden Bons.
	 */
	async function ausfuehren() {
		if (!rueckfrage) return;
		const { art, bleibt, geht } = rueckfrage;
		busy = true;
		rueckfrageFehler = '';
		try {
			const r = await fetch(`/api/receipts/${bleibt.id}/${art === 'behalten' ? 'behalten' : 'bild-uebernehmen'}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				// Der gesehene Status geht mit: hat ein anderer Tab einen der beiden inzwischen
				// bestaetigt oder verworfen, lehnt der Server mit „hat sich gerade geaendert" ab.
				body: JSON.stringify({
					...(art === 'behalten' ? { weg: geht.id } : { quelle: geht.id }),
					erwartet: { [bleibt.id]: bleibt.status, [geht.id]: geht.status }
				})
			});
			if (!r.ok) {
				const rumpf = (await r.json().catch(() => null)) as { message?: string } | null;
				rueckfrageFehler = rumpf?.message ?? `Das hat nicht geklappt (${r.status}).`;
				return;
			}
			rueckfrage = null;
			await goto(`/receipts/${bleibt.id}`);
		} catch {
			rueckfrageFehler = 'Keine Verbindung. Bitte noch einmal versuchen.';
		} finally {
			busy = false;
		}
	}
</script>

{#snippet knoepfeVon(dieser: VergleichBon, anderer: VergleichBon)}
	{@const darfBehalten = anderer.darfVerwerfen}
	<button
		type="button"
		class="rounded-xl bg-tuerkis px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
		disabled={busy || data.gesperrt !== null || !darfBehalten}
		onclick={() => fragen({ art: 'behalten', bleibt: dieser, geht: anderer })}>Diesen behalten</button
	>
	{#if anderer.status === 'confirmed' && dieser.status !== 'confirmed'}
		<!-- Daten und Korrekturen des bestaetigten bleiben, nur das Foto von hier ersetzt sein Bild. -->
		<button
			type="button"
			class="rounded-xl border border-linie bg-papier px-4 py-2.5 text-sm font-bold disabled:opacity-50"
			disabled={busy || data.gesperrt !== null || !dieser.darfVerwerfen || !anderer.darfVerwerfen}
			onclick={() => fragen({ art: 'bild', bleibt: anderer, geht: dieser })}>Nur das Bild übernehmen</button
		>
		<p class="text-[12.5px] text-gedaempft">Der andere Bon behält seine Daten und bekommt dieses Foto.</p>
	{/if}
	{#if data.gesperrt === null && (!darfBehalten || (anderer.status === 'confirmed' && dieser.status !== 'confirmed' && !dieser.darfVerwerfen))}
		<p class="text-[12.5px] font-semibold text-gedaempft">{NICHT_BERECHTIGT}</p>
	{/if}
{/snippet}

<Seite
	titel="Bons vergleichen"
	untertitel="Welcher bleibt? Der andere kommt in den Papierkorb."
	haushalt={data.haushalt}
	nutzer={data.user?.displayName ?? null}
>
	{#if data.fehler || !data.a || !data.b}
		<div class="grid gap-3 rounded-2xl border border-linie bg-papier p-5">
			<p role="alert" class="font-semibold">{data.fehler ?? 'Bon nicht gefunden'}</p>
			<div class="flex flex-wrap gap-2">
				<a href="/receipts/{page.params.id}" class="rounded-xl border border-linie bg-papier px-4 py-2 text-sm font-bold">Zurück zum Bon</a>
				<a href="/receipts/{page.params.id}/vergleich" class="rounded-xl border border-linie bg-papier px-4 py-2 text-sm font-bold"
					>Anderen Bon wählen</a
				>
			</div>
		</div>
	{:else}
		{@const a = data.a}
		{@const b = data.b}
		{#if data.gesperrt}
			<p role="status" class="mb-3 rounded-xl border border-bernstein bg-bernstein-flaeche px-3.5 py-3 text-[13px] font-semibold text-bernstein">
				{data.gesperrt}
			</p>
		{/if}

		<div class="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-chip p-1 lg:hidden" role="tablist" aria-label="Welchen Bon zeigen">
			{#each [{ id: 'a', text: 'Bon 1' }, { id: 'b', text: 'Bon 2' }] as t (t.id)}
				<button
					type="button"
					role="tab"
					id="reiter-{t.id}"
					aria-selected={ansicht === t.id}
					aria-controls="spalte-{t.id}"
					class="rounded-lg px-3 py-2 text-sm font-bold"
					class:bg-papier={ansicht === t.id}
					class:text-gedaempft={ansicht !== t.id}
					onclick={() => (ansicht = t.id as 'a' | 'b')}>{t.text}</button
				>
			{/each}
		</div>

		<div class="grid gap-4 lg:grid-cols-2">
			<div id="spalte-a" role="tabpanel" aria-labelledby="reiter-a" class:hidden={ansicht !== 'a'} class="lg:block">
				<BonSpalte bon={a} titel="Bon 1" unterschiede={u} onbild={() => (vollbild = a)}>
					{#snippet knoepfe()}{@render knoepfeVon(a, b)}{/snippet}
				</BonSpalte>
			</div>
			<div id="spalte-b" role="tabpanel" aria-labelledby="reiter-b" class:hidden={ansicht !== 'b'} class="lg:block">
				<BonSpalte bon={b} titel="Bon 2" unterschiede={u} onbild={() => (vollbild = b)}>
					{#snippet knoepfe()}{@render knoepfeVon(b, a)}{/snippet}
				</BonSpalte>
			</div>
		</div>
	{/if}
</Seite>

{#if rueckfrage}
	<div
		class="fixed inset-0 z-50 grid place-items-center bg-tinte/40 px-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="rueckfrage-titel"
		use:dialog={{ onschliessen: schliessen, gesperrt: busy }}
	>
		<div class="grid w-full max-w-sm gap-3 rounded-2xl bg-papier p-5 text-[14px]">
			<b id="rueckfrage-titel" class="text-[16px] font-extrabold">
				{rueckfrage.art === 'behalten' ? 'Diesen Bon behalten?' : 'Nur das Bild übernehmen?'}
			</b>
			<p class="text-gedaempft">
				{#if rueckfrage.art === 'bild'}Der bestätigte Bon behält seine Daten und bekommt das neue Foto.{/if}
				{rueckfrageSatz(rueckfrage.geht, rueckfrage.geht.id === data.a?.id ? 1 : 2)}
			</p>
			{#if rueckfrageFehler}<p role="alert" class="text-sm font-semibold text-rot-dunkel">{rueckfrageFehler}</p>{/if}
			<div class="flex flex-wrap justify-end gap-2">
				<button
					type="button"
					class="rounded-xl border border-linie bg-papier px-4 py-2 text-sm font-bold disabled:opacity-60"
					data-autofocus
					disabled={busy}
					onclick={schliessen}>Abbrechen</button
				>
				<button
					type="button"
					class="rounded-xl bg-tuerkis px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60"
					disabled={busy}
					onclick={ausfuehren}
					>{busy ? 'Einen Moment …' : rueckfrage.art === 'behalten' ? 'Behalten' : 'Bild übernehmen'}</button
				>
			</div>
		</div>
	</div>
{/if}

{#if vollbild}
	<Vollbild
		bonId={vollbild.id}
		bildVersion={bildVersion(vollbild.imagePath)}
		zeilen={null}
		gewaehlt={null}
		onwaehlen={() => {}}
		onschliessen={() => (vollbild = null)}
	/>
{/if}
