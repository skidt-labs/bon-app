/**
 * Aufklappmenues der Berichtsseite: immer nur EINES offen.
 *
 * Am Handy lagen mehrere offene Menues uebereinander — Zeitwahl, „+ Filter", Gespeicherte
 * Berichte, Export —, weil jedes <details> fuer sich auf- und zuging (Rueckmeldung
 * 27.09.2026). Das Register haelt fest, welches offen ist, schliesst beim Oeffnen die
 * anderen und schliesst beim Tippen daneben oder mit Escape.
 *
 * Die Regel ist vom DOM getrennt, damit sie sich ohne Browser pruefen laesst; die Aktion
 * `menue` unten verdrahtet sie mit echten <details>-Elementen.
 */
type Menue = { open: boolean; contains(ziel: unknown): boolean };

export class MenueRegister<T extends Menue> {
	private offen = new Set<T>();

	geoeffnet(m: T): void {
		for (const anderes of [...this.offen]) {
			if (anderes !== m) {
				anderes.open = false;
				this.offen.delete(anderes);
			}
		}
		this.offen.add(m);
	}

	geschlossen(m: T): void {
		this.offen.delete(m);
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

	escape(): void {
		this.alleSchliessen();
	}

	alleSchliessen(): void {
		for (const m of this.offen) m.open = false;
		this.offen.clear();
	}

	anzahlOffen(): number {
		return this.offen.size;
	}
}

const register = new MenueRegister<HTMLDetailsElement>();
let angemeldet = 0;

const beiZeiger = (e: PointerEvent) => register.getippt(e.target);
const beiTaste = (e: KeyboardEvent) => {
	if (e.key === 'Escape') register.escape();
};

/**
 * Svelte-Aktion fuer ein <details>. Ohne JavaScript bleibt es ein gewoehnliches <details>
 * — auf- und zuklappen geht dann weiter, nur nicht „eines schliesst das andere".
 */
export function menue(el: HTMLDetailsElement) {
	const beiToggle = () => (el.open ? register.geoeffnet(el) : register.geschlossen(el));
	el.addEventListener('toggle', beiToggle);
	if (angemeldet++ === 0) {
		document.addEventListener('pointerdown', beiZeiger);
		document.addEventListener('keydown', beiTaste);
	}
	return {
		destroy() {
			el.removeEventListener('toggle', beiToggle);
			register.geschlossen(el);
			if (--angemeldet === 0) {
				document.removeEventListener('pointerdown', beiZeiger);
				document.removeEventListener('keydown', beiTaste);
			}
		}
	};
}
