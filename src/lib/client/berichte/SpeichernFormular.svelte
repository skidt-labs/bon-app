<!-- src/lib/client/berichte/SpeichernFormular.svelte -->
<script lang="ts">
	/** „Speichern unter …" — Inhalt fuer das eigene Menue (Rechner) und fuer „Mehr" (Handy). */
	let { adresse }: { adresse: string } = $props();
	const feld = 'min-w-0 rounded-lg border border-linie px-2 py-2 font-normal';
</script>

<form method="POST" action="?/speichern" class="grid gap-2 text-[13px]">
	<input type="hidden" name="adresse" value={adresse} />
	<label class="grid gap-1 font-bold">Name<input name="name" required maxlength="60" placeholder="Name des Berichts" class={feld} /></label>
	<label class="flex min-h-8 items-center gap-2"><input type="checkbox" name="mitZeitraum" value="ja" /> Zeitraum mitspeichern</label>
	<p class="text-[11.5px] text-gedaempft">
		Ohne Zeitraum öffnet der Bericht immer den laufenden Monat. Sichtbar für alle im Haushalt — jeder sieht darin nur,
		was er sehen darf.
	</p>
	<button class="justify-self-start rounded-full bg-tinte px-4 py-2 font-bold text-white">Speichern</button>
</form>
