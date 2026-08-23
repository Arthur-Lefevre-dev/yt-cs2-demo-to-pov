import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ScreenshotProposal, ThumbnailResult } from "../types";

type Props = {
  playerName: string;
  mapName: string;
  kills: number;
  deaths: number;
  rounds: number;
  rating: number | null;
  matchKind: string | null;
  eventName: string | null;
  teamCt: string | null;
  teamT: string | null;
  playerSide: string | null;
  workDir: string | null;
  videoPath: string | null;
  onBack: () => void;
  onRestart: () => void;
};

function buildMatchup(teamCt: string | null, teamT: string | null, playerSide: string | null) {
  const ct = teamCt?.trim() || "";
  const t = teamT?.trim() || "";
  if (!ct && !t) {
    return "";
  }
  if (ct && !t) {
    return ct;
  }
  if (t && !ct) {
    return t;
  }
  if (playerSide === "CT") {
    return `${ct} vs ${t}`;
  }
  if (playerSide === "T") {
    return `${t} vs ${ct}`;
  }
  return `${ct} vs ${t}`;
}

export function ThumbnailScreen({
  playerName: initialName,
  mapName,
  kills,
  deaths,
  rounds,
  rating,
  matchKind,
  eventName: initialEvent,
  teamCt,
  teamT,
  playerSide,
  workDir,
  videoPath,
  onBack,
  onRestart,
}: Props) {
  const isTournament = matchKind !== "faceit" && matchKind !== "premier";
  const isFaceit = matchKind === "faceit";
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [teamLogoPath, setTeamLogoPath] = useState<string | null>(null);
  const [showBrandLogo, setShowBrandLogo] = useState(true);
  const [displayName, setDisplayName] = useState(initialName);
  const [score, setScore] = useState(`${kills}-${deaths}`);
  const [eventName, setEventName] = useState(initialEvent ?? "");
  const [matchup, setMatchup] = useState(() => buildMatchup(teamCt, teamT, playerSide));
  const [useScreenshots, setUseScreenshots] = useState(false);
  const [proposals, setProposals] = useState<ScreenshotProposal[]>([]);
  const [selectedBgIds, setSelectedBgIds] = useState<string[]>([]);
  const [proposing, setProposing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ThumbnailResult | null>(null);
  const [copied, setCopied] = useState(false);

  const contextPreview = useMemo(() => {
    if (isFaceit) {
      return "FACEIT POV";
    }
    if (matchKind === "premier") {
      return "PREMIER POV";
    }
    if (eventName.trim()) {
      return eventName.trim();
    }
    if (matchup.trim()) {
      return matchup.trim();
    }
    return null;
  }, [isFaceit, matchKind, eventName, matchup]);

  const titlePreview = useMemo(() => {
    const parts = [`${displayName || "Player"} (${score || "0-0"})`, mapName.replace(/^de_/i, ""), "POV"];
    if (isTournament) {
      if (eventName.trim()) {
        parts.push(eventName.trim());
      }
      if (matchup.trim()) {
        parts.push(matchup.trim());
      }
    }
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    parts.push(`${day}/${month}/${now.getFullYear()}`);
    return parts.join(" ");
  }, [displayName, score, mapName, isTournament, eventName, matchup]);

  async function pickPhoto() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof selected === "string") {
      setPhotoPath(selected);
    }
  }

  async function pickTeamLogo() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
    });
    if (typeof selected === "string") {
      setTeamLogoPath(selected);
    }
  }

  async function proposeScreenshots() {
    if (!workDir) {
      setError("Aucun dossier job — termine un render avant de proposer des screenshots.");
      return;
    }
    setProposing(true);
    setError(null);
    try {
      const proposed = await invoke<{
        outDir: string;
        count: number;
        proposals: ScreenshotProposal[];
      }>("propose_thumbnail_screenshots", {
        request: {
          workDir,
          videoPath,
          outDir: null,
          count: 10,
        },
      });
      setProposals(proposed.proposals ?? []);
      setSelectedBgIds([]);
      setUseScreenshots(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProposing(false);
    }
  }

  function toggleProposal(id: string) {
    setSelectedBgIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((entry) => entry !== id);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  }

  async function generate() {
    if (!photoPath) {
      setError("Choisis une photo du joueur.");
      return;
    }
    if (useScreenshots && selectedBgIds.length !== 3) {
      setError("Sélectionne exactement 3 screenshots pour les fonds (ou désactive l’option).");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const backgroundPaths = useScreenshots
        ? selectedBgIds
            .map((id) => proposals.find((p) => p.id === id)?.path)
            .filter((path): path is string => Boolean(path))
        : null;

      const generated = await invoke<ThumbnailResult>("generate_thumbnails", {
        request: {
          playerPhotoPath: photoPath,
          teamLogoPath,
          showBrandLogo,
          playerName: displayName,
          mapName,
          kills,
          deaths,
          rounds,
          rating,
          score,
          matchKind: matchKind ?? (isTournament ? "tournament" : null),
          eventName: isTournament ? eventName.trim() || null : null,
          matchup: isTournament ? matchup.trim() || null : null,
          backgroundPaths,
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
    const text = result?.title ?? titlePreview;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function openFolder() {
    if (!result?.outDir) {
      return;
    }
    await invoke("open_in_explorer", { path: result.outDir });
  }

  const busy = running || proposing;

  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 7 / 7</p>
        <h1>Miniatures YouTube</h1>
        <p className="lede">
          3 variantes A/B + titre. Logo 4K optionnel en haut à gauche (
          <code>fixtures/thumbnails/brand/4k-logo.png</code>). Fonds map ou screenshots POV.
        </p>
      </header>

      <div className="options-grid">
        <label className="option field">
          <span>Photo joueur (découpe PNG conseillée)</span>
          <div className="inline-actions">
            <button type="button" onClick={() => void pickPhoto()} disabled={busy}>
              Choisir…
            </button>
            <code className="path">{photoPath ?? "aucune"}</code>
          </div>
        </label>
        <label className="option field">
          <span>Logo équipe (optionnel, filigrane derrière le joueur)</span>
          <div className="inline-actions">
            <button type="button" onClick={() => void pickTeamLogo()} disabled={busy}>
              Choisir…
            </button>
            {teamLogoPath && (
              <button type="button" onClick={() => setTeamLogoPath(null)} disabled={busy}>
                Retirer
              </button>
            )}
            <code className="path">{teamLogoPath ?? "aucun"}</code>
          </div>
        </label>
        <label className="option field inline-check">
          <input
            type="checkbox"
            checked={showBrandLogo}
            disabled={busy}
            onChange={(event) => setShowBrandLogo(event.target.checked)}
          />
          Afficher le logo 4K (haut gauche)
        </label>
        <label className="option field">
          <span>Nom affiché</span>
          <input
            type="text"
            value={displayName}
            disabled={busy}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="option field">
          <span>Score (ex. 16-18)</span>
          <input
            type="text"
            value={score}
            disabled={busy}
            onChange={(event) => setScore(event.target.value)}
          />
        </label>
        {isTournament && (
          <>
            <label className="option field">
              <span>Event / tournoi (affiché sur la miniature)</span>
              <input
                type="text"
                value={eventName}
                disabled={busy}
                placeholder="BLAST.tv"
                onChange={(event) => setEventName(event.target.value)}
              />
            </label>
            <label className="option field">
              <span>Matchup (Team A vs Team B)</span>
              <input
                type="text"
                value={matchup}
                disabled={busy}
                placeholder="Vitality vs Spirit"
                onChange={(event) => setMatchup(event.target.value)}
              />
            </label>
          </>
        )}
        {isFaceit && (
          <p className="hint">
            Miniature FACEIT : texte <strong>FACEIT POV</strong> sur l’image.
          </p>
        )}
        <p className="hint">
          Map : <strong>{mapName || "?"}</strong>
          {matchKind ? ` · source ${matchKind}` : ""}
          {rating != null ? ` · HLTV ${rating.toFixed(2)}` : rounds > 0 ? ` · ${rounds} rounds` : ""}
          {contextPreview ? ` · sur image : ${contextPreview}` : ""}
        </p>
        <p className="hint">
          Aperçu titre : <strong>{titlePreview}</strong>
        </p>
      </div>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <div className="prereq-top">
          <h2>Fond des miniatures</h2>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={useScreenshots}
              disabled={busy || proposals.length === 0}
              onChange={(event) => setUseScreenshots(event.target.checked)}
            />
            Utiliser 3 screenshots sélectionnés
          </label>
        </div>
        <p className="hint">
          Propose 10 frames depuis <code>final.mp4</code> / clips CSDM, puis choisis-en exactement 3
          (une par variante). Sinon : pool de fonds map.
        </p>
        <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="primary"
            onClick={() => void proposeScreenshots()}
            disabled={busy || !workDir}
          >
            {proposing ? "Extraction…" : "Proposer 10 screenshots"}
          </button>
          {selectedBgIds.length > 0 && (
            <span className="hint">
              Sélectionnés : {selectedBgIds.length}/3
            </span>
          )}
        </div>
        {proposals.length > 0 && (
          <div className="proposal-grid">
            {proposals.map((proposal) => {
              const selected = selectedBgIds.includes(proposal.id);
              const order = selected ? selectedBgIds.indexOf(proposal.id) + 1 : null;
              return (
                <button
                  key={proposal.id}
                  type="button"
                  className={`proposal-card${selected ? " selected" : ""}`}
                  disabled={busy}
                  onClick={() => toggleProposal(proposal.id)}
                >
                  <img src={proposal.dataUrl} alt={proposal.label} />
                  <span>
                    {order != null ? `#${order} · ` : ""}
                    {proposal.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
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
            {result.ratingLabel && (
              <p className="hint" style={{ marginTop: "0.5rem" }}>
                Affiché sur miniature : {result.ratingLabel}
              </p>
            )}
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
        <button type="button" onClick={onBack} disabled={busy}>
          Retour résultat
        </button>
        <button type="button" onClick={onRestart} disabled={busy}>
          Nouveau job
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void generate()}
          disabled={
            busy ||
            !photoPath ||
            !displayName.trim() ||
            (useScreenshots && selectedBgIds.length !== 3)
          }
        >
          {running ? "Génération…" : "Générer 3 miniatures"}
        </button>
      </footer>
    </section>
  );
}
