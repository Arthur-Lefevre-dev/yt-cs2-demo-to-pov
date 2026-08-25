# Recherche CS Demo Manager (CSDM)

Document de recherche préalable au `csdm-bridge`. Sources : docs officielles (v3.17+), code source `akiver/cs-demo-manager` (`main`).

## Prérequis CLI

- L’exécutable CLI est `csdm.cmd` (souvent
  `%LOCALAPPDATA%\Programs\cs-demo-manager\csdm.cmd`), qui lance
  `cs-demo-manager.exe` en mode Node. Sur le PATH on trouve parfois aussi
  `csdm` / `csdm.exe`.
- **Une demo doit déjà être analysée et présente dans la base CSDM** avant
  `csdm video`. Sinon : `csdm analyze "C:\path\demo.dem" --source faceit`.
- **Steam doit être lancé et connecté** avant `csdm video` (sinon CSDM
  affiche `Steam is not running` et quitte). Le bridge tente de démarrer
  Steam automatiquement s’il est fermé.
- CSDM peut télécharger HLAE / FFmpeg / VirtualDub tout seul s’ils manquent.

## Trois façons d’appeler `csdm video`

```bash
# 1. Plage de ticks unique
csdm video <demoPath> <startTick> <endTick> [options]

# 2. Auto-séquences autour d’événements joueur
csdm video <demoPath> --mode player --steamids <id1,id2> --event rounds [options]

# 3. Fichier de config JSON/JSONC (notre cible)
csdm video --config-file <path> [options]
```

Les flags CLI **écrasent** les valeurs du JSON.

## Schéma JSON `--config-file`

Type effectif : `VideoCommandConfig` + `Sequence[]`.

```jsonc
{
  "demoPath": "C:\\Users\\USER\\demos\\match.dem",          // obligatoire
  "outputFolderPath": "C:\\Users\\USER\\Desktop\\out",
  "outputFileName": "pov-{map}",                             // placeholders possibles
  "recordingSystem": "HLAE",                                 // "HLAE" | "CS"
  "recordingOutput": "video",                                // "video" | "images" | "images-and-video"
  "encoderSoftware": "FFmpeg",                               // "FFmpeg" | "VirtualDub"
  "width": 3840,                                             // 4K UHD (min 800)
  "height": 2160,                                            // 4K UHD (min 600)
  "framerate": 60,
  "closeGameAfterRecording": true,
  "concatenateSequences": false,                             // false = 1 fichier par sequence
  "trueView": false,
  "ffmpegSettings": {
    "audioBitrate": 256,
    "constantRateFactor": 23,
    "customLocationEnabled": false,
    "customExecutableLocation": "",
    "videoContainer": "mp4",                                 // "mp4" | "avi" | "mkv"
    "videoCodec": "libx264",
    "audioCodec": "aac",
    "inputParameters": "",
    "outputParameters": ""
  },
  "sequences": [
    {
      "number": 1,                 // ordre dans la vidéo finale, pas l’ordre d’enregistrement
      "startTick": 1351,
      "endTick": 4675,
      "showOnlyDeathNotices": true,
      "deathNoticesDuration": 5,
      "showXRay": false,
      "showAssists": true,
      "playerVoicesEnabled": true, // allume/éteint TOUTES les voix (tv_listen_voice_indices -1 / 0)
      "recordAudio": true,
      "cfg": "tv_listen_voice_indices 31\ntv_listen_voice_indices_h 0", // optionnel, 1 commande / ligne
      "playersOptions": [
        {
          "steamId": "76561198000697560",
          "playerName": "Player 1",
          "showKill": true,        // killfeed HLAE
          "highlightKill": false,
          "isVoiceEnabled": true   // voir section Voice
        }
      ],
      "playerCameras": [
        {
          "tick": 1351,
          "playerSteamId": "76561198000697560",
          "playerName": "Player 1"
        }
      ],
      "cameras": []                // caméras custom (spec_goto), pas notre cas POV
    }
  ]
}
```

Flags CLI utiles pour nous :

| Flag | Rôle |
| --- | --- |
| `--focus-player <SteamID64>` | Ajoute une `playerCameras` au tick de début |
| `--cfg <texte>` | CFG global exécuté avant l’enregistrement |
| `--recording-system HLAE` | Pilote HLAE (`mirv_streams`) |
| `--encoder-software FFmpeg` | Encode via FFmpeg |
| `--player-voices` / `--no-player-voices` | Voix globales |
| `--output` / `-o` | Dossier de sortie |
| `--width` `--height` `--framerate` | Résolution / FPS |

