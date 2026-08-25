import { useCallback, useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  FaceitBestMatchesResult,
  FaceitSettings,
  TrackedPlayer,
} from "../types";

type Props = {
  onBack: () => void;
  onUseDemo: (demoPath: string) => void;
  onUseLobby: (lobbyPath: string) => void;
};

export function FaceitScreen({ onBack, onUseDemo, onUseLobby }: Props) {
  const [settings, setSettings] = useState<FaceitSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [players, setPlayers] = useState<TrackedPlayer[]>([]);
  const [steamId, setSteamId] = useState("");
  const [nickname, setNickname] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [teamLogoPath, setTeamLogoPath] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [matches, setMatches] = useState<FaceitBestMatchesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [faceitSettings, listed] = await Promise.all([
        invoke<FaceitSettings>("get_faceit_settings"),
        invoke<{ players: TrackedPlayer[] }>("list_tracked_players"),
      ]);
      setSettings(faceitSettings);
      setPlayers(listed.players ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveApiKey() {
    setError(null);
    try {
      const next = await invoke<FaceitSettings>("save_faceit_api_key", {
        apiKey: apiKeyInput.trim(),
      });
      setSettings(next);
      setApiKeyInput("");
      setStatus("Clé FACEIT enregistrée.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

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

  async function addPlayer() {
    if (!steamId.trim()) {
      setError("SteamID64 requis.");
      return;
    }
    setError(null);
    try {
      await invoke("upsert_tracked_player", {
        request: {
          steamId: steamId.trim(),
          nickname: nickname.trim() || null,
          displayName: nickname.trim() || null,
          photoPath,
          teamLogoPath,
          faceitPlayerId: null,
          id: null,
        },
      });
      setSteamId("");
      setNickname("");
      setPhotoPath(null);
      setTeamLogoPath(null);
      setStatus("Joueur tracké enregistré.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removePlayer(id: string) {
    setError(null);
    try {
      await invoke("remove_tracked_player", { id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadMatches(nextPage = page) {
    setMatchesLoading(true);
    setError(null);
    try {
      const result = await invoke<FaceitBestMatchesResult>("list_faceit_best_matches", {
        request: {
          page: nextPage,
          pageSize: 10,
          perPlayer: 15,
        },
      });
      setMatches(result);
      setPage(result.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMatchesLoading(false);
    }
  }

  async function downloadAndUse(matchId: string, url: string) {
    setError(null);
    setStatus(`Téléchargement démo ${matchId}…`);
    try {
      const result = await invoke<{ path: string }>("download_faceit_demo", {
        request: {
          url,
          matchId,
          outPath: null,
        },
      });
      setStatus(`Démo prête : ${result.path}`);
      onUseDemo(result.path);
      // Also generate lobby screenshot for intro when possible.
      try {
        setStatus(`Démo OK — capture page lobby FACEIT…`);
        const lobby = await invoke<{ path: string }>("generate_faceit_lobby_screenshot", {
          request: { matchId, outPath: null },
        });
        onUseLobby(lobby.path);
        setStatus(`Démo + screenshot page FACEIT prêts.`);
      } catch (lobbyErr) {
        setStatus(
          `Démo OK. Screenshot page non capturé : ${lobbyErr instanceof Error ? lobbyErr.message : String(lobbyErr)}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    }
  }

  async function makeLobbyScreenshot(matchId: string) {
    setError(null);
    setStatus(`Capture page lobby FACEIT ${matchId}…`);
    try {
      const lobby = await invoke<{ path: string }>("generate_faceit_lobby_screenshot", {
        request: { matchId, outPath: null },
      });
      onUseLobby(lobby.path);
      setStatus(`Screenshot page enregistré : ${lobby.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">FACEIT</p>
        <h1>Joueurs trackés & démos</h1>
        <p className="lede">
          Enregistre des SteamID avec photo + logo équipe, puis liste les meilleurs matchs (Rating
          FACEIT) sur les 15 dernières parties de chaque joueur. Le screenshot lobby capture la vraie
          page web du room.
        </p>
      </header>

      <div className="panel">
        <h2>Clé API FACEIT</h2>
        <p className="hint">
          Crée une clé serveur sur{" "}
          <a href="https://developers.faceit.com/" target="_blank" rel="noreferrer">
            developers.faceit.com
          </a>
          . Stockage : <code>{settings?.apiKeyPath ?? "…"}</code>
          {settings?.hasApiKey ? " · clé détectée" : " · aucune clé"}
        </p>
        <div className="inline-actions">
          <input
            type="password"
            value={apiKeyInput}
            placeholder="Coller la clé API…"
            disabled={loading}
            onChange={(event) => setApiKeyInput(event.target.value)}
            style={{ minWidth: "16rem" }}
          />
          <button
            type="button"
            className="primary"
            disabled={loading || !apiKeyInput.trim()}
            onClick={() => void saveApiKey()}
          >
            Enregistrer
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <h2>Ajouter un joueur</h2>
        <div className="options-grid">
          <label className="option field">
            <span>SteamID64</span>
            <input
              type="text"
              value={steamId}
              disabled={loading}
              placeholder="7656119…"
              onChange={(event) => setSteamId(event.target.value)}
            />
          </label>
          <label className="option field">
            <span>Pseudo FACEIT (optionnel)</span>
            <input
              type="text"
              value={nickname}
              disabled={loading}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          <label className="option field">
            <span>Photo joueur</span>
            <div className="inline-actions">
              <button type="button" onClick={() => void pickPhoto()} disabled={loading}>
                Choisir…
              </button>
              <code className="path">{photoPath ?? "aucune"}</code>
            </div>
          </label>
          <label className="option field">
            <span>Logo équipe</span>
            <div className="inline-actions">
              <button type="button" onClick={() => void pickTeamLogo()} disabled={loading}>
                Choisir…
              </button>
              <code className="path">{teamLogoPath ?? "aucun"}</code>
            </div>
          </label>
        </div>
        <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="primary" onClick={() => void addPlayer()} disabled={loading}>
            Enregistrer le joueur
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <div className="prereq-top">
          <h2>Joueurs trackés ({players.length})</h2>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            Rafraîchir
          </button>
        </div>
        {players.length === 0 ? (
          <p className="hint">Aucun joueur pour l’instant.</p>
        ) : (
          <ul className="tracked-list">
            {players.map((player) => (
              <li key={player.id} className="tracked-row">
                <div className="tracked-meta">
                  {player.photo_path ? (
                    <img src={convertFileSrc(player.photo_path)} alt="" className="tracked-avatar" />
                  ) : (
                    <div className="tracked-avatar placeholder" />
                  )}
                  <div>
                    <strong>{player.display_name || player.nickname || player.steam_id}</strong>
                    <div className="hint">{player.steam_id}</div>
                  </div>
                </div>
                <button type="button" onClick={() => void removePlayer(player.id)}>
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <div className="prereq-top">
          <h2>Meilleurs matchs (Rating · 15 derniers / joueur)</h2>
          <button
            type="button"
            className="primary"
            onClick={() => void loadMatches(1)}
            disabled={matchesLoading || players.length === 0 || !settings?.hasApiKey}
          >
            {matchesLoading ? "Chargement…" : "Charger"}
          </button>
        </div>
        {matches && (
          <>
            <p className="hint">
              Page {matches.page}/{matches.totalPages} · {matches.total} matchs
            </p>
            <div className="match-list">
              {matches.items.map((item) => (
                <article key={`${item.match_id}-${item.steam_id}`} className="match-card">
                  <div>
                    <strong>
                      {item.nickname} · Rating{" "}
                      {item.faceit_elo != null
                        ? item.faceit_elo
                        : (item.faceit_rating ?? item.rating ?? 0).toFixed(2)}
                    </strong>
                    <div className="hint">
                      {item.kills}-{item.deaths}-{item.assists}
                      {item.map ? ` · ${item.map}` : ""}
                      {item.result ? ` · ${item.result}` : ""}
                      {item.competition_name ? ` · ${item.competition_name}` : ""}
                    </div>
                  </div>
                  <div className="inline-actions">
                    <button type="button" onClick={() => void makeLobbyScreenshot(item.match_id)}>
                      Screenshot lobby
                    </button>
                    {item.has_demo && item.demo_urls[0] ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void downloadAndUse(item.match_id, item.demo_urls[0])}
                      >
                        Récupérer démo
                      </button>
                    ) : (
                      <span className="hint">Pas de démo API</span>
                    )}
                    {item.faceit_url && (
                      <a href={item.faceit_url} target="_blank" rel="noreferrer">
                        FACEIT
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                disabled={matchesLoading || page <= 1}
                onClick={() => void loadMatches(page - 1)}
              >
                Précédent
              </button>
              <button
                type="button"
                disabled={matchesLoading || page >= matches.totalPages}
                onClick={() => void loadMatches(page + 1)}
              >
                Suivant
              </button>
            </div>
          </>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}

      <footer className="actions">
        <button type="button" onClick={onBack}>
          Retour import
        </button>
      </footer>
    </section>
  );
}
