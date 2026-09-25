<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Reiter from './Reiter.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const datum = (d: Date | string) =>
		new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
</script>

<Seite titel="Betrieb" untertitel="{data.haushalte.length} Haushalte · {data.nutzer.length} Konten">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4">
		<Reiter aktiv="uebersicht" />

		<!--
			Der Satz steht bewusst ganz oben und nicht im Kleingedruckten: wer diese Seite
			oeffnet, soll als Erstes wissen, was sie NICHT kann. Sonst sucht er hier nach
			einem Weg in einen Haushalt und haelt dessen Fehlen fuer eine Luecke.
		-->
		<p class="rounded-xl bg-chip px-4 py-3 text-[12.5px] font-semibold leading-relaxed text-gedaempft">
			Diese Seite verwaltet die Instanz — sie zeigt keine Bons, Beträge oder Budgets, auch
			keine geteilten. Von hier führt kein Weg in einen Haushalt hinein. Wer in einen
			möchte, löst eine Einladung ein und steht danach in dessen Mitgliederliste.
		</p>

		{#if form?.grund}
			<p class="rounded-xl bg-papier px-4 py-3 text-[13px] font-bold text-tinte" role="alert">{form.grund}</p>
		{/if}

		{#if form?.link}
			<div class="rounded-xl border border-linie bg-papier px-4 py-3">
				<p class="text-[13px] font-bold">Haushalt „{form.name}" angelegt.</p>
				<p class="mt-1 text-[12px] font-semibold text-leise">
					Dieser Link wird <b>einmal</b> gezeigt — gespeichert ist nur sein Hash. Wer ihn einlöst,
					wird erster Verwalter. Gültig bis {datum(form.laeuftAbAm)}.
				</p>
				<code class="mt-2 block break-all rounded-lg bg-chip px-3 py-2 text-[12px]">{form.link}</code>
			</div>
		{/if}

		<section class="rounded-xl border border-linie bg-papier p-4">
			<h2 class="text-sm font-extrabold">Haushalte</h2>
			<ul class="mt-2 flex flex-col gap-2">
				{#each data.haushalte as h (h.id)}
					<li class="flex items-center justify-between gap-3 border-t border-linie pt-2 first:border-0 first:pt-0">
						<span class="min-w-0">
							<span class="block truncate text-[13px] font-bold">{h.name}</span>
							<span class="block text-[11.5px] font-semibold text-leise">
								{h.mitglieder} Mitglied(er) · {h.bons} Bons · seit {datum(h.angelegtAm)}
							</span>
						</span>
						{#if h.mitglieder === 0 && h.bons === 0}
							<form method="POST" action="?/haushaltLoeschen" use:enhance>
								<input type="hidden" name="householdId" value={h.id} />
								<button class="shrink-0 rounded-lg border border-linie px-2.5 py-1.5 text-[12px] font-bold">
									Löschen
								</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>

			<form method="POST" action="?/haushaltAnlegen" use:enhance class="mt-4 flex gap-2">
				<input
					name="name"
					placeholder="Name des neuen Haushalts"
					class="min-w-0 flex-1 rounded-xl border border-linie bg-flaeche px-3 py-2 text-sm font-semibold"
				/>
				<button class="rounded-xl bg-tuerkis px-4 py-2 text-sm font-extrabold text-white">Anlegen</button>
			</form>
			<p class="mt-1.5 text-[11.5px] font-semibold text-leise">
				Legt einen leeren Haushalt an und erzeugt eine Einladung dafür. Du trittst ihm nicht bei.
			</p>
		</section>

		<section class="rounded-xl border border-linie bg-papier p-4">
			<h2 class="text-sm font-extrabold">Konten</h2>
			<ul class="mt-2 flex flex-col gap-2">
				{#each data.nutzer as n (n.id)}
					<li class="flex items-center justify-between gap-3 border-t border-linie pt-2 first:border-0 first:pt-0">
						<span class="min-w-0">
							<span class="block truncate text-[13px] font-bold">
								{n.displayName}{#if n.gesperrtAm}<span class="ml-1.5 text-[11px] font-extrabold text-gedaempft">gesperrt</span>{/if}
							</span>
							<span class="block truncate text-[11.5px] font-semibold text-leise">
								{n.email} · {n.haushalt ?? 'kein Haushalt'}
							</span>
						</span>
						{#if n.id !== data.ichSelbst}
							<form method="POST" action="?/sperren" use:enhance>
								<input type="hidden" name="userId" value={n.id} />
								<input type="hidden" name="an" value={n.gesperrtAm ? 'nein' : 'ja'} />
								<button class="shrink-0 rounded-lg border border-linie px-2.5 py-1.5 text-[12px] font-bold">
									{n.gesperrtAm ? 'Entsperren' : 'Sperren'}
								</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-[11.5px] font-semibold text-leise">
				Sperren nimmt den Zugang, nicht die Daten: Bons, Mitgliedschaften und Berichte bleiben
				unverändert. Zurücknehmbar.
			</p>
		</section>

		<section class="rounded-xl border border-linie bg-papier p-4">
			<h2 class="text-sm font-extrabold">Zugang</h2>
			<form method="POST" action="?/selbstbedienung" use:enhance class="mt-2 flex items-start gap-2.5">
				<input type="hidden" name="an" value={data.selbstbedienung ? 'nein' : 'ja'} />
				<button class="shrink-0 rounded-lg border border-linie px-2.5 py-1.5 text-[12px] font-bold">
					{data.selbstbedienung ? 'Abschalten' : 'Einschalten'}
				</button>
				<span class="min-w-0 text-[12.5px] font-semibold leading-relaxed text-gedaempft">
					{#if data.selbstbedienung}
						Wer sich anmelden kann, bekommt einen eigenen Haushalt. Zum Abschalten, wenn nur
						Eingeladene hereinsollen.
					{:else}
						Eine Erstanmeldung braucht eine Einladung. Wer schon ein Konto hat, kommt weiterhin
						herein.
					{/if}
				</span>
			</form>
			{#if data.einladungen > 0}
				<p class="mt-2 text-[11.5px] font-semibold text-leise">
					{data.einladungen} offene Einladung(en) insgesamt.
				</p>
			{/if}
		</section>
	</div>
</Seite>
