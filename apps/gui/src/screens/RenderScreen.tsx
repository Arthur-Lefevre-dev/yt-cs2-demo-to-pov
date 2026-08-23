import { open } from "@tauri-apps/plugin-dialog";

type Props = {
  running: boolean;
  dryRun: boolean;
  runCsdm: boolean;
  introSeconds: number;
  commercialPath: string | null;
  commercialLabel: string;
  csdmReady: boolean;
  csdmPath: string | null;
  logs: string[];
  logsOpen: boolean;
  error: string | null;
  onDryRunChange: (value: boolean) => void;
  onRunCsdmChange: (value: boolean) => void;
  onIntroSecondsChange: (value: number) => void;
  onCommercialPathChange: (value: string | null) => void;
  onCommercialLabelChange: (value: string) => void;
  onLogsOpenChange: (value: boolean) => void;
  onStart: () => void;
  onBack: () => void;
};

export function RenderScreen({
  running,
  dryRun,
  runCsdm,
  introSeconds,
  commercialPath,
  commercialLabel,
  csdmReady,
  csdmPath,
  logs,
  logsOpen,
  error,
  onDryRunChange,
  onRunCsdmChange,
  onIntroSecondsChange,
  onCommercialPathChange,
  onCommercialLabelChange,
  onLogsOpenChange,
  onStart,
  onBack,
}: Props) {
  async function pickCommercial() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Vidéo", extensions: ["mp4", "mov", "mkv", "webm"] }],
    });
    if (typeof selected === "string") {
      onCommercialPathChange(selected);
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 5 / 7</p>
        <h1>Rendu</h1>
        <p className="lede">
          Génère les configs CSDM, le chapitrage estimé, et optionnellement lance
          HLAE ou assemble des clips déjà présents.
        </p>
      </header>

      <div className="options-grid">
        <label className="option">
          <input
            type="checkbox"
            checked={dryRun}
            disabled={running}
            onChange={(event) => {
              const next = event.target.checked;
              onDryRunChange(next);
              if (next) {
                onRunCsdmChange(false);
              }
            }}
          />
          <span>
            <strong>Dry-run</strong>
            <em>Configs JSON + chapitres estimés uniquement (recommandé pour tester)</em>
          </span>
        </label>
        <label className="option">
          <input
            type="checkbox"
            checked={runCsdm}
            disabled={running || !csdmReady}
            onChange={(event) => {
              const next = event.target.checked;
              onRunCsdmChange(next);
              if (next) {
                onDryRunChange(false);
              }
            }}
          />
          <span>
            <strong>Lancer CSDM / HLAE</strong>
            <em>
              {csdmReady
                ? `Enregistre vraiment CS2 (${csdmPath ?? "csdm"}) — ne pas toucher souris/clavier. Cocher ici désactive le dry-run.`
                : "CSDM non détecté (cherche csdm.cmd). Va dans Prérequis → Rescanner."}
            </em>
          </span>
        </label>
        {!dryRun && !runCsdm && (
          <p className="hint">
            Sans dry-run ni CSDM : génère les JSON et assemble les mp4 déjà
            présents dans le dossier job (utile après un enregistrement).
          </p>
        )}
        {!dryRun && runCsdm && (
          <p className="warn">
            Attention : l’enregistrement HLAE prend longtemps (surtout avec tous les
            rounds) et monopolise CS2. Commence par 1 round pour tester.
          </p>
        )}
        <label className="option field">
          <span>Intro lobby (secondes)</span>
          <input
            type="number"
            min={1}
            max={30}
            value={introSeconds}
            disabled={running}
            onChange={(event) => onIntroSecondsChange(Number(event.target.value) || 4)}
          />
        </label>
        <label className="option field">
          <span>Placement commercial (après Round 1)</span>
          <div className="inline-actions">
            <button type="button" onClick={() => void pickCommercial()} disabled={running}>
              Choisir vidéo…
            </button>
            {commercialPath && (
              <button
                type="button"
                onClick={() => onCommercialPathChange(null)}
                disabled={running}
              >
                Retirer
              </button>
            )}
            <code className="path">{commercialPath ?? "aucun"}</code>
          </div>
          <em className="hint" style={{ display: "block", marginTop: "0.35rem" }}>
            MP4/MOV optionnel, normalisé en 4K60 et inséré juste après le 1er round
            dans le final + chapitre YouTube.
          </em>
        </label>
        {commercialPath && (
          <label className="option field">
            <span>Label chapitre commercial</span>
            <input
              type="text"
              value={commercialLabel}
              disabled={running}
              placeholder="Sponsors"
              onChange={(event) => onCommercialLabelChange(event.target.value)}
            />
          </label>
        )}
      </div>

      {running && <p className="status">Pipeline en cours…</p>}
      {error && <p className="error">{error}</p>}

      <details
        className="logs-panel"
        open={logsOpen}
        onToggle={(event) => onLogsOpenChange((event.target as HTMLDetailsElement).open)}
      >
        <summary>Logs techniques ({logs.length})</summary>
        <pre className="logs-pre">{logs.length ? logs.join("\n") : "Aucun log pour l’instant."}</pre>
      </details>

      <footer className="actions">
        <button type="button" onClick={onBack} disabled={running}>
          Retour
        </button>
        <button type="button" className="primary" onClick={onStart} disabled={running}>
          {running
            ? "En cours…"
            : dryRun
              ? "Générer (dry-run)"
              : runCsdm
                ? "Lancer CSDM / HLAE"
                : "Générer configs"}
        </button>
      </footer>
    </section>
  );
}
