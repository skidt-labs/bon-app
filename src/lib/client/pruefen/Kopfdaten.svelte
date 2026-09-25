<script lang="ts">
	import Betragsfeld from './Betragsfeld.svelte';

	let {
		merchantNameRaw = $bindable(),
		purchasedAt = $bindable(),
		totalGrossCents = $bindable(),
		paymentMethod = $bindable(),
		summeUngueltig = $bindable(false)
	}: {
		merchantNameRaw: string | null;
		/** ISO-Zeitpunkt oder null; das Feld zeigt ihn als lokale Zeit fuer <input type=datetime-local>. */
		purchasedAt: string | null;
		totalGrossCents: number | null;
		paymentMethod: string | null;
		/** Das Feld traegt etwas, das kein Betrag ist — der Aufrufer sperrt damit das
		    Bestaetigen. Sonst saehe der Mensch etwas anderes, als gespeichert wird. */
		summeUngueltig?: boolean;
	} = $props();

	// <input type="datetime-local"> will "JJJJ-MM-TTTHH:MM" in LOKALER Zeit. Ein ISO-Wert
	// mit Zone wuerde als UTC gelesen und zeigte auf dem Bon eine falsche Uhrzeit.
	function fuerFeld(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
	}

	function ausFeld(wert: string) {
		if (wert === '') {
			purchasedAt = null;
			return;
		}
		// Ein unvollstaendiges Feld liefert in manchen Browsern Bruchstuecke; toISOString()
		// wuerfe darauf. Lieber den alten Wert behalten als die Seite anhalten.
		const d = new Date(wert);
		if (!Number.isNaN(d.getTime())) purchasedAt = d.toISOString();
	}

	/** Leeres Feld heisst „nicht gelesen", nicht „der leere Text". */
	const leerIstNull = (s: string) => (s.trim() === '' ? null : s);
</script>

<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
	<label class="grid gap-1">
		<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Händler</span>
		<input
			value={merchantNameRaw ?? ''}
			oninput={(e) => (merchantNameRaw = leerIstNull(e.currentTarget.value))}
			class="rounded-lg border border-linie bg-papier px-2.5 py-1.5 font-semibold"
			placeholder="Unbekannt"
		/>
	</label>
	<label class="grid gap-1">
		<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Datum</span>
		<input
			type="datetime-local"
			value={fuerFeld(purchasedAt)}
			oninput={(e) => ausFeld(e.currentTarget.value)}
			class="rounded-lg border border-linie bg-papier px-2.5 py-1.5 font-semibold"
		/>
	</label>
	<label class="grid gap-1">
		<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Zahlart</span>
		<!-- Freitext, kein Auswahlfeld: in der Datenbank steht, was auf dem Bon stand —
		     "Kreditkarte", "MasterCard", "Kartenzahlung". Eine Liste aus card/cash/other
		     haette diese Werte beim ersten Anfassen ueberschrieben. -->
		<input
			value={paymentMethod ?? ''}
			oninput={(e) => (paymentMethod = leerIstNull(e.currentTarget.value))}
			class="rounded-lg border border-linie bg-papier px-2.5 py-1.5 font-semibold"
			placeholder="—"
		/>
	</label>
	<label class="grid gap-1">
		<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Endsumme</span>
		<Betragsfeld
			bind:cents={totalGrossCents}
			bind:ungueltig={summeUngueltig}
			leerErlaubt
			ariaLabel="Endsumme des Bons"
			class="px-2.5 py-1.5 font-bold"
		/>
	</label>
</div>
