import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ThumbnailResult } from "../types";

type Props = {
  playerName: string;
  mapName: string;
  kills: number;
  deaths: number;
  workDir: string | null;
  onBack: () => void;
  onRestart: () => void;
};

export function ThumbnailScreen({
  playerName: initialName,
  mapName,
  kills,
  deaths,
  workDir,
  onBack,
  onRestart,
}: Props) {
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(initialName);
  const [score, setScore] = useState(`${kills}-${deaths}`);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ThumbnailResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function pickPhoto() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof selected === "string") {
      setPhotoPath(selected);
    }
  }

  async function generate() {
    if (!photoPath) {
      setError("Choisis une photo du joueur.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const generated = await invoke<ThumbnailResult>("generate_thumbnails", {
        request: {
          playerPhotoPath: photoPath,
          playerName: displayName,
          mapName,
          kills,
          deaths,
          score,
          workDir,
          outDir: null,
        },
      });
      setResult(generated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function copyTitle() {
    if (!result?.title) {
      return;
    }
    await navigator.clipboard.writeText(result.title);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function openFolder() {
    if (!result?.outDir) {
      return;
    }
    await invoke("open_in_explorer", { path: result.outDir });
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 7 / 7</p>
        <h1>Miniatures YouTube</h1>
        <p className="lede">
          3 variantes A/B + titre. Fonds maps :{" "}
          <code>fixtures/thumbnails/maps/&lt;map&gt;/</code>
        </p>
      </header>

      <div className="options-grid">
        <label className="option field">
          <span>Photo joueur (découpe PNG conseillée)</span>
          <div className="inline-actions">
            <button type="button" onClick={() => void pickPhoto()} disabled={running}>
              Choisir…
            </button>
            <code className="path">{photoPath ?? "aucune"}</code>
          </div>
        </label>
        <label className="option field">
          <span>Nom affiché</span>
          <input
            type="text"
            value={displayName}
            disabled={running}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="option field">
          <span>Score (ex. 16-18)</span>
          <input
            type="text"
            value={score}
            disabled={running}
            onChange={(event) => setScore(event.target.value)}
          />
        </label>
        <p className="hint">
          Map : <strong>{mapName || "?"}</strong> — image tirée au hasard dans le dossier
          correspondant.
        </p>
      </div>

      {error && <p className="error">{error}</p>}
      {running && <p className="status">Génération des 3 miniatures…</p>}

      {result && (
        <div className="thumb-results">
          <div className="panel">
            <div className="prereq-top">
              <h2>Titre YouTube</h2>
              <button type="button" className="primary" onClick={() => void copyTitle()}>
                {copied ? "Copié" : "Copier"}
              </button>
            </div>
            <pre className="chapters-pre">{result.title}</pre>
            <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
              <button type="button" onClick={() => void openFolder()}>
                Ouvrir le dossier
              </button>
            </div>
          </div>
          <div className="thumb-grid">
            {result.variants.map((variant) => (
              <figure key={variant.id} className="thumb-card">
                <img src={variant.dataUrl} alt={`Variante ${variant.index}`} />
                <figcaption>
                  V{variant.index} — {variant.id}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <footer className="actions">
        <button type="button" onClick={onBack} disabled={running}>
          Retour résultat
        </button>
        <button type="button" onClick={onRestart} disabled={running}>
          Nouveau job
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void generate()}
          disabled={running || !photoPath || !displayName.trim()}
        >
          {running ? "Génération…" : "Générer 3 miniatures"}
        </button>
      </footer>
    </section>
  );
}
