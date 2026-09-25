import { createRequire } from 'node:module';
import {
	MatrixClient,
	RustSdkCryptoStorageProvider,
	type EncryptedFile
} from 'matrix-bot-sdk';
// `matrix-bot-sdk` re-exportiert `StoreType` nur als TYP (unter dem Namen
// `RustSdkCryptoStoreType`, ein `const enum`), nicht als Laufzeitwert — verifiziert
// per `require('matrix-bot-sdk')`: weder `StoreType` noch `RustSdkCryptoStoreType`
// existieren dort zur Laufzeit. Der echte Wert kommt aus dem nativen Paket selbst.
// Auch von DORT lässt sich der Enum-Wert aber nicht per `.Sqlite` abrufen: es ist
// ein `export const enum` (ambient, da nur im .d.ts deklariert), und
// `verbatimModuleSyntax` (aktiv über .svelte-kit/tsconfig.json) verbietet den
// Member-Zugriff auf ambiente const enums komplett — auch als reiner Typ-Import
// nicht kombinierbar mit Wertzugriff. Deshalb hier nur der Typ importiert und der
// Rohwert direkt verwendet: `StoreType.Sqlite === 0`, geprüft per
// `require('@matrix-org/matrix-sdk-crypto-nodejs').StoreType`.
import type { StoreType as RustSdkCryptoStoreType } from '@matrix-org/matrix-sdk-crypto-nodejs';
import { PostgresStorageProvider } from './storage';
import { nimmBildAuf, pruefeAngekuendigteGroesse, type AufnahmeErgebnis } from './ingest';
import { antwortFuer } from './antworten';
import { codeEinloesen } from '$lib/server/matrix/pairing';
import { notifyMatrix } from '$lib/server/notify';
import { schwaerzeFehler } from './schwaerzen';

const CODE_MUSTER = /^[A-Z2-9]{8}$/i;

/**
 * W2a (Korrekturrunde 2): `content.is_direct` setzt der EINLADENDE selbst — kein vom
 * Server geprüftes Merkmal. Ein föderierender Homeserver lässt jeden Matrix-Nutzer
 * weltweit den Bot per Einladung in einen Raum ziehen. Beschränkung auf den eigenen
 * Homeserver, NICHT auf bereits gekoppelte Konten (die Kopplung findet ja erst im
 * Chat statt, ein neues Haushaltsmitglied hat beim allerersten Foto zwangsläufig
 * noch keine).
 *
 * Der eigene Homeserver ist der des Bot-Kontos selbst (`@bon:example.org` →
 * `example.org`). So braucht es keine eigene Einstellung, die von der Wirklichkeit
 * abweichen könnte.
 */
export function serverVonMatrixId(matrixId: string): string | null {
	const doppelpunkt = matrixId.indexOf(':');
	if (!matrixId.startsWith('@') || doppelpunkt < 2 || doppelpunkt === matrixId.length - 1) return null;
	return matrixId.slice(doppelpunkt + 1).toLowerCase();
}

export function istAbsenderVomServer(sender: string | undefined, server: string | null): boolean {
	if (typeof sender !== 'string' || !server) return false;
	return serverVonMatrixId(sender) === server.toLowerCase();
}

/**
 * Kleinbefund aus der Triage (Korrekturrunde 2), "sofort" eingestuft:
 * `package.json` lässt sowohl `matrix-bot-sdk` (`^0.8.0`) als auch
 * `@matrix-org/matrix-sdk-crypto-nodejs` (`^0.4.0`) auf neue Minor-/Patch-Versionen
 * wandern. Der hartkodierte Ersatzwert `SQLITE_STORE = 0` (s. Kommentar beim Import
 * oben — TypeScripts `verbatimModuleSyntax` verbietet den Member-Zugriff auf den
 * ambienten `const enum` selbst als reinen Typ-Import) unterstellt, dass `0` auch
 * nach einem `npm update` noch `StoreType.Sqlite` ist. Bricht diese Annahme, gibt es
 * dafür KEINEN roten Test — der Bot würde mit dem falschen Speichertyp starten und
 * stillschweigend falsch laufen.
 *
 * Deshalb hier zur LAUFZEIT (nicht zur Typprüfzeit) gegen den echten Wert
 * geprüft: `require()` (per `createRequire`, da dieses Modul selbst ESM ist) liest
 * den echten `StoreType` als ganz gewöhnlichen JS-Wert — die
 * `verbatimModuleSyntax`-Beschränkung gilt nur für TypeScripts `import`-Syntax, ein
 * `require()`-Aufruf zur Laufzeit ist davon unberührt (nachgemessen:
 * `require('@matrix-org/matrix-sdk-crypto-nodejs').StoreType` liefert
 * `{ Sqlite: 0 }`). Weicht der echte Wert vom hier verwendeten `0` ab, scheitert der
 * Bot beim Start laut statt mit einem falschen Speichertyp weiterzulaufen.
 */
