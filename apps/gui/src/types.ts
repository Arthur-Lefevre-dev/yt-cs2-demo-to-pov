export type PrerequisiteItem = {
  id: string;
  label: string;
  required: boolean;
  found: boolean;
  path: string | null;
  installUrl: string | null;
  hint: string | null;
};

export type PrerequisitesReport = {
  osSupported: boolean;
  osName: string;
  cpuName: string | null;
  gpuName: string | null;
  items: PrerequisiteItem[];
  readyForParse: boolean;
  readyForRender: boolean;
};

export type DemoPlayer = {
  steam_id: string;
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  hltv_rating?: number | null;
  user_id?: number | null;
  slot?: number | null;
  entity_id?: number | null;
};

export type DemoRound = {
  round_number: number;
  round_start_tick: number;
  freeze_end_tick: number;
  round_end_tick: number;
  official_end_tick: number;
  winner: string | null;
};

export type PlayerRound = {
  steam_id: string;
  player_name: string;
  round_number: number;
  round_start_tick: number;
  freeze_end_tick: number;
  player_death_tick: number | null;
  round_end_tick: number;
  clip_end_tick: number;
  clip_start_tick?: number;
  player_side: "CT" | "T" | string;
  team_steam_ids: string[];
  survived: boolean;
  winner: string | null;
  estimated_clip_seconds: number | null;
  kills_in_round?: number;
  highlight_weapon?: string | null;
  clutch?: boolean;
  chapter_label?: string | null;
};

export type ParseResult = {
  demo_path: string;
  map: string | null;
  tickrate: number | null;
  server_name: string | null;
  match_kind?: "faceit" | "premier" | "tournament" | string | null;
  event_name?: string | null;
  team_ct?: string | null;
  team_t?: string | null;
  matchup?: string | null;
  match_start_tick: number;
  players: DemoPlayer[];
  rounds: DemoRound[];
  player_rounds: PlayerRound[];
  player_smokes?: Array<{
    steam_id: string;
    round_number: number;
    throw_tick: number;
    chapter_tick: number;
    label: string;
  }>;
  skipped_rounds: Array<{
    steam_id: string;
    name: string;
    round_number: number;
    reason: string;
  }>;
};

export type PipelineResult = {
  workDir: string;
  configPaths: string[];
  chaptersText: string;
  chaptersPath: string | null;
  videoPath: string | null;
  dryRun: boolean;
  mode: string;
  logs: string[];
};

export type ScreenshotProposal = {
  id: string;
  index: number;
  path: string;
  label: string;
  seconds?: number;
  sourceLabel?: string;
  dataUrl: string;
};

export type ThumbnailVariant = {
  id: string;
  index: number;
  path: string;
  backgroundPath?: string;
  dataUrl: string;
};

export type ThumbnailResult = {
  title: string;
  score: string;
  hltvRating?: number;
  ratingLabel?: string;
  mapLabel: string;
  outDir: string;
  variants: ThumbnailVariant[];
};

export type AppScreen =
  | "setup"
  | "import"
  | "faceit"
  | "players"
  | "rounds"
  | "render"
  | "result"
  | "thumbnails";

export type TrackedPlayer = {
  id: string;
  steam_id: string;
  faceit_player_id?: string;
  nickname?: string;
  display_name?: string;
  photo_path?: string | null;
  team_logo_path?: string | null;
};

export type FaceitSettings = {
  hasApiKey: boolean;
  storePath: string;
  apiKeyPath: string;
};

export type FaceitMatchItem = {
  match_id: string;
  finished_at: number | null;
  competition_name: string | null;
  faceit_url: string | null;
  steam_id: string;
  nickname: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  rounds?: number;
  rating: number;
  faceit_elo?: number | null;
  faceit_rating: number;
  map: string | null;
  result: string | null;
  demo_urls: string[];
  has_demo: boolean;
};

export type FaceitBestMatchesResult = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: FaceitMatchItem[];
};
