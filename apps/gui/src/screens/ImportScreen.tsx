import { useState, type DragEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";

type Props = {
  demoPath: string | null;
  lobbyPath: string | null;
  parsing: boolean;
  error: string | null;
  onDemoPath: (path: string | null) => void;
  onLobbyPath: (path: string | null) => void;
  onParse: () => void;
  onBack: () => void;
  onOpenFaceit?: () => void;
};

export function ImportScreen({
  demoPath,
  lobbyPath,
  parsing,
  error,
  onDemoPath,
  onLobbyPath,
  onParse,
  onBack,
  onOpenFaceit,
}: Props) {
  const [dragOver, setDragOver] = useState(false);

  async function pickDemo() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "CS2 Demo", extensions: ["dem"] }],
    });
    if (typeof selected === "string") {
      onDemoPath(selected);
    }
  }

  async function pickLobby() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof selected === "string") {
      onLobbyPath(selected);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file?.name.toLowerCase().endsWith(".dem")) {
      void pickDemo();
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 2 / 7</p>
        <h1>Importer la demo</h1>
        <p className="lede">
          Charge un fichier <code>.dem</code> FACEIT et optionnellement le screenshot du lobby
          (intro vidéo). Ou ouvre l’onglet FACEIT pour tracker des joueurs et récupérer des démos.
        </p>
      </header>

      <div
        className={dragOver ? "dropzone active" : "dropzone"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p>Sélectionne une demo CS2 (.dem)</p>
        <button type="button" onClick={pickDemo} disabled={parsing}>
          Choisir un fichier…
        </button>
        {demoPath ? <code className="path">{demoPath}</code> : <p className="hint">Aucun fichier</p>}
      </div>

      <div className="field-block">
        <label>Screenshot lobby FACEIT (optionnel pour l’étape 2)</label>
        <div className="inline-actions">
          <button type="button" onClick={pickLobby} disabled={parsing}>
            Choisir une image…
          </button>
          {lobbyPath && (
            <button type="button" className="linkish" onClick={() => onLobbyPath(null)}>
              Retirer
            </button>
          )}
        </div>
        {lobbyPath ? <code className="path">{lobbyPath}</code> : <p className="hint">Pas encore choisi</p>}
      </div>

      {parsing && <p className="status">Parsing en cours (demoparser2)…</p>}
      {error && <p className="error">{error}</p>}

      <footer className="actions">
        <button type="button" onClick={onBack} disabled={parsing}>
          Retour
        </button>
        {onOpenFaceit && (
          <button type="button" className="btn-faceit" onClick={onOpenFaceit} disabled={parsing}>
            Joueurs FACEIT…
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={!demoPath || parsing}
          onClick={onParse}
        >
          Parser la demo
        </button>
      </footer>
    </section>
  );
}
