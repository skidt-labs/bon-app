import { describe, it, expect } from 'vitest';
import { ocrLesen, OCR_ZEITLIMIT_MS } from './lesen';
import type { ExecFileImpl } from './lesen';

function enoentFehler(): NodeJS.ErrnoException {
  const fehler: NodeJS.ErrnoException = new Error('spawn tesseract ENOENT');
  fehler.code = 'ENOENT';
  return fehler;
}

function timeoutFehler(): Error & { killed: boolean } {
  const fehler = new Error('terminated') as Error & { killed: boolean };
  fehler.killed = true;
  return fehler;
}

function absturzFehler(stderr: string): Error & { code: number; stderr: string } {
  const fehler = new Error('Command failed') as Error & { code: number; stderr: string };
  fehler.code = 1;
  fehler.stderr = stderr;
  return fehler;
}

describe('ocrLesen', () => {
  it('ruft tesseract mit Sprache deu und --psm 6 auf demselben Bildpfad auf — GEMESSEN, nicht geraten (Entwurf E1)', async () => {
    let gesehen: { file: string; args: string[] } | undefined;
    const execFileImpl: ExecFileImpl = async (file, args) => {
      gesehen = { file, args };
      return { stdout: 'Text', stderr: '' };
    };

    await ocrLesen('/bilder/bon.webp', { execFileImpl });

    expect(gesehen).toEqual({
      file: 'tesseract',
      args: ['/bilder/bon.webp', 'stdout', '-l', 'deu', '--psm', '6']
    });
  });

  it('liefert status "gelesen" mit dem getrimmten Text bei Erfolg', async () => {
    const execFileImpl: ExecFileImpl = async () => ({ stdout: '  Erkannter Text\n\n', stderr: '' });

    const ergebnis = await ocrLesen('/bilder/bon.webp', { execFileImpl });

    expect(ergebnis).toEqual({ status: 'gelesen', text: 'Erkannter Text' });
  });

  it('liefert status "nichtsGefunden" bei sauberem Lauf ohne Textausbeute — kein Absturz, nur ein leeres Bild', async () => {
    const execFileImpl: ExecFileImpl = async () => ({
      stdout: '   \n',
      stderr: 'Estimating resolution as 70\n'
    });

    const ergebnis = await ocrLesen('/bilder/bon.webp', { execFileImpl });

    expect(ergebnis).toEqual({ status: 'nichtsGefunden' });
  });

  it('liefert status "werkzeugKaputt", wenn tesseract auf der Maschine fehlt (ENOENT)', async () => {
    const execFileImpl: ExecFileImpl = async () => {
      throw enoentFehler();
    };

    const ergebnis = await ocrLesen('/bilder/bon.webp', { execFileImpl });

    expect(ergebnis.status).toBe('werkzeugKaputt');
    if (ergebnis.status === 'werkzeugKaputt') {
      expect(ergebnis.grund).toMatch(/nicht installiert/);
    }
  });

  it('liefert status "werkzeugKaputt" bei Zeitüberschreitung — unterscheidbar von einem Absturz', async () => {
    const execFileImpl: ExecFileImpl = async () => {
      throw timeoutFehler();
    };

    const ergebnis = await ocrLesen('/bilder/bon.webp', { timeoutMs: 5_000, execFileImpl });

    expect(ergebnis.status).toBe('werkzeugKaputt');
    if (ergebnis.status === 'werkzeugKaputt') {
      expect(ergebnis.grund).toMatch(/Zeitlimit/);
      expect(ergebnis.grund).toContain('5000');
    }
  });

  it('liefert status "werkzeugKaputt" bei einem Absturz an einem kaputten Bild, mit gekürztem Stderr im Grund', async () => {
    const execFileImpl: ExecFileImpl = async () => {
      throw absturzFehler('Error: Cannot read the input image');
    };

    const ergebnis = await ocrLesen('/bilder/bon.webp', { execFileImpl });

    expect(ergebnis.status).toBe('werkzeugKaputt');
    if (ergebnis.status === 'werkzeugKaputt') {
      expect(ergebnis.grund).toMatch(/Cannot read the input image/);
    }
  });

  it('kürzt einen sehr langen Stderr-Text auf eine handliche Länge (Log/Review, kein Roh-Dump)', async () => {
    const execFileImpl: ExecFileImpl = async () => {
      throw absturzFehler('x'.repeat(5_000));
    };

    const ergebnis = await ocrLesen('/bilder/bon.webp', { execFileImpl });

    expect(ergebnis.status).toBe('werkzeugKaputt');
    if (ergebnis.status === 'werkzeugKaputt') {
      expect(ergebnis.grund.length).toBeLessThan(400);
    }
  });

  it('nutzt ohne eigene Angabe das Standard-Zeitlimit', async () => {
    let gesehenesTimeout: number | undefined;
    const execFileImpl: ExecFileImpl = async (_file, _args, options) => {
      gesehenesTimeout = options.timeout;
      return { stdout: 'Text', stderr: '' };
    };

    await ocrLesen('/bilder/bon.webp', { execFileImpl });

    expect(gesehenesTimeout).toBe(OCR_ZEITLIMIT_MS);
  });

  it('wirft nie — auch ein völlig unerwarteter Fehlerwert ergibt "werkzeugKaputt"', async () => {
    const execFileImpl: ExecFileImpl = async () => {
      throw 'irgendwas Unerwartetes';
    };

    const ergebnis = await ocrLesen('/bilder/bon.webp', { execFileImpl });

    expect(ergebnis.status).toBe('werkzeugKaputt');
  });

  // Aufgabe 2: der Textweg-Anbieter reicht sein Bild als Puffer durch, ohne eine
  // temporäre Datei zu schreiben — GEMESSEN gegen node:22-bookworm-slim mit echten
  // Bons (2026-09-15, siehe Entwurf E1/Aufgabe 2): Tesseract liest von der
  // Standardeingabe ("-") und versteht WebP dabei direkt.
  describe('mit einem Puffer statt einem Dateipfad', () => {
    it('ruft tesseract mit "-" statt einem Pfad auf und übergibt den Puffer als viertes Argument', async () => {
      let gesehenerAufruf: { file: string; args: string[] } | undefined;
      let gesehenerStdin: Buffer | undefined;
      const puffer = Buffer.from('fake-webp-bytes');
      const execFileImpl: ExecFileImpl = async (file, args, _options, stdin) => {
        gesehenerAufruf = { file, args };
        gesehenerStdin = stdin;
        return { stdout: 'Text', stderr: '' };
      };

      await ocrLesen(puffer, { execFileImpl });

      expect(gesehenerAufruf).toEqual({
        file: 'tesseract',
        args: ['-', 'stdout', '-l', 'deu', '--psm', '6']
      });
      expect(gesehenerStdin).toBe(puffer);
    });

    it('liefert bei Erfolg denselben Tri-State wie der Pfad-Weg', async () => {
      const execFileImpl: ExecFileImpl = async () => ({ stdout: '  Erkannter Text\n', stderr: '' });

      const ergebnis = await ocrLesen(Buffer.from('x'), { execFileImpl });

      expect(ergebnis).toEqual({ status: 'gelesen', text: 'Erkannter Text' });
    });

    it('reicht bei einem Pfad-Aufruf KEINEN vierten Parameter durch (bestehender Weg unverändert)', async () => {
      let gesehenerStdin: Buffer | undefined = Buffer.from('sollte ueberschrieben werden');
      const execFileImpl: ExecFileImpl = async (_file, _args, _options, stdin) => {
        gesehenerStdin = stdin;
        return { stdout: 'Text', stderr: '' };
      };

      await ocrLesen('/bilder/bon.webp', { execFileImpl });

      expect(gesehenerStdin).toBeUndefined();
    });
  });
});
