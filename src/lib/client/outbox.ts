/**
 * Offline-Warteschlange für Bon-Fotos.
 *
 * Oberstes Prinzip der App: ein Foto, das der Nutzer aufgenommen hat, darf
 * niemals still verschwinden - weder wenn das Netz wegbricht, noch wenn der
 * Browser die Seite entlädt, noch wenn der Upload scheitert. Deshalb landet
 * jedes Foto zuerst in IndexedDB (überlebt Reload/Tab-Schließen/Offline) und
 * wird erst danach an den Server geschickt. Erst nach einer erfolgreichen
 * Antwort verlässt es die Warteschlange wieder.
 *
 * Bewusst KEIN Vertrauen auf den Service-Worker der PWA für diese Garantie:
 * `@vite-pwa/sveltekit` cacht Assets/Navigationen, ist aber kein Sync-Queue-
 * Mechanismus für Formular-Uploads. Background Sync ist ausserdem nicht in
 * allen Browsern (insb. iOS Safari, der wichtigste Handy-Browser hier)
 * verfügbar - die Outbox muss also auch per Foreground-Retry funktionieren.
 */

const DB_NAME = 'bon-outbox';
const STORE = 'uploads';
const DB_VERSION = 1;

/** Ein aufgeschobener Upload, wie er in IndexedDB liegt. */
type OutboxEntry = {
	id: number;
	blob: Blob;
	source: 'camera' | 'upload';
	createdAt: number;
	/**
	 * WEM das Foto gehoert — die Nutzer-Id aus der Sitzung, in der es aufgenommen wurde.
	 *
	 * IndexedDB haengt am Browserprofil, nicht am Konto: alle Anmeldungen desselben
	 * Profils teilen sich `bon-outbox/uploads`. Ohne dieses Feld verschickte der
	 * automatische Abgleich beim naechsten Oeffnen ALLES, was dalag, unter der gerade
	 * angemeldeten Sitzung — A nimmt offline ein Foto auf, B meldet sich am selben
	 * Geraet an, und der Bon landet in Bs Haushalt (Befund R01). Fuer den Server ist
	 * das ein voellig normaler Upload von B; serverseitig ist da nichts zu retten.
	 *
	 * Optional, weil Eintraege aus der Zeit vor dieser Aenderung es nicht haben.
	 * Siehe `darfUebernehmen` fuer den Umgang damit.
	 */
	nutzerId?: string;
};

/**
 * Welche Konten sich in diesem Browserprofil schon angemeldet haben.
 *
 * Nur dafuer da, alte Eintraege OHNE `nutzerId` einordnen zu koennen: war hier immer
 * nur ein Konto, gehoeren sie zweifelsfrei diesem. Waren es mehrere, ist die Zuordnung
 * nicht mehr herstellbar — dann bleiben sie liegen, statt unter dem falschen Konto
 * hochzugehen. Ein Foto, das liegenbleibt, kann man noch retten; eines im falschen
 * Haushalt nicht mehr.
 */
const NUTZER_SCHLUESSEL = 'bon-outbox-nutzer';

function nutzerMerken(nutzerId: string): string[] {
	try {
		const roh = localStorage.getItem(NUTZER_SCHLUESSEL);
		const bekannt: string[] = roh ? JSON.parse(roh) : [];
		if (!bekannt.includes(nutzerId)) {
			bekannt.push(nutzerId);
			localStorage.setItem(NUTZER_SCHLUESSEL, JSON.stringify(bekannt));
		}
		return bekannt;
	} catch {
		// Privater Modus, gesperrter Speicher: dann wissen wir nichts ueber die
		// Vorgeschichte und uebernehmen im Zweifel NICHTS.
		return [];
	}
}