export function pruefeStoreTypeSqlite(): void {
	const require = createRequire(import.meta.url);
	const echtesStoreType = (
		require('@matrix-org/matrix-sdk-crypto-nodejs') as { StoreType?: { Sqlite?: unknown } }
	).StoreType?.Sqlite;
	if (echtesStoreType !== 0) {
		throw new Error(
			`@matrix-org/matrix-sdk-crypto-nodejs: StoreType.Sqlite ist jetzt ${String(echtesStoreType)}, ` +
				'nicht mehr 0 — der hartkodierte Ersatzwert in client.ts muss angepasst werden'
		);
	}
}

/**
 * Obergrenze fürs Warten auf die Verarbeitungskette beim Beenden (K2b,
 * Korrekturrunde 1). Ein Hänger (z. B. ein steckengebliebener sharp-Aufruf) soll
 * einen Neustart nicht auf unbestimmte Zeit blockieren — 20s reichen für ein
 * einzelnes Foto bequem, siehe MAX_BILD_BYTES/Latenz in ingest.ts.
 */
const SHUTDOWN_KETTE_TIMEOUT_MS = 20_000;

/**
 * Das rohe `m.room.message`-Ereignis, wie es matrix-bot-sdk tatsächlich ausliefert.
 * Bewusst NICHT der `MessageEvent`-Klassentyp aus matrix-bot-sdk: `MatrixClient`
 * erbt von `EventEmitter`, dessen Listener-Parameter ungetypt (`any`) sind, und
 * `processEvent()` gibt ohne registrierte Preprocessor (Standardfall, hier keiner
 * registriert) dasselbe rohe Objekt aus dem Sync unverändert zurück — keine
 * `MessageEvent`-Instanz mit `.eventId`/`.timestamp`-Gettern. Deshalb hier die
 * tatsächlichen Rohfeldnamen (`event_id`, `origin_server_ts`), nicht die
 * camelCase-Namen der Klasse.
 */
type RohesNachrichtenEreignis = {
	sender: string;
	event_id: string;
	origin_server_ts: number;
	content: {
		msgtype?: string;
		body?: string;
		url?: string;
		file?: EncryptedFile;
		// W2b (Korrekturrunde 2): die vom sendenden Client ANGEKÜNDIGTE Grösse, damit
		// sich ein zu grosses Bild ablehnen lässt, BEVOR es überhaupt heruntergeladen
		// wird. Siehe `pruefeAngekuendigteGroesse` in ingest.ts für die Restlücke.
		info?: { size?: number };
	};
};

type RohesEinladungsEreignis = {
	sender?: string;
	content?: { is_direct?: boolean };
};

/** Für das Auffangnetz (W3) — nur die Felder, die fürs Protokollieren zählen. */
type RohesRaumEreignis = {
	type?: string;
	event_id?: string;
	sender?: string;
};

/**
 * K1 (Korrekturrunde 2): „Bot zuletzt gesehen" maß bisher einen 30-Sekunden-Zeitgeber,
 * nicht den tatsächlichen Sync — ein widerrufenes Token ließ die Anzeige „lebt"
 * melden, während jedes Foto ins Leere fiel. Der Zeitstempel wird jetzt NUR NOCH
 * geschrieben, wenn die SDK diesen Wrapper hier tatsächlich aufruft.
 *
 * Nachgeprüft im Quelltext (matrix-bot-sdk 0.8.0, `MatrixClient.js`, `startSync()`,
 * Zeilen ~604-621): `setSyncToken` wird bei `persistTokenAfterSync = true` (weiter
 * unten gesetzt) GENAU DANN gerufen, wenn `doSync()` UND `processSync()` für einen
 * Batch OHNE Wurf durchgelaufen sind — also nach einem tatsächlich erfolgreichen
 * Sync-Durchlauf, nicht vorher. Wirft `doSync` (Netzwerkfehler, 401/403 bei
 * widerrufenem Token, Synapse dauerhaft down), landet der Aufruf im `catch`-Zweig
 * (Zeile ~617-627): dort wird nur geloggt und mit 5-15s Backoff erneut versucht —
 * `setSyncToken` wird NIE erreicht, der Prozess stirbt nie. Genau deshalb ist dieser
 * Callback der richtige Ort für den Herzschlag: ein dauerhaft scheiternder Sync
 * kommt hier schlicht nie mehr an, und `last_sync_at` bleibt ehrlich stehen.
 *
 * Die Schreibfrequenz ändert sich dabei nicht: `syncingTimeout = 30_000`
 * (`MatrixClient.js:73`) lässt `doSync` auch ohne neue Ereignisse spätestens nach
 * 30s zurückkehren, wonach `setSyncToken` erneut aufgerufen wird — derselbe Takt wie
 * der vorherige Zeitgeber, nur an das richtige Ereignis gebunden.
 *
 * Eigene Fabrik statt Inline-Objekt, damit sich genau diese Zuordnung
 * ("SDK ruft setSyncToken → wir schreiben Token + Herzschlag") isoliert testen lässt
 * (`client.test.ts`), ohne einen echten Homeserver zu brauchen — die Matrix-Seite
 * selbst ist ohne Synapse nicht prüfbar (Entwurf, Abschnitt „Prüfbarkeit"), dieser
 * Ausschnitt schon.
 */
