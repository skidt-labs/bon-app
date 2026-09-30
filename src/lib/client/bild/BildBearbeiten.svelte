<script lang="ts">
	/**
	 * „Bild bearbeiten" (Entwurf 2026-09-27-zuschneiden-drehen): der Bon wird selbst erkannt,
	 * die vier Ecken lassen sich nachziehen, gedreht wird in Vierteln und fein — und beim
	 * Uebernehmen wird ECHT entzerrt. Scannen und Pruefansicht benutzen denselben Bildschirm.
	 */
	import { tick } from 'svelte';
	import { defaultQuad, clampQuad, type Quad } from '$lib/client/crop';
	import { gedrehtZeichnen, erkenne, ausschneiden } from './leinwand';

	let {
		bild,
		hauptText,
		beschaeftigt = false,
		onfertig,
		onabbrechen
	}: {
		bild: HTMLImageElement;
		hauptText: string;
		beschaeftigt?: boolean;
		onfertig: (blob: Blob) => void | Promise<void>;
		onabbrechen: () => void;
	} = $props();

	let leinwand = $state<HTMLCanvasElement | null>(null);
	let viertel = $state(0);
	let fein = $state(0);
	/** Was der Regler gerade zeigt; gezeichnet wird erst beim Loslassen (3000-px-Bild). */
	let feinAnzeige = $state(0);
	let quad = $state<Quad | null>(null);
	let erkannt = $state(false);
	let masse = $state({ breite: 1, hoehe: 1 });
	let rechnet = $state(false);
	let fehler = $state('');
	let gezogen = $state<number | null>(null);

	$effect(() => {
		const c = leinwand;
		const b = bild;
		const v = viertel;
		const f = fein;
		if (!c || !b) return;
		gedrehtZeichnen(c, b, v, f);
		masse = { breite: c.width, hoehe: c.height };
		const treffer = erkenne(c);
		erkannt = treffer !== null;
		quad = treffer ?? defaultQuad(c.width, c.height);
	});

	function drehen(richtung: 1 | -1) {
		viertel = (viertel + richtung + 4) % 4;
	}
	function zuruecksetzen() {
		viertel = 0;
		fein = 0;
		feinAnzeige = 0;
		if (leinwand) {
			const treffer = erkenne(leinwand);
			erkannt = treffer !== null;
			quad = treffer ?? defaultQuad(leinwand.width, leinwand.height);
		}
	}

	/** Mindestabstand zweier benachbarter Ecken auf dem Bildschirm (44-px-Griffe + Luft). */
	const MIN_ABSTAND = 48;
	function ziehe(i: number, e: PointerEvent) {
		if (!quad) return;
		const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
		const sx = masse.breite / box.width;
		const sy = masse.hoehe / box.height;
		const p = { x: (e.clientX - box.left) * sx, y: (e.clientY - box.top) * sy };
		for (const n of [quad[(i + 3) % 4], quad[(i + 1) % 4]]) {
			if (Math.hypot((p.x - n.x) / sx, (p.y - n.y) / sy) < MIN_ABSTAND) return;
		}
		const neu = [...quad] as Quad;
		neu[i] = p;
		quad = clampQuad(neu, masse.breite, masse.hoehe);
		erkannt = false;
	}

	async function fertig() {
		if (!leinwand || !quad) return;
		rechnet = true;
		fehler = '';
		try {
			// Erst „Wird vorbereitet …" zeigen, dann rechnen: das Entzerren laeuft am Handy eine
			// bis drei Sekunden am Stueck, und ohne Rueckmeldung sieht das wie ein Haenger aus.
			await tick();
			await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
			const blob = await ausschneiden(leinwand, quad);
			rechnet = false;
			await onfertig(blob);
		} catch (err) {
			fehler = err instanceof Error ? err.message : String(err);
		} finally {
			rechnet = false;
		}
	}
</script>