/** Darf dieser Mensch einen Alteintrag ohne `nutzerId` uebernehmen? */
export function darfUebernehmen(bekannteNutzer: string[], nutzerId: string): boolean {
	return bekannteNutzer.length === 1 && bekannteNutzer[0] === nutzerId;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/**
 * Führt genau eine IndexedDB-Operation in einer eigenen Transaktion aus.
 * Absichtlich eine Transaktion pro Aufruf (nicht eine grosse für den ganzen
 * Flush-Durchlauf): zwischen zwei Einträgen liegt ein `await fetch(...)`, und
 * eine IndexedDB-Transaktion schliesst sich automatisch, sobald der aktuelle
 * Tick ohne weitere Anfrage endet. Über einen `await` hinweg offenzuhalten
 * würde je nach Browser einen `TransactionInactiveError` auslösen.
 *
 * Die Verbindung wird nach jedem Aufruf wieder geschlossen, statt sie offen
 * zu lassen: offene Verbindungen blockieren in IndexedDB spätere
 * `deleteDatabase`/Versions-Upgrades (etwa aus einem anderen Tab), und ohne
 * Schliessen sammelt eine lange laufende PWA-Seite eine offene Verbindung
 * pro Zugriff an.
 */
function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const request = fn(db.transaction(STORE, mode).objectStore(STORE));
				request.onsuccess = () => {
					db.close();
					resolve(request.result);
				};
				request.onerror = () => {
					db.close();
					reject(request.error);
				};
			})
	);
}

/** Legt ein Foto in der Warteschlange ab. Kehrt erst zurück, wenn es sicher in IndexedDB steht. */
export async function enqueueUpload(
	blob: Blob,
	source: 'camera' | 'upload',
	nutzerId: string
): Promise<void> {
	nutzerMerken(nutzerId);
	try {
		await tx('readwrite', (s) => s.add({ blob, source, createdAt: Date.now(), nutzerId }));
	} catch (err) {
		// Der eine Fall, in dem ein aufgenommenes Foto tatsaechlich NICHT gesichert ist.
		// Genau dann muss der Nutzer es unmissverstaendlich erfahren — die rohe
		// Browser-Ausnahme ("QuotaExceededError: The quota has been exceeded.") sagt ihm
		// nichts und liest sich wie eine Panne, die sich von selbst erledigt. Das Foto
		// bleibt auf dem Schirm stehen, ein erneuter Versuch ist also moeglich.
		if (istSpeicherVoll(err)) {
			throw new Error(
				'Der Speicher des Browsers ist voll — dieses Foto wurde NICHT gesichert. ' +
					'Bitte zuerst die wartenden Bons hochladen (dafür Netz nötig) und es dann erneut versuchen.'
			);
		}
		throw err;
	}
}

/** QuotaExceededError kommt je nach Browser als DOMException oder mit abweichendem Code. */
function istSpeicherVoll(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const e = err as { name?: unknown; code?: unknown };
	return e.name === 'QuotaExceededError' || e.code === 22;
}

/** Anzahl der Fotos, die noch auf einen erfolgreichen Upload warten. */
export async function pendingCount(): Promise<number> {
	return tx('readonly', (s) => s.count());
}

export type FlushResult = {
	/** Erfolgreich hochgeladen und aus der Warteschlange entfernt. */
	sent: number;
	/** Bleibt in der Warteschlange, ein erneuter Versuch lohnt sich (kein Netz / Server-Fehler / Sitzung abgelaufen). */
	kept: number;
	/**
	 * Beim Server angekommen, aber die Auswertung ist nicht angelaufen (der
	 * Hintergrundauftrag liess sich nicht einreihen). Der Bon ist NICHT verloren: er
	 * steht im Posteingang als fehlgeschlagen. Ein erneuter Upload würde ihn nur
	 * verdoppeln, deshalb zählt das als erledigt und nicht als "nochmal versuchen".
	 */
	stored: number;
	/**
	 * Vom Server endgültig abgelehnt (Bild kaputt, zu gross, Feld fehlt) und
	 * deshalb aus der Warteschlange entfernt. WICHTIG: "rejected" ist trotzdem
	 * kein stiller Verlust - die aufrufende Stelle MUSS diesen Fall dem Nutzer
	 * anzeigen (siehe +page.svelte), sonst verletzt es das oberste Prinzip.
	 */
	rejected: number;
	/**
	 * Gehoert einem ANDEREN Konto (oder stammt aus der Zeit vor der Zuordnung und liess
	 * sich nicht zweifelsfrei zuordnen) und wurde deshalb NICHT verschickt.
	 *
	 * Bleibt liegen und wird nicht geloescht: das Foto gehoert jemandem, nur nicht dem,
	 * der gerade angemeldet ist. Es verschwinden zu lassen waere derselbe Fehler wie es
	 * unter dem falschen Konto hochzuladen, nur in die andere Richtung.
	 */
	fremd: number;
};

