---
name: hgame-bilibili-toy
description: >-
  Bilibili Toy platform integration, packaging standard, and CLI publishing workflow
  for HGame projects. Covers window.toy JS SDK (integrations/bilibili-toy.js),
  content-hashed flat ZIP packaging (--target toy), preflight validation
  (scripts/toy-preflight.mjs), account capability permissions, and two-stage
  preview-confirm-submit publishing via the official toy CLI.
---

# HGame × Bilibili Toy Platform Skill

Use this skill whenever an HGame project is targeting **Bilibili Toy (`https://www.bilibili.com/toy/<slug>/index.html`)** — whether integrating `window.toy` SDK capabilities, packaging a Toy-compliant deliverable, running preflight checks, or publishing/updating via the `toy` CLI.

---

## 1. Final Packaging & Release Standard (`--target toy`)

Bilibili Toy serves each project under `/toy/<slug>/` with strict entry size, relative path, image dimension, and CDN cache-reuse rules. Never upload raw project folders or standard nested-root archives; always build with `--target toy`:

```powershell
# From HGame engine root targeting a game directory:
npm run package:toy -- "<game-dir>" --version 1.0 --slug <slug> --poster cover.png --icon icon.png

# Or inside a standalone HGame game project:
npm run package:toy -- --version 1.0 --slug <slug>
```

What `--target toy` enforces automatically:
1. **Flat ZIP Root (`flatZip: true`)**: `index.html` is placed directly at the root of `build/<id>_<ver>/` and `build/<id>_<ver>.zip`.
2. **Content-Hashed Entry Assets (`contenthash`)**: Renames entry CSS/JS (`style-<hash8>.css`, `src/main-<hash8>.js`) and updates `index.html` so Bilibili Toy CDN reuses unchanged assets across updates (`vendor/hgame/*`, `assets/*`).
3. **Auto `toy-sdk.js` Head Injection**: When `--toy-sdk`, `game.config.json` (`"toy": { "sdk": true }`), or `integrations/bilibili-toy.js` / `window.toy` usage is detected, injects `<script src="//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js"></script>` into `<head>` (suppressible via `--no-toy-sdk`).
4. **Hard Preflight Gate (`scripts/toy-preflight.mjs`)**: Blocks packaging on any `ERROR` and prints `WARN` + required platform capabilities to `stderr`:
   - Entry `index.html` uncompressed size **<= 1 MB** (`1,048,576` bytes; server rejects > 1 MB with `307000`, even on preview).
   - Zero root-relative URLs (`/assets/...`, `/src/...`, `location.href = "/..."`) — relative `./` paths only.
   - Zero missing local resource references in HTML/CSS.
   - All images `< 10,000 px` on both width and height; `--icon` PNG/JPEG `<= 512 KB` and `<= 1024x1024 px`; `--poster` PNG/JPEG (4:3 landscape preferred, e.g. `1200x900`).
   - Clean exclusion of `.git/`, `node_modules/`, `__MACOSX/`, `toy.yaml`, `assets.manifest.json`, `.md`, and raw DCC files.

Standalone preflight command:
```powershell
npm run toy:check -- "<dir-or-zip>" --slug <slug> --poster cover.png --icon icon.png
```

See [toy-publish-standard.md](references/toy-publish-standard.md) for the full packaging & review specification.

---

## 2. HGame Toy SDK Integration (`integrations/bilibili-toy.js`)

Always use `vendor/hgame/integrations/bilibili-toy.js` instead of calling raw `window.toy` ad-hoc. It adds key/range validation, exponential backoff for `307044` rate limits, App/Web guards, and local preview fallbacks.

```js
import {
  createToyBridge,
  createToyCloudSaveAdapter,
  loadBilibiliToySdk,
} from '../vendor/hgame/integrations/bilibili-toy.js';

await loadBilibiliToySdk(); // Safe no-op outside *.bilibili.com when toy-sdk.js isn't in <head>
const toy = createToyBridge({ gameId: gameConfig.id });
const cloudSave = createToyCloudSaveAdapter({ bridge: toy });
await cloudSave.load();
```

### Mandatory SDK Iron Rules
1. **Cloud Storage = Save Checkpoints, NOT RAM**: Keep active game state in memory; call `cloudSave.set(key, value)` in memory and `await cloudSave.flush()` only on level clear, settlement, or `visibilitychange`/`pagehide`. Never call `setCloudStorage` per click/frame/score tick.
2. **Batch, Never Loop**: One `setCloudStorage({ a: '1', b: '2' })` or `getCloudStorage(['a', 'b'])`, never a `for` loop per key. Key `[a-zA-Z0-9_-]{1,128}` (cannot start with `__`), value string `<= 1024` bytes, max `128` keys/Toy.
3. **Cache Reads, Never Poll**: Fetch `getRankList` / `getCloudStorage` once and refresh on explicit user action. Never put SDK calls in `setInterval`, loops, or `update`/`fixedUpdate`/`render`.
4. **Rate-Limit Backoff (`307044`)**: Quota is shared across **all players of the Toy**. Never hardcode QPS numbers; `createToyBridge` automatically retries `type === 'http_error' && code === 307044` with jittered exponential backoff. Still guard UI actions cleanly.
5. **Leaderboard Semantics (`submitScore` / `getMyRank`)**: `board` is `1..5` (default `1`); `score` is an absolute integer in `[-16777216, 16777215]` (server keeps max only). Check `myRank.ranked` (not `score`, since `0` and negative scores are valid!).
6. **Input Safety (`checkInputSafety`)**: Available to all Toys without extra permission. Call on user submit (not per keystroke). Check `res.passed` (`status === 'ok'`); treat `'unavailable'` strictly as **not passed** and ask the player to retry. `scene` must be ASCII `[A-Za-z0-9_.:-]{1,64}`.
7. **App-Only vs Cross-Platform**: `saveImageToAlbum`, `share`, `closeBrowser`, `onContainerChange`, `getContainerState`, `setContainerMode` are **Bilibili App only** (check `await toy.isSupport(...)`; `toy.saveImage(...)` falls back to `<a download>` on Web). `getQrCode` works on both App and Web.
8. **User Gesture Required**: `navigate`, `openChargePanel`, `requestCamera`, `requestMicrophone` MUST run directly inside a user gesture handler (`click`/`pointerup`). Call `videoEl.play().catch(() => {})` on camera streams (required on iOS) and always call `toy.stopMedia(stream)` when done.
9. **Container Mode Verification**: `setContainerMode` Promise resolution does NOT mean the mode switched; subscribe with `onContainerChange` first and verify the emitted state. Mobile does not support `landscape` with `immersive: false`.
10. **Charge Unlock (`charge_unlock`, whitelist-only)**: `minPrice` is in **fen (分)** (`1200` = 12 RMB; 6 RMB does NOT unlock content). Treat any `status !== 'ok'` as locked. On `onChargeUnlockChange`, update UI in-place — **NEVER `location.reload()`**.
11. **Privacy (`toyOpenId`)**: Never log `toyOpenId` publicly or send it to third-party analytics.

