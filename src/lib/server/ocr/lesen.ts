import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Zeitlimit für einen einzelnen Tesseract-Lauf.
 *
 * Gemessen (Entwurf, 2026-09-15): rund 1 Sekunde je Bon. Die Grenze hier liegt bewusst
 * weit darüber — sie soll einen regulären Lauf NIE treffen, sondern nur einen
 * HÄNGENDEN Prozess (kaputtes Abbild, kaputte Tesseract-Installation) beenden, bevor er
 * einen ganzen Worker-Slot dauerhaft blockiert. Ohne diese Grenze würde ein einzelner
 * unlesbarer Bon die gesamte Warteschlange nach ihm mitreißen.
 */
export const OCR_ZEITLIMIT_MS = 20_000;

export type OcrErgebnis =
  | { status: 'gelesen'; text: string }
  | { status: 'nichtsGefunden' }
  | { status: 'werkzeugKaputt'; grund: string };

type ExecFileOptions = {
  timeout: number;
  killSignal: NodeJS.Signals;
  maxBuffer: number;
  encoding: BufferEncoding;
};

/**
 * Ein einzelner Prozesslauf: Datei, Argumente, Optionen rein — stdout/stderr raus,
 * oder eine Ausnahme bei ENOENT/Absturz/Zeitüberschreitung. Als eigener Typ, damit
 * Tests genau DIESEN Aufruf durch einen Fake ersetzen können, statt einen echten
 * `tesseract` auf der Maschine zu brauchen, auf der die Tests laufen (dieselbe
 * `fetchImpl`-Spritze wie beim Cloud-Anbieter, siehe extraction/openai-compat.ts).
 */
export type ExecFileImpl = (
  file: string,
  args: string[],
  options: ExecFileOptions,
  stdin?: Buffer
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Wie unten `echtesExecFile`, aber fuer den Fall, dass Bilddaten ueber die
 * Standardeingabe an Tesseract gehen (kein Dateipfad, siehe `ocrLesen` mit einem
 * `Buffer` statt einem `string`). `execFile`/`util.promisify(execFile)` bietet keine
 * Moeglichkeit, dem Kindprozess selbst etwas auf stdin zu schreiben -- das kann nur
 * `spawn`, weil dort das `ChildProcess`-Objekt (und damit `.stdin`) VOR Prozessende
 * zugaenglich ist. Zeitlimit und Kill-Signal werden deshalb hier von Hand
 * nachgebildet, mit demselben Fehler-Vertrag wie beim `execFile`-Pfad
 * (`err.killed = true` bei Zeitueberschreitung, `err.stderr` bei einem regulaeren
 * Absturz, ein ENOENT-Fehlerobjekt bei fehlendem Binary) -- nur so kann die
 * catch-Behandlung in `ocrLesen` beide Ausfuehrungswege mit derselben Logik
 * unterscheiden.
 *
 * UNVERIFIZIERT gegen ein echtes `tesseract`-Binary (siehe Task-1-Bericht: auf dieser
 * Maschine nicht installiert, Docker-Build fuer diese Aufgabe ebenfalls untersagt) --
 * nur die Weiterleitung von Argumenten/stdin ist ueber die injizierte `execFileImpl`
 * (Tests) abgesichert, nicht das tatsaechliche Prozessverhalten.
 */
function spawnMitStdin(
  file: string,
  args: string[],
  options: ExecFileOptions,
  stdin: Buffer
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let erledigt = false;
    let zeitUeberschritten = false;

    const kind = spawn(file, args);

    const timer = setTimeout(() => {
      zeitUeberschritten = true;
      kind.kill(options.killSignal);
    }, options.timeout);
    timer.unref?.();

    const stdoutTeile: Buffer[] = [];
    const stderrTeile: Buffer[] = [];
    let stdoutLaenge = 0;

    function beenden(fn: () => void) {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(timer);
      fn();
    }

    // ENOENT (Binary fehlt) und andere Spawn-Fehler landen hier -- derselbe Fehlerpfad
    // wie bei `execFile`, damit `ocrLesen` beide Wege identisch behandeln kann.
    kind.on('error', (fehler: NodeJS.ErrnoException) => {
      beenden(() => reject(fehler));
    });

    kind.stdout.on('data', (chunk: Buffer) => {
      stdoutLaenge += chunk.length;
      if (stdoutLaenge > options.maxBuffer) {
        beenden(() => {
          kind.kill(options.killSignal);
          reject(new Error('tesseract: stdout maxBuffer length exceeded'));
        });
        return;
      }
      stdoutTeile.push(chunk);
    });
    kind.stderr.on('data', (chunk: Buffer) => stderrTeile.push(chunk));

    // Ein Schreibfehler auf stdin (z. B. EPIPE, wenn der Prozess schon vor dem
    // Schreiben abgestuerzt ist) darf nicht als unbehandeltes 'error'-Ereignis
    // durchschlagen -- den eigentlichen Fehler meldet ohnehin 'close' ueber den
    // Exit-Code.
    kind.stdin.on('error', () => {});

    kind.on('close', (code) => {
      const stdout = Buffer.concat(stdoutTeile).toString(options.encoding);
      const stderr = Buffer.concat(stderrTeile).toString(options.encoding);
      if (zeitUeberschritten) {
        beenden(() => {
          const fehler = new Error('terminated') as Error & { killed: boolean; stderr: string };
          fehler.killed = true;
          fehler.stderr = stderr;
          reject(fehler);
        });
        return;
      }
      if (code !== 0) {
        beenden(() => {
          const fehler = new Error(`Command failed: ${file}`) as NodeJS.ErrnoException & {
            stderr: string;
          };
          fehler.stderr = stderr;
          reject(fehler);
        });
        return;
      }
      beenden(() => resolve({ stdout, stderr }));
    });

    kind.stdin.write(stdin);
    kind.stdin.end();
  });
}