export function erzeugeSpeicherWrapper(
	speicher: PostgresStorageProvider,
	sequentiell: (fn: () => Promise<void>) => void
) {
	return {
		getSyncToken: () => speicher.getSyncToken(),
		setSyncToken: (token: string | null) => {
			sequentiell(async () => {
				speicher.setSyncToken(token);
				await speicher.sichern().catch((err) => {
					console.error('[matrix] Sync-Token/Herzschlag konnte nicht gesichert werden', schwaerzeFehler(err));
				});
			});
		},
		getFilter: () => speicher.getFilter(),
		setFilter: (f: unknown) => speicher.setFilter(f),
		readValue: (key: string) => speicher.readValue(key),
		storeValue: (key: string, value: string) => speicher.storeValue(key, value)
	};
}

export async function starteMatrixBot(): Promise<void> {
	const { MATRIX_HOMESERVER, MATRIX_BOT_TOKEN, MATRIX_CRYPTO_DIR, MATRIX_ROOM, MATRIX_TOKEN } = process.env;
	if (!MATRIX_HOMESERVER || !MATRIX_BOT_TOKEN || !MATRIX_CRYPTO_DIR) {
		throw new Error(
			'MATRIX_HOMESERVER, MATRIX_BOT_TOKEN und MATRIX_CRYPTO_DIR müssen gesetzt sein'
		);
	}
	// K2 (Korrekturrunde 2): E2 verlangt, dass JEDES nicht entschlüsselbare Ereignis
	// einen Alarm auslöst — ohne `MATRIX_ROOM`/`MATRIX_TOKEN` kehrt `notifyMatrix`
	// aber nur still zurück (dokumentiert dort, nicht hier lösbar). Ein Bot, der
	// Bons annimmt, OHNE dass sein eigenes Sicherheitsnetz überhaupt konfiguriert
	// ist, wäre selbst der Rückfallwert, den niemand bemerken kann — deshalb hier
	// dasselbe Muster wie bei `MATRIX_BOT_TOKEN`: laut scheitern statt still laufen.
	if (!MATRIX_ROOM || !MATRIX_TOKEN) {
		throw new Error('MATRIX_ROOM und MATRIX_TOKEN müssen gesetzt sein (Alarmweg aus E2)');
	}

	const speicher = new PostgresStorageProvider();
	await speicher.laden();

	// Verbindliche Auflage aus der Prüfung von Aufgabe 4: Ereignisse sequenziell
	// abarbeiten. `processSync()` ruft Listener über
	// `Promise.resolve(this.emit(...))` auf — `EventEmitter.emit` ist synchron und
	// wartet NICHT auf die vom eigenen `async`-Listener zurückgegebene Promise
	// (verifiziert im Quelltext von matrix-bot-sdk 0.8.0). Ohne eigene Serialisierung
	// liefe ein zweites Ereignis aus demselben Sync-Batch los, bevor das erste fertig
	// ist — genau die Wettläufe beim Medium-Löschen und bei den Antworten, die die
	// Auflage ausschliesst. Dieselbe Ketten-Idee wie `kette` in
	// `src/lib/client/outbox.ts`, ohne dessen Web-Locks-Teil (hier ein einziger
	// Prozess, kein Multi-Tab-Fall). Vor der Client-Konstruktion deklariert: der
	// Speicher-Wrapper direkt darunter (K2a) braucht sie schon.
	let kette: Promise<void> = Promise.resolve();
	const sequentiell = (fn: () => Promise<void>): void => {
		kette = kette.then(fn, fn).catch((err) => {
			console.error('[matrix] Ereignisbehandlung fehlgeschlagen', schwaerzeFehler(err));
		});
	};

	// K2a (Korrekturrunde 1): Der Sync-Token darf erst NACH der tatsächlichen
	// Verarbeitung eines Batches dauerhaft werden. Vorher (die ursprüngliche
	// Fassung) markierte ihn schon VOR der Verarbeitung als erledigt — ein
	// Neustart mitten in der Bildverarbeitung hätte das Foto dann für immer
	// verloren: kein Bon, keine Antwort, kein Alarm, und beim nächsten Start würde
	// der Sync-Token dieses Ereignis nie wieder anfordern. Diese Wrapper-Funktion
	// reiht die tatsächliche Übernahme HINTEN in dieselbe Kette ein wie die
	// Ereignisse selbst; `persistTokenAfterSync = true` (weiter unten gesetzt)
	// sorgt dafür, dass matrix-bot-sdk `setSyncToken` überhaupt erst NACH dem
	// Verteilen ALLER Ereignisse eines Batches aufruft (verifiziert im
	// Quelltext — s. Bericht), sodass der hier eingereihte Übernahme-Schritt
	// garantiert HINTER den echten Verarbeitungsschritten dieses Batches liegt.
	// Ein doppelt geliefertes Ereignis ist dank des Idempotenz-Schlüssels
	// (matrix_event_id) folgenlos — ein verlorenes ist es nicht.
	const speicherFuerClient = erzeugeSpeicherWrapper(speicher, sequentiell);

	// Dauerhafter Krypto-Speicher auf der Platte. Im Arbeitsspeicher wäre er nach
	// jedem Deploy weg und der Bot könnte nichts mehr entschlüsseln.
	// `0` statt `StoreType.Sqlite`: siehe Kommentar beim Import weiter oben.
	pruefeStoreTypeSqlite();
	const SQLITE_STORE = 0 as RustSdkCryptoStoreType;
	const krypto = new RustSdkCryptoStorageProvider(MATRIX_CRYPTO_DIR, SQLITE_STORE);

	const client = new MatrixClient(MATRIX_HOMESERVER, MATRIX_BOT_TOKEN, speicherFuerClient as never, krypto);
	// s. Kommentar bei `speicherFuerClient` oben: ohne dieses Flag ruft die SDK
	// `setSyncToken` VOR statt nach der Verarbeitung des Batches auf.
	// `persistTokenAfterSync` ist als `protected` deklariert (nur Typ-Ebene — zur
	// Laufzeit ein ganz normales, veränderliches Feld), daher der Cast.
	(client as unknown as { persistTokenAfterSync: boolean }).persistTokenAfterSync = true;

	// Nur Einladungen zu Direktchats annehmen. Aus Gruppenräumen wird grundsätzlich
	// nichts angenommen — dort landeten sonst Urlaubsfotos in der Pipeline.
	client.on('room.invite', (roomId: string, ereignis: RohesEinladungsEreignis) =>
		sequentiell(async () => {
			// W2a (Korrekturrunde 2): zuerst der Absender, dann erst is_direct — ein
			// föderierter Fremder soll gar nicht erst die is_direct-Prüfung erreichen.
			if (!istAbsenderVomServer(ereignis.sender, serverVonMatrixId(await client.getUserId()))) {
				console.log('[matrix] Einladung von fremdem Homeserver abgelehnt', roomId, ereignis.sender);
				return;
			}
			if (ereignis.content?.is_direct) {
				await client.joinRoom(roomId);
			} else {
				// W3: nichts soll spurlos verschwinden, auch eine bewusst abgelehnte
				// Einladung nicht.
				console.log('[matrix] Einladung zu Nicht-Direktchat ignoriert', roomId);
			}
		})
	);

	client.on('room.failed_decryption', (roomId: string, ereignis: unknown, fehler: Error) =>
		sequentiell(async () => {
			// E2: Der Schlüsselverlust MUSS laut scheitern. Ein Bot, der still nichts
			// mehr entschlüsselt, sieht für den Nutzer genauso aus wie ein Bot, dem
			// niemand geschrieben hat — die teuerste Fehlerklasse dieses Projekts.
			console.error('[matrix] Entschlüsselung fehlgeschlagen', roomId, schwaerzeFehler(fehler));
			await sendeSicher(roomId, 'Entschlüsselungs-Hinweis', () =>
				client.sendText(
					roomId,
					'Ich kann diese Nachricht nicht entschlüsseln. Bitte prüfe die Verifizierung.'
				)
			);
			// Das Bot-Token ist ein Geheimnis: nie in den Alarm, nur die Fehlermeldung
			// der Entschlüsselung (Session-/Raum-IDs, keine Zugangsdaten).
			await notifyMatrix(`Bon-Bot kann in ${roomId} nicht entschlüsseln: ${fehler.message}`).catch(
				() => {}
			);
		})
	);

	client.on('room.message', (roomId: string, ereignis: RohesNachrichtenEreignis) =>
		sequentiell(() => behandleNachricht(client, roomId, ereignis))
	);

	// W3 (Korrekturrunde 1): Auffangnetz. `room.event` feuert für JEDES Ereignis in
	// einem Raum, dem der Bot beigetreten ist — auch für solche, für die es sonst
	// keinen Zuhörer gibt (Reaktionen anderer, Redactions, Zustandsänderungen).
	// Rein protokollierend, absichtlich OHNE eigene Kette: hier passiert nichts
	// Zustandsänderndes, also kein Wettlauf, den die Auflage aus Aufgabe 4
	// verbietet. `m.room.message` und `m.room.encrypted` haben schon einen
	// gezielten Zuhörer (oben) und werden hier ausgeklammert, sonst würde jede
	// Nachricht doppelt geloggt.
	const BEHANDELTE_TYPEN = new Set(['m.room.message', 'm.room.encrypted']);
	client.on('room.event', (roomId: string, ereignis: RohesRaumEreignis) => {
		if (ereignis?.type && !BEHANDELTE_TYPEN.has(ereignis.type)) {
			console.log('[matrix] unbehandeltes Ereignis', roomId, ereignis.type, ereignis.event_id, ereignis.sender);
		}
	});

	await client.start();
	console.log('[matrix] bereit');

	// K1 (Korrekturrunde 2): HIER stand vorher ein 30-Sekunden-Zeitgeber, der
	// bedingungslos `speicher.sichern()` rief — das war der eigentliche Defekt:
	// er schrieb „lebt" alle 30s, ganz gleich, ob der letzte Sync geglückt war oder
	// die SDK seit Stunden im Backoff-Retry hing. Der Herzschlag kommt jetzt
	// ausschliesslich aus `erzeugeSpeicherWrapper.setSyncToken` (oben), also nur
	// nach einem tatsächlich erfolgreichen Sync-Durchlauf. Kein Ersatz nötig: siehe
	// Kommentar dort für die Herleitung, warum die Schreibfrequenz gleich bleibt.
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.on(signal, () => {
			console.log(`[matrix] ${signal} empfangen, beende`);
			client.stop();
			void beendeSauber(() => kette);
		});
	}
}

