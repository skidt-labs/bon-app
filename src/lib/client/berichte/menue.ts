/**
 * Aufklappmenues der Berichtsseite: immer nur EINES offen.
 *
 * Am Handy lagen mehrere offene Menues uebereinander — Zeitwahl, „+ Filter", Gespeicherte
 * Berichte, Export —, weil jedes <details> fuer sich auf- und zuging (Rueckmeldung
 * 27.09.2026). Das Register haelt fest, welches offen ist, schliesst beim Oeffnen die
 * anderen und schliesst beim Tippen daneben oder mit Escape. Seit 0.11.0 merkt es sich
 * auch den Ausloeser und gibt ihm beim Schliessen den Fokus zurueck (1.1).
 *
 * Die Regel ist vom DOM getrennt, damit sie sich ohne Browser pruefen laesst; die Aktion
 * `menue` unten verdrahtet sie mit echten <details>-Elementen.
 */
type Menue = { open: boolean; contains(ziel: unknown): boolean };
/** Was den Fokus zurueckbekommt — beim <details> sein <summary>. */
export type Ausloeser = { focus(optionen?: FocusOptions): void };
/** Wo der Fokus stand, als das Menue zuging: das aktive Element, und ob es „nirgends" war (body). */
export type FokusLage = { aktiv: unknown; nirgends: boolean };

export class MenueRegister<T extends Menue> {
	private offen = new Set<T>();
	private ausloeser = new Map<T, Ausloeser>();

	geoeffnet(m: T, ausloeser?: Ausloeser): void {
		for (const anderes of [...this.offen]) {
			if (anderes !== m) {
				anderes.open = false;
				this.offen.delete(anderes);
				// Geht ein anderes Menue auf, gehoert der Fokus dorthin — kein Rueckweg.
				this.ausloeser.delete(anderes);
			}
		}
		this.offen.add(m);
		if (ausloeser) this.ausloeser.set(m, ausloeser);
	}

	/**
	 * Das Menue ist zu. Mit `fokus` (aus dem toggle-Ereignis): lag der Fokus im Menue oder
	 * nirgends, geht er an den Ausloeser zurueck — sonst stuende er nach ✕, Escape oder
	 * Tippen daneben am Seitenanfang (1.1). Liegt er woanders (daneben auf einen Link
	 * getippt), bleibt er dort. Ohne `fokus` wird nur vergessen; den Abbau behandelt `abgebaut`.
	 * Lag er nirgends, springt die Seite dabei nicht zum Ausloeser: am Rechner kann man mit
	 * offenem Menue weggescrollt haben und dann ins Leere klicken.
	 */
	geschlossen(m: T, fokus?: FokusLage): void {
		this.offen.delete(m);
		const a = this.ausloeser.get(m);
		this.ausloeser.delete(m);
		if (!a || !fokus) return;
		if (fokus.nirgends) a.focus({ preventScroll: true });
		else if (m.contains(fokus.aktiv)) a.focus();
	}

	/**
	 * Das Menue wird abgebaut, ohne zuzugehen — etwa weil die Karte nach „Wiederherstellen"
	 * aus der Bonliste faellt: kein toggle-Ereignis, und der Ausloeser ist mit weg. War es
	 * offen und steht der Fokus jetzt nirgends (das fokussierte Element ist mit abgebaut
	 * worden), geht er an `ausweich` — sonst stuende er am Seitenanfang (1.1).
	 */
	abgebaut(m: T, fokus: FokusLage, ausweich?: Ausloeser): void {
		const warOffen = this.offen.delete(m);
		this.ausloeser.delete(m);
		if (warOffen && fokus.nirgends && ausweich) ausweich.focus();
	}

	/** Ein Tippen irgendwo: schliesst jedes offene Menue, in das NICHT getippt wurde. */
	getippt(ziel: unknown): void {
		for (const m of [...this.offen]) {
			if (!m.contains(ziel)) {
				m.open = false;
				this.offen.delete(m);
			}
		}
	}

	/** true, wenn Escape ein Menue geschlossen hat — dann ist die Taste behandelt. */
	escape(): boolean {
		const etwasOffen = this.offen.size > 0;
		this.alleSchliessen();
		return etwasOffen;
	}

	alleSchliessen(): void {
		for (const m of this.offen) m.open = false;
		this.offen.clear();
	}

	anzahlOffen(): number {
		return this.offen.size;
	}
}

/**
 * Wie oft das Menue eines Eintrags (Schluessel: Bon-Id) zugegangen ist. Eine Antwort, die erst
 * nach dem Schliessen ankommt, gehoert zu einer vergangenen Runde und darf das Menue nicht mehr
 * umstellen — sonst stuende beim naechsten Oeffnen wieder die scharfe zweite Stufe da (1.6).
 */
export class MenueRunden {
	private zaehler = new Map<string, number>();

	runde(schluessel: string): number {
		return this.zaehler.get(schluessel) ?? 0;
	}

	zu(schluessel: string): void {
		this.zaehler.set(schluessel, this.runde(schluessel) + 1);
	}

	gilt(schluessel: string, runde: number): boolean {
		return this.runde(schluessel) === runde;
	}
}

