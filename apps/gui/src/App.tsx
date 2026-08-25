import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SetupScreen } from "./screens/SetupScreen";
import { ImportScreen } from "./screens/ImportScreen";
import { PlayersScreen } from "./screens/PlayersScreen";
import { RoundsScreen } from "./screens/RoundsScreen";
import { RenderScreen } from "./screens/RenderScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { FaceitScreen } from "./screens/FaceitScreen";
import { ThumbnailScreen } from "./screens/ThumbnailScreen";
import type {
  AppScreen,
  ParseResult,
  PipelineResult,
  PrerequisitesReport,
} from "./types";
import "./App.css";

function App() {
  const [screen, setScreen] = useState<AppScreen>("setup");
  const [prereqLoading, setPrereqLoading] = useState(false);
  const [prereqError, setPrereqError] = useState<string | null>(null);
  const [prerequisites, setPrerequisites] = useState<PrerequisitesReport | null>(null);

  const [demoPath, setDemoPath] = useState<string | null>(null);
  const [lobbyPath, setLobbyPath] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedSteamId, setSelectedSteamId] = useState<string | null>(null);
  const [selectedRounds, setSelectedRounds] = useState<number[]>([]);

  const [dryRun, setDryRun] = useState(true);
  const [runCsdm, setRunCsdm] = useState(false);
  const [introSeconds, setIntroSeconds] = useState(4);
  const [commercialPath, setCommercialPath] = useState<string | null>(null);
  const [commercialLabel, setCommercialLabel] = useState("Sponsors");
  const [commercialSeconds, setCommercialSeconds] = useState(5);
  const [videoCodec, setVideoCodec] = useState("libx264");
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(true);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);

  const selectedPlayer = useMemo(
    () => parseResult?.players.find((p) => p.steam_id === selectedSteamId) ?? null,
    [parseResult, selectedSteamId],
  );

  const refreshPrerequisites = useCallback(async () => {
    setPrereqLoading(true);
    setPrereqError(null);
    try {
      const report = await invoke<PrerequisitesReport>("check_prerequisites");
      setPrerequisites(report);
    } catch (error) {
      setPrereqError(error instanceof Error ? error.message : String(error));
    } finally {
      setPrereqLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPrerequisites();
  }, [refreshPrerequisites]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<string>("pipeline-log", (event) => {
      setPipelineLogs((prev) => [...prev, event.payload]);
    }).then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  function initRoundsForPlayer(steamId: string, result: ParseResult) {
    setSelectedSteamId(steamId);
    setSelectedRounds(
      result.player_rounds
        .filter((row) => row.steam_id === steamId)
        .map((row) => row.round_number),
    );
  }

  async function handleParse() {
    if (!demoPath) {
      return;
    }
    setParsing(true);
    setParseError(null);
    setParseResult(null);
    setSelectedSteamId(null);
    setSelectedRounds([]);
    setPipelineResult(null);
    try {
      const result = await invoke<ParseResult>("parse_demo", {
        demoPath,
        player: null,
      });
      setParseResult(result);
      setScreen("players");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
    } finally {
      setParsing(false);
    }
  }

  async function handlePipeline() {
    if (!parseResult || !selectedSteamId) {
      return;
    }
    if (!dryRun && runCsdm && selectedRounds.length > 2) {
      const ok = window.confirm(
        `Tu vas lancer CSDM/HLAE sur ${selectedRounds.length} rounds.\n` +
          `Ça peut prendre très longtemps. Continuer ?\n\n` +
          `Conseil : teste d’abord avec 1 seul round.`,
      );
      if (!ok) {
        return;
      }
    }
    const playerName =
      parseResult.players.find((p) => p.steam_id === selectedSteamId)?.name ?? selectedSteamId;

    setPipelineRunning(true);
    setPipelineError(null);
    setPipelineLogs([]);
    setLogsOpen(true);
    try {
      const result = await invoke<PipelineResult>("run_pipeline", {
        request: {
          parseResult,
          steamId: selectedSteamId,
          playerName,
          rounds: selectedRounds,
          lobbyPath,
          introSeconds,
          commercialPath,
          commercialLabel,
          commercialSeconds,
          videoCodec,
          dryRun,
          runCsdm: dryRun ? false : runCsdm,
          roundClipPaths: null,
          workDir: null,
        },
      });
      setPipelineResult(result);
      setPipelineLogs(result.logs);
      setScreen("result");
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : String(error));
    } finally {
      setPipelineRunning(false);
    }
  }

  function restartJob() {
    setScreen("import");
    setParseResult(null);
    setSelectedSteamId(null);
    setSelectedRounds([]);
    setPipelineResult(null);
    setPipelineLogs([]);
    setPipelineError(null);
    setDryRun(true);
    setRunCsdm(false);
    setCommercialPath(null);
    setCommercialLabel("Sponsors");
    setCommercialSeconds(5);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">POV</span>
          <div>
            <strong>CS2 POV Generator</strong>
            <p>CS2 demo → YouTube</p>
          </div>
        </div>
        <nav className="steps">
          <button
            type="button"
            className={screen === "setup" ? "step active" : "step"}
            onClick={() => setScreen("setup")}
          >
            1. Prérequis
          </button>
          <button
            type="button"
            className={screen === "import" ? "step active" : "step"}
            onClick={() => prerequisites?.readyForParse && setScreen("import")}
            disabled={!prerequisites?.readyForParse}
          >
            2. Import
          </button>
          <button
            type="button"
            className={screen === "faceit" ? "step active" : "step"}
            onClick={() => prerequisites?.readyForParse && setScreen("faceit")}
            disabled={!prerequisites?.readyForParse}
          >
            FACEIT
          </button>
          <button
            type="button"
            className={screen === "players" ? "step active" : "step"}
            onClick={() => parseResult && setScreen("players")}
            disabled={!parseResult}
          >
            3. Joueur
          </button>
          <button
            type="button"
            className={screen === "rounds" ? "step active" : "step"}
            onClick={() => parseResult && selectedSteamId && setScreen("rounds")}
            disabled={!parseResult || !selectedSteamId}
          >
            4. Rounds
          </button>
          <button
            type="button"
            className={screen === "render" ? "step active" : "step"}
            onClick={() => selectedRounds.length > 0 && setScreen("render")}
            disabled={selectedRounds.length === 0}
          >
            5. Rendu
          </button>
          <button
            type="button"
            className={screen === "result" ? "step active" : "step"}
            onClick={() => pipelineResult && setScreen("result")}
            disabled={!pipelineResult}
          >
            6. Résultat
          </button>
          <button
            type="button"
            className={screen === "thumbnails" ? "step active" : "step"}
            onClick={() => pipelineResult && selectedPlayer && setScreen("thumbnails")}
            disabled={!pipelineResult || !selectedPlayer}
          >
            7. Miniatures
          </button>
        </nav>
      </aside>

      <main className="main">
        {screen === "setup" && (
          <SetupScreen
            report={prerequisites}
            loading={prereqLoading}
            error={prereqError}
            onRefresh={() => void refreshPrerequisites()}
            onContinue={() => setScreen("import")}
          />
        )}
        {screen === "import" && (
          <ImportScreen
            demoPath={demoPath}
            lobbyPath={lobbyPath}
            parsing={parsing}
            error={parseError}
            onDemoPath={setDemoPath}
            onLobbyPath={setLobbyPath}
            onParse={() => void handleParse()}
            onBack={() => setScreen("setup")}
            onOpenFaceit={() => setScreen("faceit")}
          />
        )}
        {screen === "faceit" && (
          <FaceitScreen
            onBack={() => setScreen("import")}
            onUseDemo={(path) => {
              setDemoPath(path);
              setScreen("import");
            }}
            onUseLobby={(path) => {
              setLobbyPath(path);
            }}
          />
        )}
        {screen === "players" && parseResult && (
          <PlayersScreen
            result={parseResult}
            selectedSteamId={selectedSteamId}
            onSelect={(steamId) => initRoundsForPlayer(steamId, parseResult)}
            onBack={() => setScreen("import")}
            onContinue={() => setScreen("rounds")}
          />
        )}
        {screen === "rounds" && parseResult && selectedSteamId && (
          <RoundsScreen
            result={parseResult}
            steamId={selectedSteamId}
            selectedRounds={selectedRounds}
            onChangeRounds={setSelectedRounds}
            onBack={() => setScreen("players")}
            onContinue={() => setScreen("render")}
          />
        )}
        {screen === "render" && (
          <RenderScreen
            running={pipelineRunning}
            dryRun={dryRun}
            runCsdm={runCsdm}
            introSeconds={introSeconds}
            commercialPath={commercialPath}
            commercialLabel={commercialLabel}
            commercialSeconds={commercialSeconds}
            videoCodec={videoCodec}
            csdmReady={Boolean(prerequisites?.items.find((i) => i.id === "csdm")?.found)}
            csdmPath={prerequisites?.items.find((i) => i.id === "csdm")?.path ?? null}
            logs={pipelineLogs}
            logsOpen={logsOpen}
            error={pipelineError}
            onDryRunChange={(value) => {
              setDryRun(value);
              if (value) {
                setRunCsdm(false);
              }
            }}
            onRunCsdmChange={(value) => {
              setRunCsdm(value);
              if (value) {
                setDryRun(false);
              }
            }}
            onIntroSecondsChange={setIntroSeconds}
            onCommercialPathChange={setCommercialPath}
            onCommercialLabelChange={setCommercialLabel}
            onCommercialSecondsChange={setCommercialSeconds}
            onVideoCodecChange={setVideoCodec}
            onLogsOpenChange={setLogsOpen}
            onStart={() => void handlePipeline()}
            onBack={() => setScreen("rounds")}
          />
        )}
        {screen === "result" && pipelineResult && (
          <ResultScreen
            result={pipelineResult}
            onBack={() => setScreen("render")}
            onContinue={() => setScreen("thumbnails")}
            onRestart={restartJob}
          />
        )}
        {screen === "thumbnails" && selectedPlayer && (
          <ThumbnailScreen
            playerName={selectedPlayer.name}
            mapName={parseResult?.map ?? "de_unknown"}
            kills={selectedPlayer.kills}
            deaths={selectedPlayer.deaths}
            rounds={parseResult?.rounds?.length ?? 0}
            rating={selectedPlayer.hltv_rating ?? null}
            matchKind={parseResult?.match_kind ?? null}
            eventName={parseResult?.event_name ?? null}
            teamCt={parseResult?.team_ct ?? null}
            teamT={parseResult?.team_t ?? null}
            playerSide={
              parseResult?.player_rounds.find((row) => row.steam_id === selectedPlayer.steam_id)
                ?.player_side ?? null
            }
            workDir={pipelineResult?.workDir ?? null}
            videoPath={pipelineResult?.videoPath ?? null}
            onBack={() => setScreen("result")}
            onRestart={restartJob}
          />
        )}
      </main>
    </div>
  );
}

export default App;