/**
 * K2b (Korrekturrunde 1): wartet auf die Verarbeitungskette, statt sofort zu
 * beenden — sonst geht ein Foto, das genau während eines `docker compose up -d`
 * in Arbeit ist, spurlos verloren (kein Bon, keine Antwort, kein Alarm: der
 * schlimmstmögliche Ausgang in diesem Projekt). Mit Obergrenze, damit ein echter
 * Hänger den Neustart nicht auf unbestimmte Zeit blockiert.
 *
 * K1 (Korrekturrunde 2): hier stand bis eben noch ein abschliessendes
 * `speicher.sichern()` NACH dem Warten — das hätte den Herzschlag bei JEDEM
 * Neustart auf „jetzt" gesetzt, auch wenn seit Tagen kein Sync mehr geglückt ist
 * (z. B. ein `docker restart bon-matrix` bei widerrufenem Token). Genau der Fehler,
 * den dieser Fix beheben soll, nur ausgelöst durch einen Neustart statt durch einen
 * Zeitgeber. Ein Aufruf hier ist auch nicht mehr nötig: Token UND Herzschlag werden
 * jetzt bei jedem erfolgreichen Sync sofort geschrieben (s. o.), und `warteAufKette`
 * wartet genau darauf, dass diese Schreiboperation durchgelaufen ist, bevor der
 * Prozess beendet wird.
 */
