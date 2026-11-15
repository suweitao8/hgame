# Bilibili Toy Packaging & Release Standard (HGame)

This specification unifies HGame's release pipeline with the Bilibili Toy Creator Platform standards (`/toy/publish/guide`, `/toy/publish/sdk`, `/toy/publish/sdk/cli`, and `bilibili/toy`).

## 1. Archive & Path Rules

| Rule | Standard | Why |
|---|---|---|
| **Package entry** | `index.html` at ZIP root (`flatZip: true`) | Eliminates directory-nesting ambiguity on upload and preview. |
| **Entry `index.html` size** | **<= 1 MB** (1,048,576 bytes **uncompressed**) | Hard server limit (`307000`); even preview rejects oversized `index.html`. Keep inline scripts/data/images external. |
| **Non-entry HTML size** | **< 12 MB** (recommended) | HTML documents are not cached like assets; large HTML delays every visit. |
| **Resource URLs** | Relative only (`./style.css`, `./src/main.js`, `./assets/...`) | Toy apps run under `/toy/<slug>/`. Root-relative `/assets/...` or `location.href = "/..."` resolves to site root and causes white screen / 404. |
| **Routing** | Hash routing (`#/page`) or relative HTML (`./page2.html`); in-page `#anchor` works | History-mode `/route` without matching `.html` files 404s on refresh. Avoid mutating URL with `history.pushState` / `location.hash`. |
| **Contenthash (`§3.5`)** | Entry JS/CSS carry content hash (`main-<hash8>.js`, `style-<hash8>.css`) | Toy CDN reuses unchanged filenames+contents across updates so returning players skip re-downloading unchanged engine/art files. |
| **Image edge cap** | Width and height **< 10,000 px** for all images | Hard local CLI + server preflight rejection. |
| **Excluded files** | `.git/`, `node_modules/`, `__MACOSX/`, `.DS_Store`, `toy.yaml`, `assets.manifest.json`, `.md`, `.psd`/`.blend`/`.fbx` | Keeps packages minimal and prevents leaking dev/authoring artifacts. |
| **Sharing URL** | `https://www.bilibili.com/toy/<slug>/index.html` | Directory-index fallback on bare `/<slug>/` is not guaranteed. |

## 2. Metadata & Visual Asset Rules

- **`--slug`**: `[A-Za-z0-9_-]`, max 64 bytes. **Immutable after first creation** — always preserve the existing slug on `toy update`.
- **`--poster` (cover)**: `.png`, `.jpg`, or `.jpeg`; 4:3 landscape preferred (e.g. `1200x900`). Portrait posters crop poorly on Toy feed cards.
- **`--icon` (app icon)**: `.png`, `.jpg`, or `.jpeg`; **<= 512 KB** and **<= 1024 × 1024 px** (validated by image header content, not extension).
- **`--category`**: `GAME | INTERACTIVE_PLAY | TOOL | TEST | GUIDE | COLLECTION | OTHER` (HGame defaults to `GAME`).
- **`--visibility`**: `link-only | password | public` (`password` requires `--access-password` of 4–32 chars).
- **`--theme`**: `dark | light` (default `dark`).
- **`--watermark`**: Required whenever the Toy provides freehand drawing/canvas authoring.
- **`--app-only`**: Restricts access to Bilibili App UA (note: UA gate reduces casual bypass; real paywall security must still rely on `getChargeUnlock`).

## 3. HGame Zero-Dependency Audio Advantage

Because Bilibili Toy requires the **`AUDIO_VIDEO_UPLOAD`** account capability whenever a package ships `.mp3` / `.wav` / `.ogg` / `.mp4` files:
- Prefer HGame's built-in 0-KB procedural audio (`audio.playSynth(...)`, `createProceduralBgm(...)`) for rapid prototypes and standard Toys that do not need pre-recorded voice/music.
- If shipping curated `.mp3` / `.ogg` assets (`scripts/process-audio.mjs`), ensure the creator account has **`AUDIO_VIDEO_UPLOAD`** approved in Toy Creator Settings before submitting.

## 4. HGame Build & Verification Pipeline

1. Verify game locally (`npm test`, `npm run check`, `npm run snapshot -- <game-dir>`, `npm run playtest -- <game-dir>`).
2. Build Toy deliverable:
   ```powershell
   npm run package:toy -- "<game-dir>" --version 1.0 --slug <slug> --poster cover.png --icon icon.png
   ```
3. Run preflight standalone (optional re-check on zip):
   ```powershell
   npm run toy:check -- "<game-dir>/build/<id>_1_0.zip" --slug <slug> --poster cover.png --icon icon.png
   ```
4. Preview via `toy create ... --json` (or `toy update ... --json`) without `--yes`, inspect `preview_url`, get explicit user confirmation, then submit with `--yes`.
