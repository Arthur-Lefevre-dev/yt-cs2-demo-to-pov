# FACEIT tracking

1. Create a **server API key** at https://developers.faceit.com/
2. Save it either:
   - Env var `FACEIT_API_KEY`, or
   - File `fixtures/faceit-api-key.txt` (dev) / `Documents\CS2-POV-Generator\faceit-api-key.txt` (release)
3. Tracked players store: `fixtures/tracked-players.json` (dev) or `Documents\CS2-POV-Generator\tracked-players.json`

In the app: sidebar **FACEIT** → add SteamID64 + photo + team logo → **Charger** best matches (last 15 per player, sorted by match Rating).

### Demo download

FACEIT Data API returns private `demos.faceit.com` resource URLs (they do **not** resolve in public DNS → `ENOTFOUND`). Scraped hosts like `demos-us-east.backblaze.faceit-cdn.net` are also invalid.

The app downloads by:
1. Chromium on the match room → click **Watch Demo** and save the file (preferred), else
2. FACEIT **Downloads API** signed URL (if your API key has Downloads scope), else
3. Node fetch of a DNS-reachable CDN URL only.

If all fail, download the `.dem` manually from faceit.com and use Import.

### Lobby screenshot

For each match: **Screenshot lobby** builds a 1920×1080 intro image from the FACEIT roster (avatars, levels, map, score) via the Data API.

- Saved to `Documents\CS2-POV-Generator\lobbies\<matchId>-lobby.jpg` (release) or under the user app root in dev.
- Also generated automatically when you click **Récupérer démo**.
- The path is injected as the Import “Screenshot lobby” for the video intro.
