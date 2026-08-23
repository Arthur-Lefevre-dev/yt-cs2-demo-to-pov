import type { ParseResult, PlayerRound } from "../types";

type Props = {
  result: ParseResult;
  steamId: string;
  selectedRounds: number[];
  onChangeRounds: (rounds: number[]) => void;
  onBack: () => void;
  onContinue: () => void;
};

export function RoundsScreen({
  result,
  steamId,
  selectedRounds,
  onChangeRounds,
  onBack,
  onContinue,
}: Props) {
  const rows: PlayerRound[] = result.player_rounds.filter((row) => row.steam_id === steamId);
  const playerName = result.players.find((p) => p.steam_id === steamId)?.name ?? steamId;
  const selectedSet = new Set(selectedRounds);
  const estimatedTotal = rows
    .filter((row) => selectedSet.has(row.round_number))
    .reduce((sum, row) => sum + (row.estimated_clip_seconds ?? 0), 0);

  function toggle(roundNumber: number) {
    if (selectedSet.has(roundNumber)) {
      onChangeRounds(selectedRounds.filter((n) => n !== roundNumber));
    } else {
      onChangeRounds([...selectedRounds, roundNumber].sort((a, b) => a - b));
    }
  }

  function selectAll() {
    onChangeRounds(rows.map((row) => row.round_number));
  }

  function selectNone() {
    onChangeRounds([]);
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Étape 4 / 7</p>
        <h1>Aperçu des rounds</h1>
        <p className="lede">
          {playerName} — coche les rounds à inclure. Durée estimée sélection :{" "}
          {estimatedTotal.toFixed(0)}s (+ intro lobby).
        </p>
      </header>

      <div className="inline-actions" style={{ marginBottom: "0.75rem" }}>
        <button type="button" onClick={selectAll}>
          Tout sélectionner
        </button>
        <button type="button" onClick={selectNone}>
          Tout désélectionner
        </button>
        <span className="hint">
          {selectedRounds.length} / {rows.length} rounds
        </span>
      </div>

      <div className="rounds-table-wrap panel">
        <table className="rounds-table">
          <thead>
            <tr>
              <th></th>
              <th>#</th>
              <th>Side</th>
              <th>Résultat</th>
              <th>Mort / live</th>
              <th>Durée est.</th>
              <th>Ticks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const checked = selectedSet.has(row.round_number);
              const won = row.winner === row.player_side;
              return (
                <tr key={row.round_number} className={checked ? undefined : "row-dim"}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(row.round_number)}
                    />
                  </td>
                  <td>{row.round_number}</td>
                  <td>{row.player_side}</td>
                  <td>{won ? "Win" : "Loss"}</td>
                  <td>{row.survived ? "Survécu" : `Mort @ ${row.player_death_tick}`}</td>
                  <td>
                    {row.estimated_clip_seconds != null
                      ? `${row.estimated_clip_seconds.toFixed(1)}s`
                      : "—"}
                  </td>
                  <td>
                    {row.round_start_tick} → {row.clip_end_tick}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="actions">
        <button type="button" onClick={onBack}>
          Retour
        </button>
        <button
          type="button"
          className="primary"
          disabled={selectedRounds.length === 0}
          onClick={onContinue}
        >
          Lancer le pipeline
        </button>
      </footer>
    </section>
  );
}