See [toy-sdk-api.md](references/toy-sdk-api.md) and [types/toy.d.ts](types/toy.d.ts) for every method signature and constraint.

---

## 3. Account Capability Permissions & Review Flags

Check `requiredCapabilities` printed by `npm run toy:check` / `npm run package:toy`. Apply in Bilibili Toy Creator Settings (`/toy/publish` -> 能力权限) before review if used:

| Capability Code | Trigger Condition | Notes |
|---|---|---|
| `AUDIO_VIDEO_UPLOAD` | Package includes local `.mp3`/`.wav`/`.ogg`/`.mp4`/`.webm` | **Tip**: HGame's 0-KB WebAudio synth (`audio.playSynth`, `createProceduralBgm`) requires **no** audio files and avoids this permission! |
| `EXTERNAL_SERVICE_ACCESS` | Connects to non-Bilibili external APIs or loads external CDN fonts/images/media | Must declare exact domain whitelist in Creator Settings (no protocol/port/path/IP/wildcard). |
| `USER_CONTENT_INPUT` | Accepts user text, images, files, or freehand drawing/handwriting | If free-drawing is enabled, **must** pass `--watermark` on `toy create`/`update`. |
| `LARGE_PACKAGE_UPLOAD` | Exceeds standard per-account package quota | Apply if your asset/WASM bundle exceeds standard quota. |
| `charge_unlock` | `getChargeUnlock` / `openChargePanel` | Platform whitelist-only + requires shell render mode; preview returns `unsupported`. |

---

## 4. Official `toy` CLI Publishing Workflow

Always drive the official `toy` CLI with `--json` and `--help-json` discovery (never guess flags from memory):

```powershell
# 0. Install / verify CLI & login (Windows PowerShell)
# irm https://boss.hdslb.com/toy-cli/toy/install.ps1 | iex
toy version
toy --help-json
toy whoami
```

### Two-Stage Safe Release Gate (Mandatory)
1. **Preflight First**: Run `npm run package:toy -- "<game-dir>" --version <ver> --slug <slug> --poster <cover> --icon <icon>` (and `python3 "<official-toy-skill>/scripts/toy_doctor.py"` if installed). Fix all `ERROR`s; report every `WARN` to the user.
2. **Stage 1 — Preview Only (NO `--yes`)**:
   - First publish: `toy create "<build-dir-or-zip>" --title "<title>" --slug <slug> --category GAME --poster <cover> --icon <icon> --visibility link-only --json`
   - Update existing (check `toy history "<path>" --json` + `toy mylist --json` first; **preserve original `--slug`**):
     `toy update <id> "<build-dir-or-zip>" --json`
   - Share the returned `preview_url` with the user so they can verify in browser / Bilibili App.
3. **Stage 2 — Explicit Confirmation & Submit (`--yes`)**:
   - Present target `id`, `title`, `slug`, and change summary, and ask the user explicitly whether to submit for review.
   - **Only after explicit confirmation**, re-run the **exact same command** with `--yes`.
   - Remind the user that sharing should use `https://www.bilibili.com/toy/<slug>/index.html` (avoid bare `/<slug>/`).
4. **Optional Post-Publish Actions**:
   - Bind to Bilibili video (instant, no review): `toy video mine --json`, `toy video bind <BV> --toy <id> --json`.
   - One-time end-of-task creator notice check: `toy notify --new --json` (only mention if `new_count > 0`; never say it marks web notifications read).

---

## 5. Staying Up-to-Date with Newer Toy SDK & CLI Releases

Bilibili Toy actively ships new SDK capabilities and CLI flags. Before adopting a newer platform capability:
1. Check local CLI updates & live schema:
   - `toy upgrade --check` / `toy upgrade`
   - `toy --help-json` (or fetch `https://boss.hdslb.com/toy-cli/toy/latest/VERSION` and `commands.json`)
2. Sync the upstream official skill (`bilibili/toy`):
   - `npx -y skills add bilibili/toy --skill toy -g -y` or `npx skills check` / `npx skills update`
3. Check the live SDK script/docs & `toy.d.ts` at `https://www.bilibili.com/toy/publish/sdk` (and `//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js`), then update `assets/runtime/integrations/bilibili-toy.js` and `types/toy.d.ts` if new `window.toy` methods appear.
