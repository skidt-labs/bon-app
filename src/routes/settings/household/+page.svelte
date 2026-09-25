<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Einstellungsleiste from '$lib/client/geruest/Einstellungsleiste.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const ROLLEN_TEXT: Record<string, string> = { verwalter: 'Verwalter', mitglied: 'Mitglied' };

	const FEHLER_TEXT: Record<string, string> = {
		'letzter-verwalter': 'Der letzte Verwalter kann weder herabgestuft noch entfernt werden.',
		'unbekanntes-mitglied': 'Das gibt es in dieser Liste nicht mehr — bitte die Seite neu laden.'
	};

	/**
	 * Nennt beim Namen, was verloren geht.
	 *
	 * Der Text sagte vorher nur, dass die geteilten Bons bleiben — richtig, und die
	 * eigentliche Folge verschwiegen: private Bons samt Fotos und private Toepfe werden
	 * unwiderruflich geloescht, auch bei einem spaeteren erneuten Beitritt. Wer eine
	 * Zugriffsverwaltung erwartet und einen Datenverlust bekommt, wurde nicht gefragt,
	 * sondern ueberrumpelt (Befund R21).
	 */
	function bestaetigeEntfernen(name: string, userId: string): boolean {
		const v = data.vorschau?.[userId];
		const teile = [`${name} aus dem Haushalt entfernen?`, ''];
		if (v && (v.privateBons > 0 || v.privateToepfe > 0)) {
			const was = [
				v.privateBons > 0 ? `${v.privateBons} private ${v.privateBons === 1 ? 'Bon' : 'Bons'} samt Fotos` : null,
				v.privateToepfe > 0 ? `${v.privateToepfe} private ${v.privateToepfe === 1 ? 'Budget' : 'Budgets'}` : null
			].filter(Boolean).join(' und ');
			teile.push(`Dabei ${was} werden GELÖSCHT. Das lässt sich nicht rückgängig machen —`);
			teile.push('auch nicht durch einen erneuten Beitritt.');
		} else {
			teile.push('Diese Person hat nichts Privates in diesem Haushalt.');
		}
		teile.push('', 'Die geteilten Bons bleiben erhalten.');
		return confirm(teile.join('\n'));
	}
</script>

<Seite
	titel={data.household?.name ?? 'Haushalt'}
	untertitel="{data.members.length} Mitglied(er)"
	haushalt={data.haushalt}
	nutzer={data.user?.displayName ?? null}
>
	<Einstellungsleiste aktiv="haushalt" />

	<ul class="divide-y rounded border">
		{#each data.members as m}
			<li class="flex items-center justify-between gap-2 p-3">
				<span class="min-w-0">
					<span class="block truncate">{m.displayName}</span>
					<span class="block truncate text-xs text-gray-500">{m.email}</span>
					<span class="mt-0.5 block text-xs text-gray-500">{ROLLEN_TEXT[m.rolle] ?? m.rolle}</span>
				</span>
				<span class="flex shrink-0 items-center gap-2">
					<span class="text-sm tabular-nums">{m.erfasst} Bons</span>
					{#if data.darfVerwalten}
						<form method="POST" action="?/rolle" use:enhance class="contents">
							<input type="hidden" name="zielUserId" value={m.id} />
							<select
								name="rolle"
								value={m.rolle}
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
								class="rounded border px-1 py-1 text-xs"
							>
								<option value="mitglied">Mitglied</option>
								<option value="verwalter">Verwalter</option>
							</select>
						</form>
						<form
							method="POST"
							action="?/entfernen"
							use:enhance={({ cancel }) => {
								if (!bestaetigeEntfernen(m.displayName, m.id)) cancel();
							}}
						>
							<input type="hidden" name="zielUserId" value={m.id} />
							<button class="rounded border px-2 py-1 text-xs text-red-700">Entfernen</button>
						</form>
					{/if}
				</span>
			</li>
		{/each}
	</ul>

	{#if form && 'grund' in form && form.grund}
		<p class="mt-3 text-sm text-red-700">{FEHLER_TEXT[form.grund] ?? form.grund}</p>
	{/if}

	{#if data.darfVerwalten}
		<section class="mt-6 rounded border p-3">
			<h2 class="mb-2 text-sm font-medium">Einladen</h2>
			<form method="POST" action="?/einladen" use:enhance class="flex items-center gap-2">
				<select name="rolle" class="rounded border px-2 py-1 text-sm">
					<option value="mitglied">als Mitglied</option>
					<option value="verwalter">als Verwalter</option>
				</select>
				<button class="rounded bg-black px-3 py-1.5 text-sm text-white">Link erzeugen</button>
			</form>

			{#if form && 'link' in form && form.link}
				<div class="mt-3 rounded border-2 border-black p-3">
					<p class="text-xs text-gray-500">
						Dieser Link wird jetzt <strong>einmalig</strong> angezeigt und ist danach nicht mehr
						rekonstruierbar — jetzt kopieren und weitergeben.
					</p>
					<input
						readonly
						value={form.link}
						class="mt-2 w-full rounded border bg-gray-50 px-2 py-1.5 font-mono text-xs"
						onclick={(e) => e.currentTarget.select()}
					/>
					<p class="mt-2 text-xs text-gray-500">
						gültig bis {new Date(form.laeuftAbAm).toLocaleString('de-DE')}
					</p>
				</div>
			{/if}
		</section>
	{/if}

	<p class="mt-4 text-xs text-gray-500">
		Wer die App überhaupt öffnen darf, steht in Authentik in der Gruppe „Bon-App" —
		nicht hier. Neue Haushaltsmitglieder treten über einen Einladungslink bei.
	</p>

	<!-- Diese Seite ist faktisch die Einstellungs-Startseite: das Nutzerkürzel im
	     Kopf führt hierher. Damit ist es die Stelle, an der jemand nachsieht, welcher
	     Stand läuft — ohne dass die Nummer auf jeder anderen Seite mitläuft. -->
	<p class="mt-6 border-t pt-3 text-xs text-gray-400">Bon-App {data.version}</p>
</Seite>
