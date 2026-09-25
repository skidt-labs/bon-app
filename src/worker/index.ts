import { getBoss, QUEUE_EXTRACT, type ExtractJob } from '$lib/server/queue/boss';
import { aktuellerProvider, wechselnderProvider } from '$lib/server/ki/aktiv';
import { handleExtractJobs, productionDeps, assertBatchSizeOne, istVoruebergehenderFehler } from './extract-receipt';
import { notifyMatrix } from '$lib/server/notify';
import { ocrKonfigurationAusEnv } from '$lib/server/ocr/konfiguration';

// Nachgezogen (Korrekturrunde 3): dieselbe Startprüfung wie in src/matrix/client.ts
// (K2, Korrekturrunde 2) — dort zuerst nur für bon-matrix eingebaut, hier fehlte sie
// noch. `notifyMatrix()` kehrt ohne diese drei Variablen nur STILL zurück (bewusst
// so belassen, dokumentiert als offener Punkt in notify.ts: "wer bewacht den
// Wächter" lässt sich über denselben Kanal nicht lösen). Ein Worker, der
// Extraktionsfehler melden soll, ohne dass sein eigener Alarmweg überhaupt
// konfiguriert ist, wäre genau der unbemerkbare Rückfallwert, den dieses Projekt
// vermeiden will — laut scheitern statt still mit totem Alarmweg laufen.
const { MATRIX_HOMESERVER, MATRIX_ROOM, MATRIX_TOKEN } = process.env;
if (!MATRIX_HOMESERVER || !MATRIX_ROOM || !MATRIX_TOKEN) {
  throw new Error('MATRIX_HOMESERVER, MATRIX_ROOM und MATRIX_TOKEN müssen gesetzt sein (Alarmweg)');
}

// Beim Start EINMAL aufloesen: ohne aktiven Anbieter ist das der .env-Weg, und eine
// unvollstaendige .env scheitert wie bisher sofort und sichtbar in `docker logs`. Ist ein
// Anbieter aktiv und unbrauchbar (Schluessel nicht lesbar, Bildweg nicht freigegeben),
// scheitert der Start ebenso laut — repariert wird in /betrieb/ki, danach startet der
// Container von selbst neu (restart: unless-stopped).
const start = await aktuellerProvider();
const provider = wechselnderProvider(aktuellerProvider, start);
const deps = productionDeps(provider);

const boss = await getBoss();

// batchSize bleibt 1 — siehe der Kommentar bei assertBatchSizeOne für die
// Begründung (pg-boss failt bei einem Teilfehlschlag den ganzen Batch, ein
// Wert > 1 würde bereits gespeicherte Bons erneut abrechnen). Diese Assertion
// lässt den Worker gar nicht erst hochkommen, falls die Zeile unten je
// unbedacht geändert wird.
const workOptions = { batchSize: 1, pollingIntervalSeconds: 5 } as const;
assertBatchSizeOne(workOptions.batchSize);

await boss.work<ExtractJob>(
  QUEUE_EXTRACT,
  workOptions,
  async (jobs) => {
    try {
      await handleExtractJobs(jobs, deps);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Entwurf E7a: der Betreiber soll auf einen Blick sehen, ob das hier von
      // selbst wieder anläuft (503/429/Zeitüberlauf/Verbindungsabbruch — pg-boss
      // versucht es erneut) oder ob der Bon tatsächlich markiert wurde und im
      // Posteingang auf eine Handprüfung wartet.
      const hinweis = istVoruebergehenderFehler(err)
        ? ' (vorübergehend, pg-boss versucht es automatisch erneut)'
        : ' (dauerhaft, Bon im Posteingang markiert)';
      await notifyMatrix(`Bon-App: Extraktion fehlgeschlagen — ${reason}${hinweis}`);
      throw err;
    }
  }
);

// Die OCR-Engine steht bewusst MIT in dieser Zeile. Bis zum 2026-09-16 meldete der
// Worker nur den Extraktions-Anbieter — nach dem Umstellen auf PaddleOCR liess sich der
// laufenden Anlage also nicht ansehen, WELCHE Engine sie benutzt. Eine Einstellung, die
// man nicht nachsehen kann, ist eine, an die man glauben muss; und dieses Projekt hat
// mehrfach teuer dafuer bezahlt, etwas zu glauben, was nicht mehr stimmte. Beim Bildweg
// (openai-compat) laeuft keine OCR — dann steht hier ausdruecklich "ohne OCR".
const ocrHinweis =
  start.weg === 'text' ? `, OCR ${ocrKonfigurationAusEnv().engine}` : ', ohne OCR';
const quelle = start.quelle === 'env' ? 'aus .env' : `aus Oberflaeche („${start.name}")`;
console.log(`[worker] bereit, Provider ${provider.id}/${provider.model}${ocrHinweis}, ${quelle}`);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    console.log(`[worker] ${signal}, fahre herunter`);
    await boss.stop({ graceful: true });
    process.exit(0);
  });
}
