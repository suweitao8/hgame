# Bilibili Toy JS SDK API Reference (`window.toy`)

> Script tag: `<script src="//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js"></script>` in `<head>` (auto-injected by `package-game.mjs --target toy` when Toy SDK usage is detected or `--toy-sdk` is passed).
> Type declarations: [types/toy.d.ts](../types/toy.d.ts) · HGame wrapper: `assets/runtime/integrations/bilibili-toy.js`.

## General Conventions

- All thrown `Error` messages start with `[ToySDK]`.
- Data APIs (`getAuthorProfile`, `getAuthorVideos`, `getAuthorRelation`, `getVideoUserActions`, `getChargeUnlock`) return `{ status, ... }` instead of rejecting on business state — always verify `status === 'ok'` before reading `data` / `items`.
- Cloud storage, shared storage, leaderboard, and media APIs return `Promise` and reject on failure (wrap in `try/catch`).
- Rate-limit rejections on storage / leaderboard / input safety have `error.type === 'http_error' && error.code === 307044`.

## Environment Support Matrix

| Method | Bilibili App | Web | Notes |
|---|---|---|---|
| `isSupport(ability)` | ✅ | ✅ | Check before calling App-only APIs |
| `navigate(req)` | ✅ | ✅ | Requires user gesture (`click`); `type`: `video\|space\|search\|opus\|tribee\|toy` |
| `saveImageToAlbum(req)` | ✅ | ❌ | App only; `base64Data <= 5MB` string len (recommend `<= 2MB`) or `url`. On Web use `<a download>` (handled by `bridge.saveImage`) |
| `share({ path })` | ✅ | ❌ | App only; `path` relative to `/toy/<slug>/` |
| `getQrCode({ path?, size? })` | ✅ | ✅ | `size` integer `[80, 1024]` (default `320`); returns `{ base64, url }` |
| `closeBrowser()` | ✅ | ❌ | App only |
| `getUserProfile()` | ✅ | ✅ | Returns `{ avatar, nickname, toyOpenId? }`; triggers platform consent modal on first call if needed; never log `toyOpenId` |
| `getAuthorProfile()` | ✅ | ✅ | Current Toy's author only |
| `getAuthorVideos({ videos })` | ✅ | ✅ | 1–50 items (`{ aid }` or `{ bvid }`) |
| `getAuthorRelation()` | ✅ | ✅ | `{ isFollowing, isAuthor, isOldFan, hasFanMedal, isCharging, ... }`; external mobile browser returns `unsupported` |
| `getVideoUserActions(req)` | ✅ | ✅ | `{ aids }` or `{ videos }`, 1–50 items; returns `liked`, `coinCount`, `favorited` |
| `getChargeUnlock({ minPrice })` | ✅ | ✅ | Whitelist + shell render mode only; `minPrice` in **fen** (`1200` = 12 RMB; 6 RMB does not unlock) |
| `openChargePanel({ minPrice })` | ✅ | ✅ | User gesture required; Promise resolve = panel opened, NOT payment success |
| `onChargeUnlockChange(fn)` | ✅ | ✅ | Re-checks on visibility return; update UI in-place (never `location.reload()`) |
| `setCloudStorage(items)` | ✅ | ✅ | User+Toy scoped; max 128 keys; key `[a-zA-Z0-9_-]{1,128}` (no `__` prefix); value `<= 1024` bytes |
| `getCloudStorage(keys?)` | ✅ | ✅ | Omit or `[]` for all keys |
| `removeCloudStorage(keys)` | ✅ | ✅ | Batch delete |
| `setSharedStorage(id, items)` | ✅ | ✅ | Player+Storage (`st_...`) scoped across authorized Toys; managed via `toy shared-storage` CLI |
| `getSharedStorage(id, keys?)` | ✅ | ✅ | Returns `Record<string, string>` |
| `removeSharedStorage(id, keys)` | ✅ | ✅ | Deletes current player's keys only |
| `submitScore({ board?, score })` | ✅ | ✅ | `board` `1..5` (default `1`); integer `score` in `[-16777216, 16777215]`; keeps personal best only |
| `getRankList({ board?, period?, limit? })` | ✅ | ✅ | `period`: `all\|month\|week\|day`; `limit <= 100`; guest readable |
| `getMyRank({ board?, period? })` | ✅ | ✅ | Check `ranked` boolean (NOT `score`, as `0`/negative scores are valid) |
| `checkInputSafety({ text, scene? })` | ✅ | ✅ | Open to all Toys; `text <= 16384` UTF-8 bytes; `scene` `[A-Za-z0-9_.:-]{1,64}`; `'unavailable'` is NOT passed |
| `requestCamera(options?)` | ✅ | ✅ | User gesture required; `options`: `{ facingMode?: 'user' \| 'environment' }`; call `video.play()` explicitly for iOS |
| `requestMicrophone()` | ✅ | ✅ | User gesture required; takes no parameters; returns live `MediaStream` |
| `stopMedia(stream)` | ✅ | ✅ | Must call when finished with camera/microphone |
| `onContainerChange(fn)` | ✅ | ❌ | App only; returns sync unsubscribe `() => void` |
| `getContainerState()` | ✅ | ❌ | App only; `{ deviceType, viewport, orientation, immersive, safeArea, changedFields }` |
| `setContainerMode({ orientation?, immersive? })` | ✅ | ❌ | App only; verify via `onContainerChange`; mobile disallows `landscape` + `immersive: false` |