async function beendeSauber(holeKette: () => Promise<void>): Promise<void> {
	const fertig = await warteAufKette(holeKette, SHUTDOWN_KETTE_TIMEOUT_MS);
	if (!fertig) {
		console.error(
			`[matrix] Verarbeitungskette nach ${SHUTDOWN_KETTE_TIMEOUT_MS / 1000}s nicht fertig — Warten für den Shutdown abgebrochen`
		);
	}
	process.exit(0);
}

/**
 * Wartet auf die aktuelle Kette — und, falls sich in der Zwischenzeit neue
 * Ereignisse angehängt haben (ein Sync-Batch kann noch unterwegs sein, obwohl
 * `client.stop()` schon aufgerufen wurde: ein laufender Long-Poll wird dadurch
 * nicht abgebrochen), auf deren Fortsetzung — bis die Kette sich zwischen zwei
 * Prüfungen nicht mehr verändert hat, oder bis `maxMs` erreicht ist.
 */
async function warteAufKette(holeKette: () => Promise<void>, maxMs: number): Promise<boolean> {
	const start = Date.now();
	let vorherige: Promise<void> | null = null;
	for (;;) {
		const aktuelle = holeKette();
		if (aktuelle === vorherige) return true;
		vorherige = aktuelle;
		const rest = maxMs - (Date.now() - start);
		if (rest <= 0) return false;
		const fertig = await Promise.race([aktuelle.then(() => true), verzoegerung(rest).then(() => false)]);
		if (!fertig) return false;
	}
}