<div class="grid min-w-0 gap-3">
	<div class="rounded-2xl bg-tinte p-2">
		<div class="relative mx-auto select-none" style="width: min(100%, calc(62dvh * {masse.breite} / {masse.hoehe}))">
			<canvas bind:this={leinwand} class="block h-auto w-full rounded-xl"></canvas>
			{#if quad}
				<svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 {masse.breite} {masse.hoehe}" preserveAspectRatio="none" aria-hidden="true">
					<polygon
						points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
						fill="rgba(7,174,183,0.12)"
						stroke="#07aeb7"
						stroke-width={Math.max(2, masse.breite / 300)}
						vector-effect="non-scaling-stroke"
					/>
				</svg>
				{#each quad as ecke, i (i)}
					<button
						type="button"
						class="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full"
						style="left: {(ecke.x / masse.breite) * 100}%; top: {(ecke.y / masse.hoehe) * 100}%"
						onpointerdown={(e) => {
							(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
							gezogen = i;
							ziehe(i, e);
						}}
						onpointermove={(e) => gezogen === i && ziehe(i, e)}
						onpointerup={() => (gezogen = null)}
						onpointercancel={() => (gezogen = null)}
						aria-label="Ecke {i + 1} verschieben"
					>
						<span class="h-8 w-8 rounded-full border-2 border-white bg-tuerkis/80 shadow"></span>
					</button>
				{/each}
				{#if erkannt}
					<!-- pointer-events-none: der Chip darf den Griff oben links nicht verdecken. -->
					<span class="pointer-events-none absolute top-2 left-2 rounded-full bg-tuerkis-flaeche px-2.5 py-1 text-[12px] font-extrabold text-tuerkis-dunkel">Rand gefunden – bitte prüfen</span>
				{/if}
			{/if}
		</div>
	</div>

	<div class="grid gap-2 rounded-2xl bg-papier p-3 text-[13px] font-bold">
		<div class="flex items-center gap-2">
			<button type="button" class="grid h-11 w-11 place-items-center rounded-full border border-linie" onclick={() => drehen(-1)} aria-label="90 Grad nach links drehen">↺</button>
			<button type="button" class="grid h-11 w-11 place-items-center rounded-full border border-linie" onclick={() => drehen(1)} aria-label="90 Grad nach rechts drehen">↻</button>
			<button type="button" class="ml-auto rounded-full border border-linie px-3 py-2" onclick={zuruecksetzen}>Zurücksetzen</button>
		</div>
		<div class="flex items-center gap-2">
			<label class="flex min-w-0 flex-1 items-center gap-2">
				<span class="sr-only">Fein ausrichten</span>
				<input
					type="range"
					min="-45"
					max="45"
					step="0.5"
					value={feinAnzeige}
					oninput={(e) => (feinAnzeige = Number(e.currentTarget.value))}
					onchange={(e) => (fein = Number(e.currentTarget.value))}
					class="min-w-0 flex-1 accent-tuerkis"
				/>
				<span class="w-14 text-right tabular-nums">{feinAnzeige > 0 ? '+' : ''}{feinAnzeige.toLocaleString('de-DE')}°</span>
			</label>
		</div>
		{#if !erkannt}
			<p class="text-[12.5px] font-semibold text-gedaempft">Rand nicht sicher erkannt — zieh die vier Ecken an die Ecken des Bons. Auf dunklem Untergrund klappt es von selbst besser.</p>
		{/if}
	</div>

	{#if fehler}<p class="text-sm font-semibold text-rot-dunkel">{fehler}</p>{/if}

	<div class="grid gap-2">
		<button
			type="button"
			class="flex h-14 w-full items-center justify-center rounded-2xl bg-marine font-semibold text-white disabled:opacity-60"
			disabled={rechnet || beschaeftigt || !quad}
			onclick={fertig}
		>
			{rechnet ? 'Wird vorbereitet …' : hauptText}
		</button>
		<button type="button" class="h-11 w-full rounded-2xl bg-chip font-medium text-tinte" onclick={onabbrechen}>Abbrechen</button>
	</div>
</div>