/** Felder, in denen Escape dem Feld gehoert (Auswahl schliessen, Eingabe verwerfen). */
const EIGENES_ESCAPE = new Set(['date', 'time', 'month', 'week', 'datetime-local']);

/**
 * Schliesst Escape das Menue (1.2)? Nicht in Datums- und Zeitfeldern — dort schloss es
 * sonst das ganze Zeitraum-Menue —, und nicht, wenn die Taste schon jemand behandelt hat
 * (`defaultPrevented`). In Textfeldern schon: dort hat Escape keine eigene Bedeutung.
 */
export function escapeSchliesst(ziel: EventTarget | null, bereitsBehandelt: boolean): boolean {
	if (bereitsBehandelt) return false;
	const el = ziel as { tagName?: unknown; type?: unknown } | null;
	const istEingabe = typeof el?.tagName === 'string' && el.tagName.toUpperCase() === 'INPUT';
	return !(istEingabe && typeof el?.type === 'string' && EIGENES_ESCAPE.has(el.type.toLowerCase()));
}

/** 1.3: Escape in der Filterwahl leert zuerst eine nicht leere Suche; erst das naechste schliesst. */
export function filterwahlEscape(suche: string): 'leeren' | 'schliessen' {
	return suche.length > 0 ? 'leeren' : 'schliessen';
}

/** Dieselbe Grenze wie Tailwinds `sm` (40rem): darunter sind Menues Blaetter von unten. */
export const HANDY_MEDIEN = '(width < 40rem)';

/** Am Handy? Ohne Fenster (Server, Tests) nie. */
export function istHandy(): boolean {
	return typeof matchMedia === 'function' && matchMedia(HANDY_MEDIEN).matches;
}

/**
 * Context-Schluessel: der Aufklapper legt darunter `schliessen()` ab, Eintraege im Menue
 * holen es sich mit `getContext` (1.4 — CSV und Drucken navigieren nicht, das Menue bliebe
 * sonst offen). Ausserhalb eines Menues fehlt er; dann tut der Eintrag nichts dergleichen.
 */
export const MENUE_SCHLIESSEN = Symbol('menue-schliessen');
export type MenueSchliessen = () => void;

/** Die id von „+ Filter" — die Filterwahl gibt den Fokus nach Escape dorthin zurueck (1.3). */
export const FILTER_KNOPF_ID = 'filter-hinzufuegen';

const register = new MenueRegister<HTMLDetailsElement>();
let angemeldet = 0;

const beiZeiger = (e: PointerEvent) => register.getippt(e.target);
const beiTaste = (e: KeyboardEvent) => {
	if (e.key !== 'Escape' || !escapeSchliesst(e.target, e.defaultPrevented)) return;
	// Hat Escape ein Menue geschlossen, ist die Taste verbraucht: die Filterwahl dahinter
	// (lauscht am window, also danach) bleibt offen.
	if (register.escape()) e.preventDefault();
};

/** Wohin der Fokus geht, wenn das offene Menue samt Knopf abgebaut wird (Bonliste, 1.1). */
export type MenueOptionen = { ausweich?: () => HTMLElement | null | undefined };

/**
 * Svelte-Aktion fuer ein <details>. Ohne JavaScript bleibt es ein gewoehnliches <details>
 * — auf- und zuklappen geht dann weiter, nur nicht „eines schliesst das andere".
 *
 * Der Fokus wird im toggle-Ereignis entschieden, nicht schon beim Zeiger: toggle kommt als
 * eigene Aufgabe NACH dem Klick, `activeElement` zeigt dann, wohin der Klick den Fokus
 * gesetzt hat.
 */
export function menue(el: HTMLDetailsElement, optionen: MenueOptionen = {}) {
	let o = optionen;
	const knopf = el.querySelector<HTMLElement>(':scope > summary');
	const beiToggle = () => {
		if (el.open) {
			register.geoeffnet(el, knopf ?? undefined);
			return;
		}
		const aktiv = document.activeElement;
		register.geschlossen(el, { aktiv, nirgends: aktiv === null || aktiv === document.body });
	};
	el.addEventListener('toggle', beiToggle);
	if (angemeldet++ === 0) {
		document.addEventListener('pointerdown', beiZeiger);
		document.addEventListener('keydown', beiTaste);
	}
	return {
		update(neu: MenueOptionen = {}) {
			o = neu;
		},
		destroy() {
			el.removeEventListener('toggle', beiToggle);
			// Svelte nimmt das DOM vor dem Abbau der Aktion heraus: stand der Fokus im Menue,
			// steht er jetzt auf body.
			const aktiv = document.activeElement;
			const ziel = o.ausweich?.();
			register.abgebaut(
				el,
				{ aktiv, nirgends: aktiv === null || aktiv === document.body },
				// Nur ein Ziel, das noch in der Seite steht — beim Seitenwechsel ist es mit weg.
				ziel?.isConnected ? { focus: () => ziel.focus({ preventScroll: true }) } : undefined
			);
			if (--angemeldet === 0) {
				document.removeEventListener('pointerdown', beiZeiger);
				document.removeEventListener('keydown', beiTaste);
			}
		}
	};
}
