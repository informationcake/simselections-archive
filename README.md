# SimSelections Archive

A custom archive for the **SimSelections** community song writing challenges.

---

## Project Structure

```text
├── data/
│   ├── artist_discord_map.json         # Compiled Discord identity & artist lookup map
│   └── metadata_YYYY.csv               # Downloaded metadata per year
├── scripts/
│   ├── auth.py                         # Discord OAuth, JWT sessions, allowlist & guild check
│   ├── compile_discord_map.py          # Discord identity map compiler
│   ├── download_sheets.py              # Google Sheets tab downloader
│   ├── scanner.py                      # Library scanner & catalog compiler
│   └── start_server.py                 # Local HTTP server with Range Request & API support
├── src/
│   ├── css/
│   │   ├── base.css                    # Reset, body, app grid, scrollbars
│   │   ├── challenges.css              # Challenges dashboard panel styles
│   │   ├── clustermap.css              # Cluster map panel and sidebar styles
│   │   ├── components.css              # Shared UI components (vinyl, visualiser, etc.)
│   │   ├── content.css                 # Main area, panels, tracklist, buttons
│   │   ├── dashboard.css               # Artist dashboard modal and track list styles
│   │   ├── player-bar.css              # Footer player bar controls
│   │   ├── sidebar.css                 # Sidebar, logo, search, library
│   │   ├── statistics.css              # Statistics dashboard panel styles
│   │   └── variables.css               # Design variables (colours, spacing, fonts)
│   ├── challenges.js                   # Challenges dashboard logic
│   ├── clustermap-data.js              # Data processing and artist grouping for clustermap
│   ├── clustermap.js                   # An interactive map of songs based on metadata
│   ├── dashboard.js                    # Artist dashboard UI and playback toggle logic
│   ├── features.js                     # Deployment feature flags
│   ├── index.css                       # CSS entry point (@imports all stylesheets)
│   ├── library.js                      # Library tree, playlist loading, tracklist, search
│   ├── main.js                         # JS entry point (bootstraps the app)
│   ├── metadata.js                     # Auto-generated playlist catalog (via scanner.py)
│   ├── optin.js                        # Playback opt-in resolution logic
│   ├── player.js                       # Audio/video playback, controls, progress bar
│   ├── state.js                        # Centralised app state object
│   ├── statistics.js                   # Statistics dashboard logic
│   ├── ui.js                           # View toggles, info modal, auth, event wiring
│   ├── utils.js                        # Utility functions
│   ├── visualiser.js                   # Web Audio API visualiser rendering
│   └── worker.js                       # Cloudflare Worker proxy & asset routing script
├── tests/
│   ├── test_auth_server.py             # Unit tests for auth.py & start_server.py
│   ├── test_compile_discord_map.py     # Unit tests for compile_discord_map.py
│   ├── test_download_sheets.py         # Unit tests for download_sheets.py
│   ├── test_optin.py                   # Unit tests for optin.js
│   ├── test_scanner.py                 # Unit tests for scanner.py
│   ├── test_server_integration.py      # Full server lifecycle & API integration tests
│   └── test_start_server.py            # Unit tests for start_server.py
├── .assetsignore                       # Cloudflare Wrangler asset ignore rules
├── .gitignore                          # Git ignore rules
├── LICENSE                             # Community archive license terms
├── README.md                           # This documentation file
├── index.html                          # Main application markup
├── info-text.txt                       # FAQs and data handling info
└── wrangler.toml                       # Cloudflare Workers with Assets configuration
```

---

## Local Setup