/**
 * HTTP-Statuscodes, bei denen ein erneuter Versuch mit demselben Bild
 * garantiert wieder scheitert - der Server hat das Bild inhaltlich geprüft
 * und abgelehnt (siehe src/routes/api/receipts/+server.ts):
 *   400 Feld "image" fehlt/kaputtes Formular, 413 Bild > 12 MB, 422 Bild nicht
 *   verarbeitbar (sharp kann es nicht dekodieren).
 *
 * Absichtlich NICHT dabei: 401 (Nicht angemeldet). Anders als der Brief für
 * Task 14 es vorsah, ist eine abgelaufene/fehlende Sitzung kein Urteil über
 * das Bild selbst - der exakt gleiche Upload geht nach einem erneuten Login
 * problemlos durch. Ein 401-Eintrag hier zu löschen, würde ein echtes Foto
 * des Nutzers spurlos verschwinden lassen, nur weil die Session in diesem
 * Moment abgelaufen war. Das widerspricht dem obersten Prinzip der App und
 * wurde deshalb bewusst korrigiert (siehe Task-14-Bericht).
 */
const PERMANENTLY_REJECTED = new Set([400, 413, 422]);

/**
 * Versucht, alle wartenden Fotos zu verschicken. Läuft jeden Eintrag einzeln
 * durch, damit ein einzelner Fehlschlag die übrigen nicht blockiert.
 *
 * `deps.fetchImpl` erlaubt es Tests, `fetch` durch einen Mock zu ersetzen -
 * ausserhalb von Tests wird immer das echte globale `fetch` verwendet.
 */
const FLUSH_SPERRE = 'bon-app-outbox-flush';

/**
 * Serialisiert Durchgaenge ueber ALLE Tabs derselben Herkunft. Ohne das senden zwei
 * gleichzeitig offene Tabs, die beide auf `online` reagieren, denselben Eintrag
 * doppelt: `/api/receipts` kennt keinen Idempotenz-Schluessel, es entstuenden also
 * zwei Bons, zwei Modellaufrufe und im Haushaltsbuch ein doppelter Betrag.
 *
 * Bewusst WARTEND statt `ifAvailable`: wer wartet, findet den Eintrag danach bereits
 * verschickt vor und meldet ehrlich "hochgeladen" — das Foto des Nutzers ist ja
 * tatsaechlich angekommen, nur durch den anderen Tab. Mit `ifAvailable` kaeme ein
 * sofortiges Null-Ergebnis zurueck, das `describeFlush` ebenfalls als "hochgeladen"
 * formulierte, ohne dass irgendjemand etwas gesendet haette.
 *
 * Faellt der Browser ohne Web Locks vor (aeltere Safari-Staende), bleibt die
 * Tab-interne Kette unten als Schutz — einmal zu viel senden ist besser als gar nicht.
 */
async function mitSperre<T>(fn: () => Promise<T>): Promise<T> {
	const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
	if (!locks) return fn();
	return (await locks.request(FLUSH_SPERRE, fn)) as T;
}

