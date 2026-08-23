import { useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import type { PipelineResult } from "../types";

type Props = {
  result: PipelineResult;
  onBack: () => void;
  onRestart: () => void;
};

export function ResultScreen({ result, onBack, onRestart }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyChapters() {
    await navigator.clipboard.writeText(result.chaptersText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 6 / 6</p>
        <h1>Résultat</h1>
        <p className="lede">
          Mode <code>{result.mode}</code>
          {result.dryRun ? " (dry-run)" : ""} — {result.configPaths.length} config(s)
          CSDM générée(s).
        </p>
      </header>

      <div className="result-grid">
        <div className="panel">
          <h2>Fichiers</h2>
          <p className="hint">Dossier job</p>
          <code className="path">{result.workDir}</code>
          <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={() => void openPath(result.workDir)}>
              Ouvrir le dossier
            </button>
          </div>
          {result.videoPath && (
            <>
              <p className="hint" style={{ marginTop: "1rem" }}>
                Vidéo finale
              </p>
              <code className="path">{result.videoPath}</code>
              <div className="inline-actions" style={{ marginTop: "0.5rem" }}>
                <button type="button" onClick={() => void openPath(result.videoPath!)}>
                  Ouvrir la vidéo
                </button>
              </div>
            </>
          )}
          {!result.videoPath && (
            <p className="hint" style={{ marginTop: "1rem" }}>
              Pas de vidéo finale (dry-run ou clips HLAE absents). Les JSON CSDM
              sont prêts pour un <code>--run</code> ultérieur.
            </p>
          )}
        </div>

        <div className="panel">
          <div className="prereq-top">
            <h2>Chapitrage YouTube</h2>
            <button type="button" className="primary" onClick={() => void copyChapters()}>
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
          {result.chaptersPath && (
            <p className="hint">{result.chaptersPath}</p>
          )}
          <pre className="chapters-pre">{result.chaptersText}</pre>
        </div>
      </div>

      <details className="logs-panel">
        <summary>Logs ({result.logs.length})</summary>
        <pre className="logs-pre">{result.logs.join("\n")}</pre>
      </details>

      <footer className="actions">
        <button type="button" onClick={onBack}>
          Retour rendu
        </button>
        <button type="button" className="primary" onClick={onRestart}>
          Nouveau job
        </button>
      </footer>
    </section>
  );
}