## Streaming HLAE → FFmpeg (à privilégier)

Dans `create-cs2-video-json-file.ts`, si :

- `recordingSystem === "HLAE"`
- `recordingOutput === "video"`
- `encoderSoftware === "FFmpeg"`

alors CSDM crée un preset `mirv_streams settings add ffmpeg …` et enregistre
**directement** vers `video.<container>` au lieu du mode `afxClassic`
(frames raw). C’est le mode qui évite de saturer le disque.

Commandes générées (extraits) :

```
mirv_streams record screen enabled 1
mirv_streams record startMovieWav 1
mirv_streams record name "<output>/<sequenceName>"
mirv_streams settings add ffmpeg csdmPresetN "-c:v libx264 -pix_fmt yuv420p -crf 23 …\\video.mp4"
mirv_streams record screen settings csdmPresetN
mirv_streams record fps <framerate>
# au startTick :
mirv_streams record start
# à endTick :
mirv_streams record end
```

## Voice : ce que CSDM fait vraiment

### 1. Aliases `voice_<SteamID64>` / `voice_ct` / `voice_t`

Générés dans le JSON d’actions (`<demo>.json` à côté du `.dem`) par
`generateVoiceAliases()`. Ils s’appuient sur le **camp de départ**
(`PlayerWatchInfo.side`), pas le camp du round courant. Le commentaire
CSDM le dit explicitement : *« players that started in CT/T »*.

```
alias "voice_<steamid>" "tv_listen_voice_indices <low>; tv_listen_voice_indices_h <high>"
alias "voice_ct" "…"
alias "voice_t" "…"
alias "voice_all" "tv_listen_voice_indices -1; tv_listen_voice_indices_h -1"
```

Ces aliases sont **créés** au tick 1, mais **pas exécutés** automatiquement
pendant un `csdm video`. Ils servent à la lecture manuelle (taper `voice_ct`
dans la console).

Le bitmask est `userId = slot - 1` (bits 0–31 → `tv_listen_voice_indices`,
32–63 → `tv_listen_voice_indices_h`). Voir `generatePlayerVoicesValues()`.

### 2. `playerVoicesEnabled` (booléen de sequence)

- `true` → `tv_listen_voice_indices -1` + `_h -1` (toutes les voix)
- `false` → `0` / `0` (silence)

### 3. `playersOptions[].isVoiceEnabled` — **chemin CLI utilisable**

Si `playerVoicesEnabled` est true **et** qu’au moins un joueur a
`isVoiceEnabled: false`, CSDM recalcule le bitmask à partir des
`userId` CSDM des joueurs encore à `true`, puis injecte :

```
tv_listen_voice_indices <low>
tv_listen_voice_indices_h <high>
```

au tick de setup de **cette** sequence (`startTick - tickrate`).

Donc pour « voix de l’équipe du joueur **à CE round** » :

1. Lister les SteamID de l’équipe courante (après side switch mi-temps).
2. Mettre `isVoiceEnabled: true` seulement pour eux, `false` pour les autres.
3. Mettre `playerVoicesEnabled: true`.
4. Une sequence = un round, pour que le bitmask suive le camp courant.

`userId` / `slot` viennent de la DB CSDM (`fetchMatchPlayersSlots`), pas du
JSON de config. Le bridge devra donc : `csdm analyze` d’abord, puis générer
le JSON. Si le bitmask CSDM se trompe après un switch, plan B ci-dessous.

### 4. `sequence.cfg` et `--cfg`

`cfg` est un texte multi-lignes, **une commande CS2 par ligne**, exécuté au
tick de setup (après `playerVoicesEnabled`, donc **il peut override** le
bitmask). Idéal pour le plan B :

```
tv_listen_voice_indices 31
tv_listen_voice_indices_h 0
```

`--cfg` CLI est un CFG global, moins précis qu’un `cfg` par sequence.

### Plan B (si le bitmask CSDM ne suit pas le camp courant)

1. Calculer nous-mêmes `userId` (slot spectateur) par joueur à ce round.
2. Générer le bitmask (`1 << userId`).
3. L’écrire dans `sequences[i].cfg`.
4. Ou écrire un `.cfg` HLAE et le lancer via `+exec` / HLAE.

Les aliases `voice_ct` / `voice_t` **ne doivent pas** être utilisés pour être
stricts sur le camp courant : ils sont figés au camp de départ.

## HUD POV (comme en jeu) + sans UI démo

Dans `sequences[].cfg` (et via `mirv_cmd` répétés pendant tout le clip) :