Launch the HTTP web server from the project directory and specify the path to your music files if available. If no music available run without the argument for all functionality except playback:
```bash
python3 scripts/start_server.py --music-file-path </path/to/media/>
```
Navigate to the hosted URL:
    👉 **[http://localhost:8086](http://localhost:8086)**

---

## Gathering metadata

This section explains how data is parsed and prepared for the player. We use the Google sheet as the master reference for all metadata. The yearly `metadata_YYYY.csv` files are downloaded from the Google Sheet and then converted to the single `src/metadata.js` for the player to function. 

### Download metadata_YYYY.csv files
To download all metadata (monthly themes, keywords, challenges, submission data and artist links) from the SimSelections Google Sheet:
```bash
python3 scripts/download_sheets.py
```
This saves them locally as `data/metadata_YYYY.csv` files, which are committed to this repository. These files will be updated periodically to reflect the community maintained Google Sheet.

### Scan and compile library catalog
To create the master library source for the player (`src/metadata.js`), `scripts/scanner.py` will compile all the `data/metadata_YYYY.csv` files, and cross-match them with local media file paths for fuzzy matching. It also resolves monthly YouTube stream links and reports potential errors in the metadata.

Set the `music-file-path` environment variable to the path of your local media directory or add the argument when running the scanner script:
```bash
export music-file-path="/path/to/media/" # where you would have YYYY folders.

python3 scripts/scanner.py --music-file-path </path/to/media/>
```

If you don't have access to the media files, you can skip setting the environment variable and the script will still complete. You'll just not be able to play the tracks, and the matching of metadata to exact files may have some errors in it. In this case you may not be able to reliably or fully develop new features. The script will output errors and inform you if there are discrepencies with artist or track names between the Google Sheet and local files. It will also alert you if there are variations on artist names from typos in the Google Sheet. 

### Create Discord identity map
To link submissions to Discord user accounts, `scripts/compile_discord_map.py` parses the compiled catalog (`src/metadata.js`) and historical submission sheets (`data/metadata_YYYY.csv`). It deconstructs multi-artist collaboration strings into individual creators, normalises Discord handles, and generates the master identity lookup file: `data/artist_discord_map.json`.

```bash
python3 scripts/compile_discord_map.py
```

This mapping is used by both the local server and Cloudflare Workers to automatically populate the Artist Dashboard when an artist logs in with Discord, allowing them to manage playback permissions for their tracks.

### Fuzzy matching
We have a situation where metadata in the Google Sheet may not exactly match that of the uploaded files. Whilst I fill in the Google Sheet with data that exactly matches the uploaded tracks (I have a script that does this to avoid errors), we enable the community to go and edit the Google Sheet, and they may wish to change their track name, artist name, or perhaps other data in the future. So having the ability to fuzzily match them is usefull. Therefore all media files must be downloaded locally for this matching process to generate the `src/metadata.js` file reliably and also to test playback.

## Playback
Logging in with discord will be required for playback, but anyone logging in with the global user/pass can browse the catalog without playback.

All tracks are opted out of Playback until artists log in and enable it by hand. Since all submissions originally came with a discord handle, when an artist logs in with Discord the system automatically matches their account against `data/artist_discord_map.json` and loads their submissions into their artist dashboard panel. Artists can then toggle playback on or off for individual or all tracks. Collaboration tracks require all collaborators to opt-in. 

The most effective deployment proposal is to use a Cloudflare R2 storage bucket combined with a serverless Cloudflare Worker proxy (`src/worker.js`). For the amount of data and number of expected users this is essentially free. In production, the player requests audio using relative paths (e.g., `/2024/...`), which are intercepted by the serverless proxy worker to stream tracks directly from the bound R2 bucket. Locally, these same relative requests are captured by the HTTP development server (`scripts/start_server.py`) and resolved to your local drive. This ensures that the local workspace matches the cloud setup.

Beyond these technical aspects, we must ensure users are aware of the legal implications of sharing their music, with clear terms of service (further described in the additional information section).

# Requirements
A standard Python installation is sufficient for local development and deployment. If ffprobe is found on the host system it will prioritise this to extract file durations but will fall back to use Python to look at file headers to extract durations.

---

## Key Features

*   **Cross-view functionality**: Any track selected in one view is tracked across all views. Click on a track in the map view, the library panel will navigate to that track, the challenges panel will highlight which month that track is playing, etc.
*   **Color Themes**: Switch between **Cyberpunk Cyan/Pink**, **Emerald/Gold/Orange**, and **Monochrome Greyscale** color palettes.
*   **Visualizers**: Real-time rendering modes (FFT 2048) including a Scrolling Heatmap, Circular Spikes, and Cyber Waves. This switches to play video files where available.
*   **Statistics**: Analysis of metadata on submission rates and song lengths.
*   **Challenges**: List of all challenges, links to youtube streams, and fully connected to other panels.
*   **Cluster Map**: An interactive 2D map of all tracks with forces pulling/pushing them based on a few metrics (metadata only - no audio file analysis).

---

## Additional Information

Please refer directly to [info-text.txt](info-text.txt) for the full description of community information, data handling details, and FAQs.
