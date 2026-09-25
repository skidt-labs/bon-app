<script lang="ts">
	import { defaultQuad, clampQuad, boundingBox, type Quad } from '$lib/client/crop';
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
	let quad = $state<Quad | null>(null);
	let busy = $state(false);
	let message = $state('');
	/** Beim Mehrfach-Upload warten die restlichen Fotos hier und kommen nacheinander dran. */
	let pending = $state<File[]>([]);
	let source = $state<'camera' | 'upload'>('camera');
	/** Welche Ecke gerade gezogen wird - nicht `event.buttons`, das ist ein Maus-Idiom
	    und liefert für Touch-Pointer je nach Browser keine verlässlichen Werte. */
	let draggingIndex = $state<number | null>(null);
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
		quad = defaultQuad(image.naturalWidth, image.naturalHeight);
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
			quad = null;
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

	/** Mindestabstand (CSS-Pixel) zwischen zwei Ecken auf dem Bildschirm. Die
	    Berührungsfläche jeder Ecke ist 44×44 px (Radius 22 px) groß; erst ab
	    44 px Mittelpunktabstand berühren sich zwei solche Kreise gerade nicht
	    mehr - mit etwas Sicherheitsabstand sind es hier 48 px. */
	const MIN_CORNER_SCREEN_GAP = 48;

	function moveCorner(index: number, event: PointerEvent) {
		if (!img || !quad) return;
		const box = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
		const scaleX = img.naturalWidth / box.width;
		const scaleY = img.naturalHeight / box.height;
		const candidate = {
			x: (event.clientX - box.left) * scaleX,
			y: (event.clientY - box.top) * scaleY
		};

		// Nicht näher an eine benachbarte Ecke heranlassen, als es deren
		// vergrösserte 44×44-Berührungsfläche erlaubt - sonst überlappen sich
		// beide Flächen und blockieren sich beim nächsten Ziehen gegenseitig.
		// Die Ecke bleibt in dem Fall einfach an ihrer letzten gültigen Position
		// stehen, statt in die Nachbarin hineinzulaufen. Nur die beiden echten
		// Nachbarn im Viereck zählen, nicht die gegenüberliegende Ecke - "benachbarte
		// Ecken" aus dem Review-Auftrag meint genau diese beiden.
		const neighbors = [quad[(index + 3) % 4], quad[(index + 1) % 4]];
		for (const neighbor of neighbors) {
			const screenDx = (candidate.x - neighbor.x) / scaleX;
			const screenDy = (candidate.y - neighbor.y) / scaleY;
			if (Math.hypot(screenDx, screenDy) < MIN_CORNER_SCREEN_GAP) return;
		}

		const next = [...quad] as Quad;
		next[index] = candidate;
		quad = clampQuad(next, img.naturalWidth, img.naturalHeight);
	}

	function startDrag(index: number, event: PointerEvent) {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		draggingIndex = index;
		moveCorner(index, event);
	}

	function dragMove(index: number, event: PointerEvent) {
		if (draggingIndex !== index) return;
		moveCorner(index, event);
	}

	function endDrag() {
		draggingIndex = null;
	}

	async function upload() {
		if (!img || !quad) return;
		busy = true;
		message = '';
		try {
			const box = boundingBox(quad);
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(box.width);
			canvas.height = Math.round(box.height);
			canvas
				.getContext('2d')!
				.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
			if (!blob) throw new Error('Zuschnitt fehlgeschlagen');

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
			quad = null;

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
		quad = null;
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
		<div class="relative select-none p-4">
			<img src={img.src} alt="Aufgenommener Bon" class="w-full rounded-2xl" />
			{#each quad ?? [] as corner, i}
				<!-- Die Berührungsfläche (44×44 CSS-px, Apples Mindestmass) ist grösser als der
				     sichtbare Punkt (32×32 px): das äussere <button> ist transparent und nur zum
				     Treffen gedacht, der innere <span> zeigt den eigentlichen Ziehpunkt an. -->
				<button
					class="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full"
					style="left: {(corner.x / img.naturalWidth) * 100}%; top: {(corner.y / img.naturalHeight) *
						100}%"
					onpointerdown={(e) => startDrag(i, e)}
					onpointermove={(e) => dragMove(i, e)}
					onpointerup={endDrag}
					onpointercancel={endDrag}
					aria-label="Ecke {i + 1} verschieben"
				>
					<span class="h-8 w-8 rounded-full border-2 border-white bg-tuerkis/70"></span>
				</button>
			{/each}
		</div>
		<div class="px-4 pb-4">
			<button
				class="flex h-14 w-full items-center justify-center rounded-2xl bg-marine font-semibold text-white disabled:opacity-60"
				disabled={busy}
				onclick={upload}
			>
				{busy ? 'Lädt hoch …' : 'Hochladen'}
			</button>
			<button
				class="mt-2 h-11 w-full rounded-2xl bg-chip font-medium text-tinte"
				onclick={cancel}
			>
				Neu aufnehmen
			</button>
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
