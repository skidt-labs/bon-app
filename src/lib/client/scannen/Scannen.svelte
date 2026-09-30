<script lang="ts">
	import BildBearbeiten from '$lib/client/bild/BildBearbeiten.svelte';
	import { enqueueUpload, flushOutbox, pendingCount, describeFlush, autoSyncMessage } from '$lib/client/outbox';
	import { onMount } from 'svelte';
	import Seite from '$lib/client/geruest/Seite.svelte';

	// Nutzer und Haushalt kommen aus dem Layout — diese Komponente zeigen zwei Adressen
	// (/scan und, am Handy, die Eingangstuer /), deshalb als Eigenschaft statt aus einem
	// eigenen Loader.
	let {
		data
	}: { data: { user: { id: string; displayName: string } | null; haushalt: string | null } } = $props();
	let file = $state<File | null>(null);
	let img = $state<HTMLImageElement | null>(null);
	let busy = $state(false);
	let message = $state('');
	/** Beim Mehrfach-Upload warten die restlichen Fotos hier und kommen nacheinander dran. */
	let pending = $state<File[]>([]);
	let source = $state<'camera' | 'upload'>('camera');
	/** Fotos, die in der IndexedDB-Outbox auf einen (erneuten) Sendeversuch warten. */
	let waiting = $state(0);

	// Beim Start der Seite (Reload, Return aus dem Hintergrund) und sobald der
	// Browser wieder online ist: alles versuchen loszuschicken, was noch in der
	// Outbox liegt. So verschwindet ein wartender Bon nicht einfach, weil der
	// Nutzer die Seite nie wieder von Hand öffnet - er geht raus, sobald es geht.
	onMount(() => {
		const sync = async () => {
			// Ohne Anmeldung gibt es niemanden, dem die wartenden Fotos gehoeren koennten
			// — dann wird gar nicht erst verschickt (Befund R01).
			if (!data.user) return;
			const result = await flushOutbox({ nutzerId: data.user.id });
			waiting = await pendingCount();
			// Befund R03: hier verschwand eine endgueltige Ablehnung bisher spurlos —
			// der automatische Abgleich wertete das Ergebnis gar nicht aus. Nur
			// melden, wenn wirklich etwas passiert ist, das der Nutzer sonst nicht
			// mitbekaeme (siehe autoSyncMessage-Kommentar in outbox.ts).
			const meldung = autoSyncMessage(result);
			if (meldung) message = meldung;
		};
		sync();
		window.addEventListener('online', sync);
		return () => window.removeEventListener('online', sync);
	});

	// Object-URL des aktuell angezeigten Bilds. Wird freigegeben, sobald das Bild
	// nicht mehr gebraucht wird (hochgeladen, verworfen oder durch das nächste aus
	// der Warteschlange ersetzt) - sonst hält jedes Foto einer Mehrfachauswahl seine
	// Blob-URL (und damit die dahinterliegenden Bilddaten) bis zum Reload offen.
	let objectUrl: string | null = null;

	function releaseImage() {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
	}

	/** Versucht ein Bild zu dekodieren. false, wenn der Browser es nicht kann
	    (z. B. rohes HEIC außerhalb von iOS/Safari). */
	async function tryLoad(picked: File): Promise<boolean> {
		const url = URL.createObjectURL(picked);
		const image = new Image();
		image.src = url;
		try {
			await image.decode();
		} catch {
			URL.revokeObjectURL(url);
			return false;
		}
		releaseImage();
		objectUrl = url;
		img = image;
		file = picked;
		return true;
	}

	async function loadForCrop(picked: File) {
		let current: File | undefined = picked;
		while (current && !(await tryLoad(current))) {
			message = 'Ein Foto konnte nicht gelesen werden (Format nicht unterstützt) - übersprungen.';
			const [next, ...rest] = pending;
			pending = rest;
			current = next;
		}
		if (!current) {
			releaseImage();
			file = null;
			img = null;
		}
	}

	async function pick(event: Event, from: 'camera' | 'upload') {
		const input = event.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (files.length === 0) return;
		source = from;
		pending = files.slice(1);
		message = '';
		await loadForCrop(files[0]);
		input.value = ''; // sonst feuert die Auswahl derselben Datei kein change-Event
	}

	/** Der fertige, entzerrte Bon kommt aus BildBearbeiten. */
	async function upload(blob: Blob) {
		if (!img) return;
		busy = true;
		message = '';
		try {

			// Erst in die Outbox (IndexedDB), dann erst versuchen zu senden: das
			// Foto ist ab hier gesichert, selbst wenn der Flush direkt scheitert
			// oder der Browser die Seite mitten im Upload entlädt. So verschwindet
			// nie ein aufgenommenes Foto, nur weil das Netz genau in diesem
			// Moment weg war (oberstes Prinzip der App, Task 14).
			if (!data.user) throw new Error('Nicht angemeldet');
			await enqueueUpload(blob, source, data.user.id);
			const result = await flushOutbox({ nutzerId: data.user.id });
			waiting = await pendingCount();
			file = null;
			img = null;

			if (pending.length > 0) {
				const [next, ...rest] = pending;
				pending = rest;
				message = `${describeFlush(result)} (noch ${rest.length + 1} aus dieser Auswahl)`;
				await loadForCrop(next);
			} else {
				releaseImage();
				message = describeFlush(result);
			}
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	function cancel() {
		releaseImage();
		img = null;
		file = null;
	}
</script>


{#if !data.user}
	<main class="mx-auto flex min-h-dvh max-w-md flex-col bg-flaeche font-sans text-tinte">
		<div class="flex flex-1 flex-col justify-center p-5">
			<a
				href="/auth/login"
				class="flex h-14 items-center justify-center rounded-2xl bg-marine px-4 text-center text-lg font-semibold text-white"
			>
				Anmelden
			</a>
		</div>
	</main>
{:else}
	<Seite
		titel="Scannen"
		untertitel="Kamera an der Kasse, Galerie für vorhandene Fotos"
		haushalt={data.haushalt}
		nutzer={data.user.displayName}
	>
	{#if !img}

		<!-- Die zwei Eingänge, gleichrangig und gross -->
		<div class="flex flex-col gap-3 pt-1">
			<label
				class="flex h-24 cursor-pointer items-center gap-4 rounded-2xl bg-marine px-5 text-white"
			>
				<svg
					width="30"
					height="30"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="shrink-0"
					aria-hidden="true"
					><path
						d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
					/><circle cx="12" cy="13" r="3.5" /></svg
				>
				<span class="flex flex-col gap-0.5">
					<span class="text-lg font-bold">Kamera</span>
					<span class="text-sm opacity-80">an der Kasse, direkt nach dem Zahlen</span>
				</span>
				<input
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					onchange={(e) => pick(e, 'camera')}
				/>
			</label>

			<!-- Zweiter, SEPARATER Einstieg. `capture` erzwingt die Kamera und blendet die
			     Galerie aus - beides in einem Feld geht nicht, es braucht zwei Inputs. -->
			<label
				class="flex h-24 cursor-pointer items-center gap-4 rounded-2xl border border-linie-hell bg-white px-5"
			>
				<svg
					width="30"
					height="30"
					viewBox="0 0 24 24"
					fill="none"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				 class="shrink-0 stroke-marine"
					aria-hidden="true"
					><rect x="3" y="3" width="18" height="18" rx="2.5" /><circle
						cx="8.5"
						cy="8.5"
						r="1.8"
					/><path d="m21 15-5-5L5 21" /></svg
				>
				<span class="flex flex-col gap-0.5">
					<span class="text-lg font-bold">Aus der Galerie</span>
					<span class="text-sm text-gedaempft">mehrere auf einmal, auch lange Bons</span>
				</span>
				<input
					type="file"
					accept="image/*"
					multiple
					class="hidden"
					onchange={(e) => pick(e, 'upload')}
				/>
			</label>
		</div>

	{:else}
		<!-- Seit 30.09.2026: Rand erkennen, echt entzerren, drehen (bild/BildBearbeiten.svelte).
		     Vorher schnitten die vier Punkte nur das umschliessende Rechteck aus. -->
		<div class="p-4">
			<BildBearbeiten
				bild={img}
				hauptText={busy ? 'Lädt hoch …' : 'Passt, hochladen'}
				beschaeftigt={busy}
				onfertig={upload}
				onabbrechen={cancel}
			/>
		</div>
	{/if}

	<!-- Ausserhalb des if/else oben, damit ein wartender Bon auf JEDEM Bildschirm
	     sichtbar bleibt (Menü, Zuschnitt) - nicht nur direkt nach dem Auslösen. -->
	{#if waiting > 0}
		<div class="mt-4 flex items-center gap-3 rounded-2xl bg-bernstein-flaeche px-4 py-3.5">
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			 class="shrink-0 stroke-bernstein-strich"
				aria-hidden="true"><path d="M12 7v5l3 2" /><circle cx="12" cy="12" r="9" /></svg
			>
			<p class="flex-1 text-sm leading-snug text-[#6b5227]">
				<strong class="text-bernstein"
					>{waiting} {waiting === 1 ? 'Bon wartet' : 'Bons warten'} auf Upload.</strong
				>
				Sie gehen raus, sobald wieder Netz da ist.
			</p>
		</div>
	{/if}

	{#if message}<p class="pt-4 text-sm text-gedaempft">{message}</p>{/if}
	</Seite>
{/if}
