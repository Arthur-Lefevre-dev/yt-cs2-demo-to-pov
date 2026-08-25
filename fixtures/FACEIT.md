# FACEIT tracking

1. Create a **server API key** at https://developers.faceit.com/
2. Save it either:
   - Env var `FACEIT_API_KEY`, or
   - File `fixtures/faceit-api-key.txt` (dev) / `Documents\CS2-POV-Generator\faceit-api-key.txt` (release)
3. Tracked players store: `fixtures/tracked-players.json` (dev) or `Documents\CS2-POV-Generator\tracked-players.json`

In the app: sidebar **FACEIT** → add SteamID64 + photo + team logo → **Charger** best matches (last 15 per player, sorted by K/D).

### Lobby screenshot

For each match: **Screenshot lobby** builds a 1920×1080 intro image from the FACEIT roster (avatars, levels, map, score) via the Data API.

- Saved to `Documents\CS2-POV-Generator\lobbies\<matchId>-lobby.jpg` (release) or under the user app root in dev.
- Also generated automatically when you click **Récupérer démo**.
- The path is injected as the Import “Screenshot lobby” for the video intro.