const verzoegerung = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * W2 (Korrekturrunde 1): jeder Sendeversuch abgesichert. Ungesichert würde ein
 * fehlgeschlagenes `sendText`/`sendEvent` werfen und die restliche Verarbeitung
 * abreissen. Ein Nutzer, den der Bot nicht erreichen kann, erfährt sonst gar
 * nichts — dieselbe Fehlerklasse wie `room.failed_decryption`, deshalb auch
 * derselbe Massstab: loggen (geschwärzt, W1) UND alarmieren.
 *
 * W5 (Korrekturrunde 3, Ruling-Umkehr): gibt jetzt zurück, OB das Senden
 * geglückt ist. Vorher lief das Löschen des Mediums in `behandleNachricht`
 * IMMER weiter, auch wenn genau diese Bestätigung nicht ankam — Begründung
 * damals: ein fehlgeschlagener Sendeversuch soll die Redaktion nicht
 * blockieren. Das erzeugte aber den Schaden, den es vermeiden wollte: scheitert
 * `client.sendText` (Synapse kurz weg, 429, abgerissene Verbindung), fängt
 * diese Funktion das ab UND das Bild wurde trotzdem gelöscht — der Nutzer
 * bekommt NICHTS, sein Foto ist weg, und er schickt es erneut (neue
 * Ereignis-ID, Doppel-Bon). Die vierte Instanz derselben Verkettung in diesem
 * Projekt. Ein Bild, das im Chat liegen bleibt, ist der harmlosere Ausgang —
 * daran sieht der Nutzer, dass etwas offen ist.
 */
async function sendeSicher(
	roomId: string,
	beschreibung: string,
	fn: () => Promise<unknown>
): Promise<boolean> {
	try {
		await fn();
		return true;
	} catch (err) {
		console.error(`[matrix] Senden fehlgeschlagen (${beschreibung}) in ${roomId}`, schwaerzeFehler(err));
		await notifyMatrix(`Bon-Bot: Senden fehlgeschlagen (${beschreibung})`).catch(() => {});
		return false;
	}
}