/**
 * Reiht Durchgaenge innerhalb DIESES Tabs hintereinander. Web Locks deckt nur den
 * Fall mehrerer Tabs ab; hier entsteht der Wettlauf schon allein dadurch, dass der
 * `online`-Handler und ein gerade hochgeladenes Foto gleichzeitig loslaufen.
 *
 * Jeder Aufruf bekommt seinen EIGENEN Durchgang, statt sich an den laufenden
 * anzuhaengen: ein Eintrag, der erst nach dessen Bestandsaufnahme dazukam, bliebe
 * sonst bis zum naechsten Ereignis liegen.
 */
let kette: Promise<unknown> = Promise.resolve();

export function flushOutbox(deps: {
	/** WER gerade angemeldet ist. Pflicht — ohne ihn koennte nur geraten werden, wem ein
	    wartendes Foto gehoert, und geraten wird hier nicht (Befund R01). */
	nutzerId: string;
	fetchImpl?: typeof fetch;
}): Promise<FlushResult> {
	const naechster = kette.then(
		() => mitSperre(() => flushIntern(deps.nutzerId, deps)),
		() => mitSperre(() => flushIntern(deps.nutzerId, deps))
	);
	// Fehler nicht in die Kette tragen, sonst reisst ein einzelner Fehlschlag alle
	// folgenden Durchgaenge mit. Der Aufrufer bekommt ihn ueber `naechster`.
	kette = naechster.then(
		() => undefined,
		() => undefined
	);
	return naechster;
}

async function flushIntern(
	nutzerId: string,
	deps?: { fetchImpl?: typeof fetch }
): Promise<FlushResult> {
	const doFetch = deps?.fetchImpl ?? fetch;
	const entries = await tx<OutboxEntry[]>('readonly', (s) => s.getAll() as unknown as IDBRequest<OutboxEntry[]>);
	const bekannt = nutzerMerken(nutzerId);

	let sent = 0;
	let kept = 0;
	let rejected = 0;
	let stored = 0;
	let fremd = 0;

	for (const entry of entries) {
		// Nur die eigenen Fotos. Ein fremdes hochzuladen hiesse, es dem falschen
		// Haushalt zu geben — und der Server kann das nicht merken, fuer ihn ist es
		// ein voellig normaler Upload des gerade Angemeldeten (Befund R01).
		const gehoertMir = entry.nutzerId
			? entry.nutzerId === nutzerId
			: darfUebernehmen(bekannt, nutzerId);
		if (!gehoertMir) {
			fremd++;
			continue;
		}
		const body = new FormData();
		body.append('image', entry.blob, 'bon.webp');
		body.append('source', entry.source ?? 'camera');
		try {
			const res = await doFetch('/api/receipts', { method: 'POST', body });
			if (res.ok) {
				// Der Server kann bestätigen, dass er den Bon hat, und gleichzeitig
				// melden, dass die Auswertung nicht angelaufen ist. Beides heisst:
				// aus der Warteschlange nehmen. Nur die Meldung an den Nutzer
				// unterscheidet sich.
				const koerper = (await res.json().catch(() => null)) as { queued?: unknown } | null;
				await tx('readwrite', (s) => s.delete(entry.id));
				if (koerper?.queued === false) stored++;
				else sent++;
			} else if (PERMANENTLY_REJECTED.has(res.status)) {
				// Der Server nimmt DIESES Bild nie an - erneutes Senden hilft nicht.
				await tx('readwrite', (s) => s.delete(entry.id));
				rejected++;
			} else {
				// 401 (Session abgelaufen), 5xx oder unbekannter Status: vielleicht
				// vorübergehend - Eintrag bleibt für den nächsten Versuch liegen.
				kept++;
			}
		} catch {
			kept++; // Netz weg: aufheben und beim nächsten Aufruf erneut versuchen
		}
	}

	return { sent, kept, rejected, stored, fremd };
}

