<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Einstellungsleiste from '$lib/client/geruest/Einstellungsleiste.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	/** „vor 12 Sekunden" statt eines rohen Zeitstempels — ein Datum, das niemand im Kopf
	    einordnet, beantwortet die eigentliche Frage nicht: läuft der Bot noch? */
	function seit(wann: Date | null): string {
		if (!wann) return 'noch nie gelaufen';
		const sek = Math.max(0, Math.round((Date.now() - new Date(wann).getTime()) / 1000));
		if (sek < 60) return `vor ${sek} Sekunde(n)`;
		if (sek < 3600) return `vor ${Math.round(sek / 60)} Minute(n)`;
		if (sek < 86400) return `vor ${Math.round(sek / 3600)} Stunde(n)`;
		return `vor ${Math.round(sek / 86400)} Tag(en)`;
	}

	const botStill = $derived(
		data.botZuletztGesehen === null ||
			Date.now() - new Date(data.botZuletztGesehen).getTime() > 10 * 60 * 1000
	);
</script>

<Seite titel="Matrix-Bot" haushalt={data.haushalt} nutzer={data.user?.displayName ?? null}>
	<Einstellungsleiste aktiv="matrix" />
	<p class="mb-4 text-sm text-gray-500">
		Schick einem Bot im Chat ein Bonfoto, statt die App zu öffnen.
	</p>

	<section class="rounded border p-3">
		<h2 class="mb-2 text-sm font-medium">Dein Matrix-Konto</h2>
		{#if data.verknuepfung}
			<p class="font-mono text-sm">{data.verknuepfung.matrixUserId}</p>
			<p class="mt-1 text-xs text-gray-500">
				verknüpft seit {new Date(data.verknuepfung.createdAt).toLocaleDateString('de-DE')}
			</p>
			<form method="POST" action="?/loesen" use:enhance class="mt-3">
				<button class="rounded border px-3 py-2 text-sm">Verknüpfung lösen</button>
			</form>
			<p class="mt-2 text-xs text-gray-500">
				Bereits erfasste Bons bleiben erhalten — nur der Weg wird geschlossen.
			</p>
			<p class="mt-3 border-t pt-3 text-xs text-gray-600">
				{#if data.botAdresse}
					Bonfotos schickst du an <span class="font-mono">{data.botAdresse}</span>.
				{:else}
					Bonfotos schickst du im Direktchat an den Bon-Bot.
				{/if}
			</p>
			<!-- M2 (Korrekturrunde 2): E6 ist nicht vollstaendig erfuellt. redactEvent
			     entfernt das Foto aus dem Chatverlauf, aber nicht aus Synapses eigenem
			     Medienspeicher (dafuer braeuchte es die Synapse-Admin-API und ein
			     Admin-Token, eine Rechteausweitung, die der Betreiber entscheidet, nicht
			     dieser Fix). Sichtbarer Hinweis statt stiller Luecke. -->
			<p class="mt-2 text-xs text-gray-500">
				Das Foto verschwindet danach aus dem Chat, bleibt aber (verschlüsselt) im
				Medienspeicher des Homeservers liegen.
			</p>
		{:else}
			<p class="text-sm text-gray-600">Noch nicht verknüpft.</p>
			<form method="POST" action="?/code" use:enhance class="mt-3">
				<button class="rounded bg-black px-4 py-2 text-sm text-white">
					Kopplungscode erzeugen
				</button>
			</form>
		{/if}
	</section>

	{#if form?.code}
		<section class="mt-4 rounded border-2 border-black p-4 text-center">
			<p class="text-xs text-gray-500">Schick diesen Code an</p>
			<p class="font-mono text-sm">{data.botAdresse ?? 'den Bon-Bot'}</p>
			<p class="my-3 font-mono text-3xl font-bold tracking-[0.3em]">{form.code}</p>
			<p class="text-xs text-gray-500">
				gültig bis {new Date(form.expiresAt).toLocaleTimeString('de-DE', {
					hour: '2-digit',
					minute: '2-digit'
				})} — danach brauchst du einen neuen
			</p>
		</section>
	{/if}

	{#if form?.geloest}
		<p class="mt-4 text-sm text-green-700">Verknüpfung gelöst.</p>
	{/if}

	<section class="mt-6 rounded border p-3">
		<h2 class="mb-1 text-sm font-medium">Bot</h2>
		<p class="text-sm" class:text-red-700={botStill}>
			zuletzt gesehen: {seit(data.botZuletztGesehen)}
		</p>
		{#if botStill}
			<p class="mt-1 text-xs text-red-700">
				Der Bot meldet sich nicht. Bons, die du ihm jetzt schickst, werden nicht
				verarbeitet — nimm sie solange über die App auf.
			</p>
		{/if}
	</section>

	<a href="/settings/household" class="mt-6 block text-center text-sm underline">Haushalt</a>
</Seite>
