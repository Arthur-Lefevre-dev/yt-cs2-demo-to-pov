import { openUrl } from "@tauri-apps/plugin-opener";
import type { PrerequisitesReport } from "../types";

type Props = {
  report: PrerequisitesReport | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onContinue: () => void;
};

export function SetupScreen({ report, loading, error, onRefresh, onContinue }: Props) {
  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 1 / 6</p>
        <h1>Prérequis</h1>
        <p className="lede">
          Détection locale de CS2, CSDM, HLAE, FFmpeg et Node. Le parsing de demo
          ne nécessite que Windows + Node ; le rendu vidéo demandera le reste.
        </p>
      </header>

      {loading && <p className="status">Scan en cours…</p>}
      {error && <p className="error">{error}</p>}

      {report && (
        <>
          <div className="status-row">
            <span className={report.readyForParse ? "badge ok" : "badge bad"}>
              Parse : {report.readyForParse ? "prêt" : "bloqué"}
            </span>
            <span className={report.readyForRender ? "badge ok" : "badge warn"}>
              Rendu : {report.readyForRender ? "prêt" : "incomplet"}
            </span>
            <span className="badge muted">OS : {report.osName}</span>
          </div>

          <ul className="prereq-list">
            {report.items.map((item) => (
              <li key={item.id} className={item.found ? "prereq ok" : "prereq missing"}>
                <div className="prereq-top">
                  <strong>
                    {item.found ? "OK" : item.required ? "MANQUANT" : "OPTIONNEL"} — {item.label}
                  </strong>
                  {item.installUrl && !item.found && (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => openUrl(item.installUrl!)}
                    >
                      Installer
                    </button>
                  )}
                </div>
                {item.path && <code className="path">{item.path}</code>}
                {item.hint && <p className="hint">{item.hint}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      <footer className="actions">
        <button type="button" onClick={onRefresh} disabled={loading}>
          Rescanner
        </button>
        <button
          type="button"
          className="primary"
          disabled={!report?.readyForParse || loading}
          onClick={onContinue}
        >
          Continuer vers l’import
        </button>
      </footer>
    </section>
  );
}