const echtesExecFile: ExecFileImpl = (file, args, options, stdin) => {
  if (stdin === undefined) {
    // node:util.promisify(execFile) ist auf mehrere Options-Formen ueberladen (Buffer
    // vs. String je nach `encoding`); der Cast ist unbedenklich, weil `encoding` hier
    // immer fest auf 'utf8' steht (siehe options unten in ocrLesen).
    return execFileAsync(file, args, options) as unknown as Promise<{
      stdout: string;
      stderr: string;
    }>;
  }
  return spawnMitStdin(file, args, options, stdin);
};

function kuerzeUndSaeubere(text: string): string {
  // Keine Zeilenumbrueche/Mehrfach-Leerraum in einer Log-/Review-Zeile, und eine feste
  // Obergrenze — Stderr eines abgestuerzten Prozesses kann beliebig lang sein, und
  // diese Meldung landet potenziell in einem Review-Bildschirm oder einem Matrix-Alert.
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function alsFehlerMitFeldern(e: unknown): NodeJS.ErrnoException & { killed?: boolean; stderr?: string } {
  return e as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
}

/**
 * Ruft Tesseract auf `bildPfad` auf und liefert den erkannten Text.
 *
 * Tesseract ist ein externes Programm, keine Bibliothek: es kann auf diesem Rechner
 * fehlen, an einem kaputten Bild abstürzen, oder hängen bleiben. Keiner dieser Fälle
 * darf eine Ausnahme werfen, die einen Bon ins Leere laufen lässt — ein Fehler HIER
 * darf niemals einen Bon verlieren (Aufgabenstellung, siehe auch Entwurf E3/E6: kein
 * stiller Rückfall, kein Verlust). Diese Funktion wirft deshalb NIE; sie liefert
 * stattdessen einen von drei klar unterscheidbaren Zuständen:
 *
 *  - `gelesen`        — Tesseract ist sauber durchgelaufen und hat Text geliefert. Ob
 *                       dieser Text als BON taugt, entscheidet NICHT diese Funktion,
 *                       sondern `pruefeOcrQualitaet` in `qualitaet.ts` — das ist eine
 *                       inhaltliche Frage, keine Ausführungsfrage.
 *  - `nichtsGefunden` — Tesseract ist sauber durchgelaufen, hat aber nur Leerraum
 *                       geliefert (z. B. ein weißes oder komplett unscharfes Bild).
 *                       Anders als `werkzeugKaputt`: das Werkzeug hat seine Arbeit
 *                       getan, es gab nur nichts zu finden.
 *  - `werkzeugKaputt` — Tesseract fehlt, ist abgestürzt oder hat das Zeitlimit
 *                       überschritten. `grund` ist eine kurze, sichere Beschreibung für
 *                       Log/Review — nie der rohe Stderr-Text in voller Länge (dieselbe
 *                       Regel wie beim Cloud-Anbieter, siehe openai-compat.ts).
 *
 * Sprache `deu` und `--psm 6` sind GEMESSEN, nicht geraten (Entwurf E1): an denselben
 * Testbildern lieferte `--psm 6` (einheitlicher Textblock) vollständige Treffer, wo ein
 * anderer Modus versagte.
 *
 * `bildPfadOderPuffer` nimmt seit Aufgabe 2 ZUSÄTZLICH einen `Buffer` an: der
 * Textweg-Anbieter (`extraction/ocr-text-provider.ts`) bekommt sein Bild als Puffer
 * (aus der Bild-Ablage) und soll keine temporäre Datei anlegen müssen, nur um sie
 * sofort wieder Tesseract vorzuwerfen. Gegen `node:22-bookworm-slim` mit echten Bons
 * geprüft (2026-09-15, siehe Entwurf): Tesseract liest von der Standardeingabe
 * (`tesseract - stdout ...`) und versteht WebP dabei direkt, ohne Umwandlung. Der
 * bestehende Pfad-Weg (ein `string`) bleibt unverändert bestehen.
 */
export function ocrLesen(
  bildPfadOderPuffer: string | Buffer,
  opts?: { timeoutMs?: number; execFileImpl?: ExecFileImpl; format?: 'text' | 'tsv' }
): Promise<OcrErgebnis> {
  const timeoutMs = opts?.timeoutMs ?? OCR_ZEITLIMIT_MS;
  const ausfuehren = opts?.execFileImpl ?? echtesExecFile;
  // "-" weist Tesseract an, das Bild von der Standardeingabe statt von einer Datei zu
  // lesen (GEMESSEN, siehe Kommentar oben) — der eigentliche Puffer geht als viertes
  // Argument an `ausfuehren`, nicht in die Argumentliste. `Buffer.isBuffer(...)` wird
  // bewusst zweimal INLINE aufgerufen (statt in einer Variablen zwischengespeichert):
  // nur inline verengt TypeScript den jeweiligen Zweig auf `Buffer` bzw. `string`.
  const quelle = Buffer.isBuffer(bildPfadOderPuffer) ? '-' : bildPfadOderPuffer;

  return ausfuehren(
    'tesseract',
    // "stdout" statt eines Dateinamens weist Tesseract an, den Text auf die
    // Standardausgabe zu schreiben, statt eine .txt-Datei danebenzulegen.
    // "tsv" ist bei tesseract KEIN Schalter, sondern eine Konfigurationsangabe und
    // gehoert deshalb ans ENDE der Argumentliste — `tesseract - tsv ...` liefert eine
    // leere Ausgabe ohne Fehlermeldung (am 2026-09-16 im ausgelieferten Abbild
    // nachgemessen). Ohne `format` bleibt die Argumentliste ZEICHENGLEICH wie bisher.
    [quelle, 'stdout', '-l', 'deu', '--psm', '6', ...(opts?.format === 'tsv' ? ['tsv'] : [])],
    { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' },
    Buffer.isBuffer(bildPfadOderPuffer) ? bildPfadOderPuffer : undefined
  )
    .then(({ stdout }): OcrErgebnis => {
      const text = stdout.trim();
      return text === '' ? { status: 'nichtsGefunden' } : { status: 'gelesen', text };
    })
    .catch((error: unknown): OcrErgebnis => {
      const fehler = alsFehlerMitFeldern(error);

      if (fehler?.code === 'ENOENT') {
        return {
          status: 'werkzeugKaputt',
          grund: 'tesseract ist auf diesem Rechner nicht installiert (ENOENT)'
        };
      }
      // execFile setzt bei einer erzwungenen Beendigung (Zeitlimit ODER ein externes
      // Signal) `killed`, aber NICHT bei einem regulären Absturz mit Exit-Code — genau
      // die Unterscheidung, die ein Aufrufer braucht, um "hing" von "kaputtes Bild" zu
      // trennen, auch wenn hier (Rückgabetyp) beides als `werkzeugKaputt` gilt.
      if (fehler?.killed) {
        return {
          status: 'werkzeugKaputt',
          grund: `tesseract hat das Zeitlimit von ${timeoutMs} ms überschritten und wurde beendet`
        };
      }
      const detail = kuerzeUndSaeubere(fehler?.stderr || fehler?.message || String(error));
      return { status: 'werkzeugKaputt', grund: `tesseract ist abgestürzt: ${detail}` };
    });
}
