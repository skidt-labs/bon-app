<script lang="ts">
	import { formatCents, parseAmountToCents } from '$lib/money';

	let {
		cents = $bindable(),
		ungueltig = $bindable(false),
		onungueltig,
		leerErlaubt = false,
		ariaLabel,
		class: klasse = ''
	}: {
		cents: number | null;
		/** Im Feld steht etwas, das kein Betrag ist. Der Aufrufer sperrt damit das Bestaetigen. */
		ungueltig?: boolean;
		/**
		 * Dieselbe Auskunft als Rueckruf, fuer Aufrufer, die viele Felder auf einmal
		 * fuehren. `bind:` in einen $state-Datensatz mit gerechnetem Schluessel hinein
		 * (kaputt[`${k}:gesamt`]) schreibt beim Aufbau der Komponente in den Zustand,
		 * waehrend die Vorlage noch laeuft — Svelte verbietet das zur Laufzeit, und die
		 * Seite bleibt weiss. Ein Rueckruf aus einem Ereignis ist der sichere Weg.
		 */
		onungueltig?: (ungueltig: boolean) => void;
		/** Darf das Feld leer bleiben? Dann heisst leer `null` — eine Leerstelle, keine Null. */
		leerErlaubt?: boolean;
		ariaLabel: string;
		class?: string;
	} = $props();

	/**
	 * Was im Feld steht, solange getippt wird — roh, ungeformt.
	 *
	 * Ohne diesen Zwischenschritt formatiert sich das Feld mitten im Tippen: „1,0" ist
	 * bereits ein gueltiger Betrag (1,00 EUR), das Feld schriebe sich zu „1,00" um, und
	 * die naechste Ziffer ergaebe „1,009" — unlesbar. Wer „1,09" tippt, bekaeme einen
	 * Fehler. Diese Falle steckte urspruenglich in jedem Betragsfeld einzeln; deshalb
	 * gibt es das Feld jetzt einmal.
	 */
	let entwurf = $state<string | null>(null);

	function lesbar(roh: string): number | null {
		try {
			return parseAmountToCents(roh);
		} catch {
			return null;
		}
	}

	/**
	 * Von aussen geaendert — etwa durch „2,49 übernehmen" neben einer Abweichung.
	 * Dann muss ein stehengebliebener Entwurf weg, sonst zeigt das Feld weiter die alte
	 * Eingabe, waehrend darunter ein anderer Wert gespeichert ist. Nur bei LESBAREM
	 * Entwurf pruefen: waehrend „1," getippt ist, gibt es nichts zu vergleichen.
	 */
	$effect(() => {
		if (entwurf === null) return;
		const eigen = lesbar(entwurf);
		if (eigen !== null && eigen !== cents) entwurf = null;
	});

	function setzeUngueltig(wert: boolean) {
		ungueltig = wert;
		onungueltig?.(wert);
	}

	function eingabe(roh: string) {
		entwurf = roh;
		if (roh.trim() === '') {
			if (leerErlaubt) {
				cents = null;
				setzeUngueltig(false);
			} else {
				setzeUngueltig(true);
			}
			return;
		}
		const wert = lesbar(roh);
		if (wert === null) {
			setzeUngueltig(true);
			return;
		}
		cents = wert;
		setzeUngueltig(false);
	}

	/** Beim Verlassen zurueck auf die geformte Anzeige — aber nur, wenn es aufging.
	    Unlesbares bleibt stehen, damit der Mensch sieht, was er korrigieren muss. */
	function fertig() {
		if (!ungueltig) entwurf = null;
	}
</script>

<input
	inputmode="decimal"
	value={entwurf ?? (cents !== null ? formatCents(cents) : '')}
	oninput={(e) => eingabe(e.currentTarget.value)}
	onblur={fertig}
	class="rounded-lg border bg-papier text-right tabular-nums {klasse}"
	class:border-linie={!ungueltig}
	class:border-rot={ungueltig}
	aria-label={ariaLabel}
	aria-invalid={ungueltig}
	placeholder={leerErlaubt ? '—' : '0,00'}
/>
