import type { ParseResult } from "../types";

type Props = {
  result: ParseResult;
  selectedSteamId: string | null;
  onSelect: (steamId: string) => void;
  onBack: () => void;
  onContinue: () => void;
};

function kd(kills: number, deaths: number): string {
  if (deaths === 0) {
    return kills.toFixed(2);
  }
  return (kills / deaths).toFixed(2);
}

export function PlayersScreen({
  result,
  selectedSteamId,
  onSelect,
  onBack,
  onContinue,
}: Props) {
  const selectedRounds = selectedSteamId
    ? result.player_rounds.filter((row) => row.steam_id === selectedSteamId)
    : [];
  const selectedSkipped = selectedSteamId
    ? result.skipped_rounds.filter((row) => row.steam_id === selectedSteamId)
    : [];

  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 3 / 7</p>
        <h1>Choisir un joueur</h1>
        <p className="lede">
          {result.map ?? "map ?"} · tickrate {result.tickrate ?? "?"} ·{" "}
          {result.rounds.length} rounds · {result.players.length} joueurs
          {result.server_name ? ` · ${result.server_name}` : ""}
        </p>
      </header>

      <div className="players-layout">
        <div className="players-list">
          {[...result.players]
            .sort((a, b) => b.kills - a.kills)
            .map((player) => {
              const active = player.steam_id === selectedSteamId;
              return (
                <button
                  key={player.steam_id}
                  type="button"
                  className={active ? "player-row active" : "player-row"}
                  onClick={() => onSelect(player.steam_id)}
                >
                  <span className="player-name">{player.name}</span>
                  <span className="player-stats">
                    {player.kills}/{player.deaths}/{player.assists}
                    {player.hltv_rating != null
                      ? ` · Rating ${player.hltv_rating.toFixed(2)}`
                      : ` · K/D ${kd(player.kills, player.deaths)}`}
                  </span>
                  <code className="player-id">{player.steam_id}</code>
                </button>
              );
            })}
        </div>

        <div className="rounds-preview">
          {!selectedSteamId && (
            <p className="hint">Sélectionne un joueur pour voir ses rounds.</p>
          )}
          {selectedSteamId && (
            <>
              <h2>
                Rounds —{" "}
                {result.players.find((p) => p.steam_id === selectedSteamId)?.name ??
                  selectedSteamId}
              </h2>
              {selectedSkipped.length > 0 && (
                <p className="warn">
                  {selectedSkipped.length} round(s) skippés (absent / déco).
                </p>
              )}
              <div className="rounds-table-wrap">
                <table className="rounds-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Side</th>
                      <th>Start</th>
                      <th>Death</th>
                      <th>End</th>
                      <th>Clip</th>
                      <th>Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRounds.map((row) => (
                      <tr key={`${row.steam_id}-${row.round_number}`}>
                        <td>{row.round_number}</td>
                        <td>{row.player_side}</td>
                        <td>{row.round_start_tick}</td>
                        <td>{row.player_death_tick ?? "—"}</td>
                        <td>{row.round_end_tick}</td>
                        <td>
                          {row.estimated_clip_seconds != null
                            ? `${row.estimated_clip_seconds.toFixed(1)}s`
                            : "—"}
                          {row.survived ? " · live" : ""}
                        </td>
                        <td>{row.team_steam_ids.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="actions">
        <button type="button" onClick={onBack}>
          Retour
        </button>
        <button
          type="button"
          className="primary"
          disabled={!selectedSteamId}
          onClick={onContinue}
        >
          Continuer
        </button>
      </footer>
    </section>
  );
}
