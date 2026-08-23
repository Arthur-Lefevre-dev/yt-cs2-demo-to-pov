type Props = {
  running: boolean;
  dryRun: boolean;
  runCsdm: boolean;
  introSeconds: number;
  csdmReady: boolean;
  csdmPath: string | null;
  logs: string[];
  logsOpen: boolean;
  error: string | null;
  onDryRunChange: (value: boolean) => void;
  onRunCsdmChange: (value: boolean) => void;
  onIntroSecondsChange: (value: number) => void;
  onLogsOpenChange: (value: boolean) => void;
  onStart: () => void;
  onBack: () => void;
};

export function RenderScreen({
  running,
  dryRun,
  runCsdm,
  introSeconds,
  csdmReady,
  csdmPath,
  logs,
  logsOpen,
  error,
  onDryRunChange,
  onRunCsdmChange,
  onIntroSecondsChange,
  onLogsOpenChange,
  onStart,
  onBack,
}: Props) {
  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 5 / 6</p>
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
        <label className={`option${csdmReady ? "" : " option-disabled"}`}>
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