export async function behandleNachricht(
	client: MatrixClient,
	roomId: string,
	ereignis: RohesNachrichtenEreignis
): Promise<void> {
	const inhalt = ereignis.content;
	const sender = ereignis.sender;
	const eventId = ereignis.event_id;

	// Sonst beantwortet der Bot seine eigenen, im Sync zurückgespiegelten
	// Nachrichten (Antworttexte, Kopplungsbestätigung) — eine Endlosschleife.
	if (sender === (await client.getUserId())) return;

	if (inhalt.msgtype === 'm.text' && CODE_MUSTER.test((inhalt.body ?? '').trim())) {
		const r = await codeEinloesen((inhalt.body ?? '').trim(), sender);
		await sendeSicher(roomId, 'Kopplungsantwort', () => client.sendText(roomId, textFuerKopplung(r)));
		return;
	}

	if (inhalt.msgtype !== 'm.image') {
		await sendeSicher(roomId, 'Hinweistext', () =>
			client.sendText(roomId, 'Schick mir ein Foto von einem Kassenbon.')
		);
		return;
	}

	// W2b (Korrekturrunde 2): die angekündigte Grösse prüfen, BEVOR überhaupt
	// heruntergeladen wird — `downloadContent`/`decryptMedia` puffern sonst das
	// komplette Medium in einen Buffer, bis zu Synapses 512-MB-Grenze, ein Hebel, um
	// den Bot per Speicher lahmzulegen. Siehe `pruefeAngekuendigteGroesse` für die
	// bewusst dokumentierte Restlücke (die Angabe kommt vom Absender und kann lügen
	// — `mem_limit` in compose.yaml, W2c, ist dagegen der harte Deckel).
	const zuGrossAngekuendigt = pruefeAngekuendigteGroesse(inhalt.info?.size);
	if (zuGrossAngekuendigt) {
		await antworteUndAlarmiere(client, roomId, zuGrossAngekuendigt);
		return;
	}

	let bytes: Buffer;
	try {
		// In der (verschlüsselten) DM steckt der Anhang in `content.file`
		// (`EncryptedFile`), nicht in `content.url`. `downloadContent` entschlüsselt
		// NICHT selbst — eigene Doku der installierten Fassung: "will not
		// automatically decrypt media". `crypto.decryptMedia` lädt UND entschlüsselt
		// (ruft intern selbst `downloadContent` auf, verifiziert im Quelltext).
		// `content.url` bleibt als Rückfall für einen unverschlüsselten Raum, der im
		// Entwurf nicht der Regelfall ist, aber nicht stillschweigend scheitern soll.
		bytes = inhalt.file
			? await client.crypto.decryptMedia(inhalt.file)
			: (await client.downloadContent(inhalt.url as string)).data;
	} catch (err) {
		// Weder Herunterladen noch Entschlüsseln geschafft — kein Bild, auf das sich
		// nimmBildAuf anwenden liesse. Das ist keine Bildqualitätsfrage (das wäre
		// 'kein_bild', ohne Alarm): ein Transport- oder Schlüsselfehler kann der
		// Nutzer nicht durch ein neues Foto beheben, das muss jemand bemerken.
		console.error('[matrix] Anhang konnte nicht geladen werden', schwaerzeFehler(err));
		await antworteUndAlarmiere(client, roomId, {
			art: 'fehler',
			grund: err instanceof Error ? err.message : String(err)
		});
		return;
	}

	const ergebnis = await nimmBildAuf({
		eventId,
		senderMatrixId: sender,
		roomId,
		bytes,
		gesendetAm: new Date(ereignis.origin_server_ts)
	});

	const { text, alarm } = antwortFuer(ergebnis);
	// Nur noch Text, keine Reaktion mehr. Eine Reaktion annotiert ein Ereignis — und
	// bei Erfolg löscht der Bot genau dieses Ereignis unmittelbar danach (E6), womit
	// die Bestätigung mitverschwindet. Im echten Betrieb am 2026-09-15 aufgetreten.
	// Ein Text steht für sich und überlebt die Löschung.
	//
	// W5 (Korrekturrunde 3): `bestaetigungZugestellt` hält fest, OB dieser Text
	// tatsächlich ankam — s. Kommentar bei `sendeSicher` für die Herleitung, warum
	// das jetzt zählt.
	let bestaetigungZugestellt = false;
	if (text) {
		bestaetigungZugestellt = await sendeSicher(roomId, 'Antworttext', () => client.sendText(roomId, text));
	}
	if (alarm) await notifyMatrix(`Bon-Bot: ${ergebnis.art}`).catch(() => {});

	// E6: erst der Bon in der Datenbank, DANN löschen — und nur bei tatsächlicher
	// Aufnahme.
	//
	// W5 (Korrekturrunde 3, Ruling-Umkehr): zusätzlich NUR, wenn die Bestätigung
	// oben nachweislich zugestellt wurde. Aufgabe 5 (W2, Korrekturrunde 1) hatte
	// bewusst entschieden, dass ein fehlgeschlagener Sendeversuch das Löschen NICHT
	// blockieren darf — richtig für den damals betrachteten Fall. Im echten Betrieb
	// zeigte sich aber: genau dieses bedingungslose Löschen erzeugt den Schaden, den
	// die Entscheidung vermeiden wollte. Scheitert `client.sendText` (Synapse kurz
	// weg, 429, abgerissene Verbindung), bekam der Nutzer bisher WEDER Bestätigung
	// NOCH Fehlermeldung, während sein Foto trotzdem verschwand — die naheliegende
	// Reaktion ist, es erneut zu schicken (neue Ereignis-ID, Doppel-Bon). Ein Bild,
	// das im Chat liegen bleibt, ist der harmlosere Ausgang: daran sieht der Nutzer,
	// dass noch etwas offen ist. `sendeSicher` hat den Fehlschlag oben bereits
	// geloggt und alarmiert — hier nur noch die Konsequenz fürs Löschen.
	//
	// M2 (Korrekturrunde 2), EHRLICH benannt statt still hingenommen:
	// `redactEvent` redigiert das ZUSTANDS-Ereignis in Element/Synapses Zeitleiste —
	// es entfernt die hochgeladene Datei NICHT aus Synapses Medienspeicher. Dafür
	// gäbe es die Admin-API `DELETE /_synapse/admin/v1/media/<server>/<media_id>`,
	// die ein Admin-Token braucht. Das ist eine Rechteausweitung (ein Bot-Token wird
	// zum Homeserver-Admin-Token), die NICHT hier entschieden wird — nur der
	// Betreiber kann das freigeben. E6 ("Danach existiert der Bon nur noch einmal —
	// im Bildspeicher der App") ist damit NICHT vollständig erfüllt: im
	// verschlüsselten Direktchat (E1) bleibt der Schaden gedämpft, weil die Datei
	// weiterhin AES-verschlüsselt in Synapse liegt und der Schlüssel im jetzt
	// redigierten Ereignis stand — auf dem unverschlüsselten `content.url`-Rückfall
	// weiter oben bliebe dagegen ein Klartextbild liegen. Sichtbarer Hinweis dazu
	// steht auf /settings/matrix, damit das keine stille Lücke bleibt.
	// Entwurf E4: 'aufgenommen_zu_klein' ist derselbe Erfolgspfad wie 'aufgenommen'
	// (der Bon ist gespeichert und eingereiht) — nur die Antwort trägt zusätzlich
	// eine Warnung. Das Original gehört genauso gelöscht, sonst läge es doppelt.
	if (
		(ergebnis.art === 'aufgenommen' || ergebnis.art === 'aufgenommen_zu_klein') &&
		bestaetigungZugestellt
	) {
		await client.redactEvent(roomId, eventId, 'in die Bon-App übernommen').catch((err) => {
			console.error('[matrix] Medium konnte nicht gelöscht werden', schwaerzeFehler(err));
		});
	}
}

