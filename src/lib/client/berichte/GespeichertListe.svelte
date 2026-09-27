<!-- src/lib/client/berichte/GespeichertListe.svelte -->
<script lang="ts">
	/** Die gespeicherten Berichte des Haushalts — Inhalt fuer „Gespeicherte Berichte ▾" (Rechner) und „Mehr" (Handy). */
	type Eintrag = { id: string; name: string; erstellerName: string | null; darfAendern: boolean };
	let { gespeicherte, aktivId, adresse }: { gespeicherte: Eintrag[]; aktivId: string | null; adresse: string } = $props();
	const feld = 'min-w-0 rounded-lg border border-linie px-2 py-1.5 font-normal';
</script>

{#if gespeicherte.length === 0}
	<p class="text-[13px] text-gedaempft">Noch keiner. Setze Filter und wähle „Speichern unter …".</p>
{:else}
	<ul class="grid gap-1 text-[13px]">
		{#each gespeicherte as b (b.id)}
			<li class="rounded-xl px-2 py-1.5 hover:bg-chip" class:bg-chip={aktivId === b.id}>
				<a href="/reports?bericht={b.id}" class="block py-1 font-bold" aria-current={aktivId === b.id ? 'page' : undefined}>{b.name}</a>
				<span class="text-[11.5px] text-gedaempft">
					{aktivId === b.id ? 'geöffnet · ' : ''}{b.erstellerName ? `von ${b.erstellerName}` : 'angelegt von jemandem, der nicht mehr im Haushalt ist'}
				</span>
				{#if b.darfAendern}
					<details class="mt-1 text-[12px]">
						<summary class="flex min-h-11 cursor-pointer items-center font-semibold text-tuerkis-dunkel">Umbenennen oder löschen</summary>
						<form method="POST" action="?/umbenennen" class="mt-1.5 flex gap-2">
							<input type="hidden" name="id" value={b.id} />
							<input type="hidden" name="adresse" value={adresse} />
							{#if aktivId}<input type="hidden" name="aktiv" value={aktivId} />{/if}
							<input name="name" value={b.name} maxlength="60" required aria-label="Neuer Name" class="{feld} flex-1" />
							<button class="rounded-full border border-linie px-3 py-1 font-bold">OK</button>
						</form>
						<form method="POST" action="?/loeschen" class="mt-1.5">
							<input type="hidden" name="id" value={b.id} />
							<input type="hidden" name="adresse" value={adresse} />
							{#if aktivId}<input type="hidden" name="aktiv" value={aktivId} />{/if}
							<button class="py-1 font-bold text-rot-dunkel">Löschen</button>
						</form>
					</details>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