- **Début clip** : `startTick` = `freeze_end` par défaut (passe le buy / « warmup » du round ; jamais avant `match_start_tick`).
- **HUD joueur complet** : `cl_drawhud 1`, `cl_draw_only_deathnotices 0`,
  `r_drawviewmodel 1`, `crosshair 1`, `hud_showtargetid 1` + JSON `showOnlyDeathNotices: false`
  → radar, HP, argent, munitions, killfeed, crosshair (comme en jeu).
- **Caméra** : `spec_mode 1` + `spec_player <slot>` re-appliqué ~toutes les 0,5 s
  (`mirv_cmd`) pour rester sur le bon joueur tout le round.
- **Masquer la navigation démo CS2** : `demo_ui_mode 0` (+ `--cfg` CLI) — timeline / demoui Shift+F2.
- Nettoyage : `cl_showfps 0`, `net_graph 0`, TrueView telemetry opacity 0.

Ne pas utiliser `cl_draw_only_deathnotices 1` pour du contenu YouTube POV classique.

## Caméra POV

CSDM CS2 (code `createCs2VideoJsonFile`) fait pour chaque `playerCameras[]` :

```
spec_mode 1
spec_player <slot>
```

Le `slot` vient de la base CSDM (`players.index`), avec `userId = slot - 1`.
Sans `csdm analyze` / Postgres (`psql`), CSDM **ignore** `playerCameras`.

Notre bridge contourne ça :

1. Le parser lit `user_id` via demoparser2 et expose `slot = user_id + 1`.
2. Le JSON injecte dans `sequences[].cfg` : `spec_mode 1` + `spec_player <slot>`
   (+ `mirv_cmd addAtTick` pour re-appliquer après le freezetime).

Ne pas utiliser `spec_lock_to_accountid` / `spec_mode 2` (chemins CS:GO / mauvais mode).

Équivalent CLI : `--focus-player <SteamID64>` (nécessite aussi la DB CSDM pour résoudre le slot).

Note CSDM (oct. 2025) : ne pas exécuter `spec_player` et `demo_gototick` au
même tick — le JSON d’actions saute d’abord au tick de setup, puis spec.

## Analyse / export (alternative au parser maison)

### CLI

```bash
csdm analyze "demo.dem" --source faceit --force
csdm json "demo.dem" --output-folder out
csdm xlsx "demo.dem" --sheets rounds,kills,players
```

### Base de données

Ce n’est **pas** SQLite. CSDM utilise une base **PostgreSQL** locale
(tables `matches`, `players`, `rounds`, `kills`, …). Exemple de requête
officielle (discussion #1253) :

```sql
SELECT matches.demo_path, steam_id, number AS ROUND, start_tick, end_tick
FROM players
JOIN matches ON matches.checksum = players.match_checksum
JOIN rounds  ON players.match_checksum = rounds.match_checksum
ORDER BY rounds."number";
```

Colonnes `rounds` observées : `number`, `start_tick`, `end_tick`,
`freeze_time_end_tick`, winner side, checksum.

On parse nous-mêmes via `demo-parser` pour l’étape 2 (pas de dépendance à
CSDM installé). Le bridge pourra plus tard **aussi** relire cette DB / le
JSON `csdm json` pour recouper ticks et `userId`/`slot`.

## Contraintes capture

- Windows uniquement (CS2 + HLAE).
- Pendant HLAE, l’utilisateur ne doit pas utiliser souris/clavier
  (CS2 est au premier plan, windowed).
- Retry conseillé si l’enregistrement ne démarre pas / « frame unique »
  (pause CSDM déjà insérée 4 ticks avant `startTick` ; un délai
  supplémentaire peut être nécessaire).
- Tick minimum pour les commandes d’actions : **96** (bug #1343,
  `demo_gototick 0` saute les premiers ticks).

## Décision pour `csdm-bridge` (plus tard)

1. `csdm analyze --source faceit`.
2. Générer un JSON : 1 sequence / round sélectionné, `playerCameras` / cfg
   `spec_player <slot>`, **HUD complet** (`showOnlyDeathNotices: false`) pour
   radar / HP / joueurs en vie, voix d’équipe via bitmask
   (`isVoiceEnabled` true uniquement pour `team_steam_ids` du round).
3. `recordingSystem: HLAE`, `recordingOutput: video`, `encoderSoftware: FFmpeg`.
4. `concatenateSequences: false` (on assemble nous-mêmes avec intro lobby).
5. Appeler `csdm video --config-file …` et streamer stdout.
6. Si voix incorrectes : override via `sequence.cfg` (plan B).