async function antworteUndAlarmiere(
	client: MatrixClient,
	roomId: string,
	ergebnis: AufnahmeErgebnis
): Promise<void> {
	const { text, alarm } = antwortFuer(ergebnis);
	if (text) await sendeSicher(roomId, 'Fehlerantwort', () => client.sendText(roomId, text));
	if (alarm) await notifyMatrix(`Bon-Bot: ${ergebnis.art}`).catch(() => {});
}

function textFuerKopplung(r: Awaited<ReturnType<typeof codeEinloesen>>): string {
	if (r.ok) return 'Verknüpft. Ab jetzt kannst du mir Bons schicken.';
	// Kein `default`: ein künftig ergänzter Grund muss hier auffallen (TS-Fehler bei
	// fehlendem Fall) statt stillschweigend auf eine falsche Antwort zu fallen —
	// dasselbe Muster wie in `antwortFuer`.
	switch (r.grund) {
		case 'unbekannt':
			return 'Diesen Code kenne ich nicht.';
		case 'abgelaufen':
			return 'Der Code ist abgelaufen. Hol dir in der App einen neuen.';
		case 'verbraucht':
			return 'Dieser Code wurde schon benutzt. Hol dir in der App einen neuen.';
		case 'kein_mitglied':
			// Befund R02: der Code ist gültig, aber sein Besitzer gehört gerade zu keinem
			// Haushalt (z. B. aus dem Haushalt entfernt). "Diesen Code kenne ich nicht"
			// wäre hier irreführend — der Code war korrekt, das App-Konto ist es nicht.
			return 'Dieses App-Konto gehört gerade zu keinem Haushalt und kann nicht verknüpft werden.';
		case 'schon_verknuepft':
			return 'Dein Matrix-Konto ist bereits mit einem App-Konto verknüpft.';
		case 'konto_schon_gekoppelt':
			// Andere Auskunft als 'schon_verknuepft': hier ist der CODE gültig, aber das
			// APP-Konto trägt schon eine andere Verknüpfung — ein neuer Code hilft
			// nicht, die bestehende Verknüpfung muss zuerst in der App gelöst werden.
			return 'Dein App-Konto ist bereits mit einem anderen Matrix-Konto verknüpft. Löse zuerst die bestehende Verknüpfung in der App, bevor du einen neuen Code einlöst.';
		case 'zu_viele_versuche':
			return 'Zu viele Fehlversuche. Bitte warte eine Viertelstunde.';
		case 'fehler':
			// An unserer Seite ging etwas schief — der Code selbst könnte richtig sein,
			// wir wissen es gerade nicht. Nicht als "kenne ich nicht" ausgeben, das
			// schickte den Nutzer auf die falsche Fehlersuche.
			return 'Bei uns ist gerade etwas schiefgegangen. Bitte versuch es in ein paar Minuten noch einmal.';
	}
}
