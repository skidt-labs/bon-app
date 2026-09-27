<script lang="ts">
	import { filterAlsAdresse, hatFilter, type BerichtFilter } from '$lib/berichte/filter';

	type Eintrag = { id: string; name: string; erstellerName: string | null; darfAendern: boolean };
	type Aktiv = { id: string; name: string; darfAendern: boolean; geaendert: boolean };
	let {
		gespeicherte,
		aktiv,
		filter,
		fehler = null
	}: { gespeicherte: Eintrag[]; aktiv: Aktiv | null; filter: BerichtFilter; fehler?: string | null } = $props();

	const adresse = $derived(filterAlsAdresse(filter));
	const knopf = 'cursor-pointer list-none rounded-full border border-linie bg-papier px-3 py-1.5 whitespace-nowrap [&::-webkit-details-marker]:hidden';
	const feld = 'min-w-0 rounded-lg border border-linie px-2 py-1.5 font-normal';
	const blatt = 'absolute left-0 z-30 mt-2 w-[320px] max-w-[calc(100vw-32px)] rounded-2xl bg-papier p-3 font-normal shadow-[0_8px_30px_rgba(17,26,59,0.18)]';
</script>

<div class="mb-3 flex flex-wrap items-center gap-2 text-[13px] font-bold">
	<details class="relative">
		<summary class={knopf}>Gespeicherte Berichte ▾</summary>
		<div class={blatt}>
			{#if gespeicherte.length === 0}
				<p class="text-gedaempft">Noch keiner. Setze Filter und wähle „Speichern unter …".</p>
			{:else}
				<ul class="grid gap-1">
					{#each gespeicherte as b (b.id)}
						<li class="rounded-xl px-2 py-1.5 hover:bg-chip">
							<a href="/reports?bericht={b.id}" class="block font-bold" aria-current={aktiv?.id === b.id ? 'page' : undefined}>{b.name}</a>
							<span class="text-[11.5px] text-gedaempft">{b.erstellerName ? `von ${b.erstellerName}` : 'angelegt von jemandem, der nicht mehr im Haushalt ist'}</span>
							{#if b.darfAendern}
								<details class="mt-1 text-[12px]">
									<summary class="cursor-pointer font-semibold text-tuerkis-dunkel">Umbenennen oder löschen</summary>
									<form method="POST" action="?/umbenennen" class="mt-1.5 flex gap-2">
										<input type="hidden" name="id" value={b.id} />
										<input type="hidden" name="adresse" value={adresse} />
										{#if aktiv}<input type="hidden" name="aktiv" value={aktiv.id} />{/if}
										<input name="name" value={b.name} maxlength="60" required aria-label="Neuer Name" class="{feld} flex-1" />
										<button class="rounded-full border border-linie px-3 py-1 font-bold">OK</button>
									</form>
									<form method="POST" action="?/loeschen" class="mt-1.5">
										<input type="hidden" name="id" value={b.id} />
										<input type="hidden" name="adresse" value={adresse} />
										{#if aktiv}<input type="hidden" name="aktiv" value={aktiv.id} />{/if}
										<button class="font-bold text-rot-dunkel">Löschen</button>
									</form>
								</details>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</details>

	{#if hatFilter(filter) || filter.umfang === 'meine'}
		<details class="relative">
			<summary class={knopf}>Speichern unter …</summary>
			<form method="POST" action="?/speichern" class="{blatt} grid gap-2">
				<input type="hidden" name="adresse" value={adresse} />
				<label class="grid gap-1 font-bold">Name<input name="name" required maxlength="60" class={feld} /></label>
				<label class="flex items-center gap-2"><input type="checkbox" name="mitZeitraum" value="ja" /> Zeitraum mitspeichern</label>
				<p class="text-[11.5px] text-gedaempft">
					Ohne Zeitraum öffnet der Bericht immer den laufenden Monat. Sichtbar für alle im Haushalt — jeder sieht darin
					nur, was er sehen darf.
				</p>
				<button class="justify-self-start rounded-full bg-tinte px-4 py-2 font-bold text-white">Speichern</button>
			</form>
		</details>
	{/if}

	{#if aktiv}
		<span class="rounded-full bg-chip px-3 py-1.5">Gespeichert: {aktiv.name}</span>
		{#if aktiv.darfAendern && aktiv.geaendert}
			<form method="POST" action="?/aendern">
				<input type="hidden" name="id" value={aktiv.id} />
				<input type="hidden" name="adresse" value={adresse} />
				<button class="rounded-full border border-linie bg-papier px-3 py-1.5">Änderungen speichern</button>
			</form>
		{/if}
	{/if}

	{#if fehler}
		<p class="w-full rounded-xl bg-rot-flaeche px-3.5 py-2.5 text-rot-dunkel">{fehler}</p>
	{/if}
</div>