/**
 * Formuliert die Meldung für den Nutzer nach einem Flush-Versuch. Bewusst aus
 * `+page.svelte` herausgezogen und hier exportiert, damit sie ohne Browser/
 * Svelte-Testharness geprüft werden kann - genau an dieser Stelle entscheidet
 * sich, ob das oberste Prinzip eingehalten wird: ein abgelehnter oder
 * aufgehobener Bon darf NIE als "hochgeladen" erscheinen.
 */
export function describeFlush(result: FlushResult): string {
	const parts: string[] = [];
	if (result.rejected > 0) {
		parts.push(
			result.rejected === 1
				? 'Ein Bon wurde vom Server abgelehnt (Bild unlesbar oder zu groß) und musste verworfen werden - bitte neu fotografieren.'
				: `${result.rejected} Bons wurden vom Server abgelehnt (Bild unlesbar oder zu groß) und mussten verworfen werden - bitte neu fotografieren.`
		);
	}
	if (result.stored > 0) {
		parts.push(
			result.stored === 1
				? 'Ein Bon ist angekommen, die Auswertung ist aber nicht angelaufen - er steht im Posteingang als fehlgeschlagen.'
				: `${result.stored} Bons sind angekommen, die Auswertung ist aber nicht angelaufen - sie stehen im Posteingang als fehlgeschlagen.`
		);
	}
	if (result.kept > 0) {
		parts.push('Kein Netz (oder nicht angemeldet) - Bon ist gespeichert und geht raus, sobald es wieder klappt.');
	}
	if (result.fremd > 0) {
		// Nicht verschweigen: das Foto liegt sichtbar in der Warteschlange und geht
		// trotzdem nicht raus. Ohne diesen Satz sucht der Mensch den Fehler bei sich.
		parts.push(
			result.fremd === 1
				? 'Ein wartendes Foto gehört zu einer anderen Anmeldung und bleibt liegen - es geht raus, sobald sich diese Person hier anmeldet.'
				: `${result.fremd} wartende Fotos gehören zu einer anderen Anmeldung und bleiben liegen - sie gehen raus, sobald sich diese Person hier anmeldet.`
		);
	}
	if (parts.length === 0) {
		parts.push('Bon hochgeladen, wird ausgelesen …');
	}
	return parts.join(' ');
}

/**
 * Meldung für den AUTOMATISCHEN Hintergrund-Abgleich (onMount/online-Event in
 * Scannen.svelte) — bewusst NICHT einfach describeFlush() weiterreichen.
 *
 * describeFlush() geht davon aus, dass der Aufruf mindestens einen frisch
 * hinzugefügten Eintrag betraf (so ruft ihn upload() auf): bei einem leeren Ergebnis
 * behauptet es deshalb "Bon hochgeladen, wird ausgelesen …". Der automatische
 * Abgleich läuft aber auch, wenn die Warteschlange schlicht leer ist — dort wäre das
 * dieselbe Behauptung über einen Upload, der nie stattfand.
 *
 * Befund R03: der automatische Abgleich wertete das FlushResult bisher GAR NICHT
 * aus — ein endgültig abgelehntes Foto (rejected) verschwand aus der Warteschlange,
 * ohne dass der Nutzer je davon erfuhr. Das ist der Fall, der hier zählt; "kept"
 * (kein Netz) zeigt bereits der Warten-Zähler in der Oberfläche an, und ein blosses
 * "sent" ist im Hintergrund kein Ereignis, auf das reagiert werden müsste.
 */
export function autoSyncMessage(result: FlushResult): string | null {
	// `fremd` gehoert dazu: ein Foto, das dauerhaft liegenbleibt, weil es jemand
	// anderem gehoert, waere sonst genau der stille Zustand, den der automatische
	// Abgleich vermeiden soll.
	if (result.rejected > 0 || result.stored > 0 || result.fremd > 0) return describeFlush(result);
	return null;
}
