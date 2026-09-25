<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Reiter from '../Reiter.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// Welche Karte gerade im Bearbeiten-Modus ist; 'neu' = das Anlegen-Formular.
	let offen = $state<string | null>(null);

	const aktiver = $derived(data.anbieter.find((a) => a.aktiv) ?? null);
	const wegText = (w: 'text' | 'bild' | null) => (w === 'bild' ? 'Bildweg (Foto geht hinaus)' : w === 'text' ? 'Textweg (OCR lokal)' : '—');
	const preis = (p: number | null) => (p === null ? 'unbekannt' : `${(p / 1_000_000).toLocaleString('de-DE')} €/Mio.`);
	const zeit = (d: Date | string | null) =>
		d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'nie';
	const modelleFuer = (id: string) => (form && 'modelle' in form && form.fuer === id ? form.modelle : []);
</script>

{#snippet formular(a: (typeof data.anbieter)[number] | null)}
	{@const id = a?.id ?? 'neu'}
	<form
		method="POST"
		action={a ? '?/aendern' : '?/anlegen'}
		use:enhance={() => async ({ update }) => update({ reset: false })}
		class="mt-3 grid gap-2 text-[13px]"
	>
		{#if a}<input type="hidden" name="id" value={a.id} />{/if}
		<label class="grid gap-1 font-semibold">Name
			<input name="name" required value={a?.name ?? ''} class="rounded-lg border border-linie px-2 py-1.5" />
		</label>
		<label class="grid gap-1 font-semibold">Weg
			<select name="weg" class="rounded-lg border border-linie px-2 py-1.5">
				<option value="text" selected={a?.weg !== 'bild'}>Textweg — PaddleOCR liest lokal, nur Text geht hinaus</option>
				<option value="bild" selected={a?.weg === 'bild'} disabled={!data.bildwegFrei && a?.weg !== 'bild'}>
					Bildweg — das Foto geht hinaus{data.bildwegFrei ? '' : ' (in der .env gesperrt)'}
				</option>
			</select>
		</label>
		<label class="grid gap-1 font-semibold">Basis-URL
			<input name="baseUrl" required placeholder="https://…/v1" value={a?.baseUrl ?? ''} class="rounded-lg border border-linie px-2 py-1.5" />
		</label>
		<label class="grid gap-1 font-semibold">Modell
			<input name="modell" required list="modelle-{id}" value={a?.modell ?? ''} class="rounded-lg border border-linie px-2 py-1.5" />
			<datalist id="modelle-{id}">
				{#each modelleFuer(id) as m (m)}<option value={m}></option>{/each}
			</datalist>
		</label>
		<button formaction="?/modelle" formnovalidate class="justify-self-start rounded-lg bg-chip px-3 py-1 text-[12px] font-bold">
			Modelle abrufen
		</button>
		<label class="grid gap-1 font-semibold">API-Schlüssel
			<input
				name="schluessel"
				type="password"
				autocomplete="off"
				placeholder={a?.hatSchluessel ? `••••${a.schluesselEnde ?? ''} — leer lassen, um ihn zu behalten` : 'leer, wenn keiner nötig ist'}
				disabled={!data.geheimnisDa}
				class="rounded-lg border border-linie px-2 py-1.5"
			/>
			{#if !data.geheimnisDa}
				<span class="text-[12px] text-gedaempft">SECRETS_KEY fehlt in der .env — Schlüssel lassen sich erst danach speichern.</span>
			{/if}
		</label>
		{#if a?.hatSchluessel}
			<label class="flex items-center gap-2 font-semibold"><input type="checkbox" name="schluesselEntfernen" value="ja" /> Schlüssel entfernen</label>
		{/if}
		<div class="grid grid-cols-3 gap-2">
			<label class="grid gap-1 font-semibold">Zeitlimit (s)
				<input name="zeitlimitS" type="number" min="1" required value={a ? a.zeitlimitMs / 1000 : 60} class="rounded-lg border border-linie px-2 py-1.5" />
			</label>
			<label class="grid gap-1 font-semibold">Preis ein
				<input name="preisEin" inputmode="numeric" placeholder="µ€/Mio." value={a?.preisEinMicro ?? ''} class="rounded-lg border border-linie px-2 py-1.5" />
			</label>
			<label class="grid gap-1 font-semibold">Preis aus
				<input name="preisAus" inputmode="numeric" placeholder="µ€/Mio." value={a?.preisAusMicro ?? ''} class="rounded-lg border border-linie px-2 py-1.5" />
			</label>
		</div>
		<p class="text-[12px] text-gedaempft">Preise in Millionstel Euro je Million Tokens. Leer = unbekannt, 0 = kostenlos.</p>
		<div class="flex gap-2">
			<button class="rounded-lg bg-tinte px-3 py-1.5 text-[13px] font-bold text-papier">Speichern</button>
			<button type="button" onclick={() => (offen = null)} class="rounded-lg bg-chip px-3 py-1.5 text-[13px] font-bold">Abbrechen</button>
		</div>
	</form>
{/snippet}

<Seite titel="Betrieb" untertitel="KI-Anbieter">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4">
		<Reiter aktiv="ki" />

		{#if form && 'grund' in form && form.grund}
			<p class="rounded-xl bg-papier px-4 py-3 text-[13px] font-bold text-tinte" role="alert">{form.grund}</p>
		{/if}

		<section class="rounded-xl border border-linie bg-papier p-4 text-[13px]">
			<h2 class="text-sm font-extrabold">Aktiv</h2>
			{#if aktiver}
				<p class="mt-1 font-bold">{aktiver.name} · {wegText(aktiver.weg)} · {aktiver.modell}</p>
				<p class="text-gedaempft">aus der Oberfläche</p>
				{#if aktiver.testOk === null}
					<p class="mt-1 font-bold text-tinte">aktiv – seit der Änderung nicht getestet</p>
				{:else if aktiver.testOk === false}
					<p class="mt-1 font-bold text-tinte">aktiv – letzter Test fehlgeschlagen</p>
				{/if}
				<form method="POST" action="?/zurueck" use:enhance class="mt-2 flex flex-wrap items-center gap-2">
					<button disabled={data.zurueckGesperrt !== null} class="rounded-lg bg-chip px-3 py-1 text-[12px] font-bold disabled:opacity-40">Zurück auf .env</button>
					{#if data.zurueckGesperrt}<span class="text-[12px] text-gedaempft">{data.zurueckGesperrt}</span>{/if}
				</form>
			{:else if data.env.fehler}
				<p class="mt-1 font-bold">Kein Anbieter aktiv, und die .env ist unvollständig: {data.env.fehler}</p>
			{:else}
				<p class="mt-1 font-bold">{wegText(data.env.weg)} · {data.env.modell}</p>
				<p class="text-gedaempft">aus .env (Vorgabe)</p>
			{/if}
			<p class="mt-3 text-gedaempft">
				OCR: {data.ocr.fehler ?? `${data.ocr.engine}${data.ocr.engine === 'paddleocr' ? ` (${data.ocr.paddleUrl})` : ''}`} — steht in der .env.
			</p>
			<p class="text-gedaempft">Bildweg: {data.bildwegFrei ? 'in der .env freigegeben' : 'gesperrt'}.</p>
		</section>

		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-extrabold">Anbieter</h2>
				<button onclick={() => (offen = 'neu')} class="rounded-lg bg-tinte px-3 py-1.5 text-[13px] font-bold text-papier">Anbieter anlegen</button>
			</div>

			{#if offen === 'neu'}
				<div class="rounded-xl border border-linie bg-papier p-4">{@render formular(null)}</div>
			{/if}

			{#each data.anbieter as a (a.id)}
				<article class="rounded-xl border border-linie bg-papier p-4 text-[13px]">
					<div class="flex items-baseline justify-between gap-2">
						<h3 class="font-extrabold">{a.name}{#if a.aktiv}<span class="ml-2 rounded bg-chip px-1.5 py-0.5 text-[11px]">aktiv</span>{/if}</h3>
						<span class="text-gedaempft">{wegText(a.weg)}</span>
					</div>
					<p class="mt-1">{a.modell} · <span class="text-gedaempft">{a.baseUrl}</span></p>
					<p class="text-gedaempft">
						Schlüssel: {a.hatSchluessel ? `••••${a.schluesselEnde ?? ''}` : 'keiner'}
						{#if a.schluesselLesbar === false}<b class="text-tinte"> — nicht lesbar, bitte neu eingeben</b>{/if}
						· Zeitlimit {a.zeitlimitMs / 1000} s · ein {preis(a.preisEinMicro)} · aus {preis(a.preisAusMicro)}
					</p>
					<p class="mt-1">
						Letzter Test ({zeit(a.zuletztGetestet)}):
						<b>{a.testOk === true ? 'bestanden' : a.testOk === false ? 'fehlgeschlagen' : 'keiner seit der letzten Änderung'}</b>
						{#if a.testErgebnis}<span class="text-gedaempft"> — {a.testErgebnis}</span>{/if}
					</p>
					<div class="mt-2 flex flex-wrap gap-2">
						<form method="POST" action="?/testen" use:enhance>
							<input type="hidden" name="id" value={a.id} />
							<button class="rounded-lg bg-chip px-3 py-1 text-[12px] font-bold">Testen</button>
						</form>
						<button onclick={() => (offen = a.id)} class="rounded-lg bg-chip px-3 py-1 text-[12px] font-bold">Bearbeiten</button>
						{#if !a.aktiv}
							<form method="POST" action="?/aktivieren" use:enhance>
								<input type="hidden" name="id" value={a.id} />
								<button disabled={a.testOk !== true} class="rounded-lg bg-tinte px-3 py-1 text-[12px] font-bold text-papier disabled:opacity-40">Aktivieren</button>
							</form>
							<form method="POST" action="?/loeschen" use:enhance>
								<input type="hidden" name="id" value={a.id} />
								<button class="rounded-lg bg-chip px-3 py-1 text-[12px] font-bold">Löschen</button>
							</form>
						{/if}
					</div>
					{#if offen === a.id}{@render formular(a)}{/if}
				</article>
			{:else}
				<p class="text-[13px] text-gedaempft">Noch kein Anbieter angelegt — es gilt die .env.</p>
			{/each}
		</section>
	</div>
</Seite>
