# 25. Universal Game Template Kit (`kit/`)

> Standardizes **Design (策划)**, **UI**, **Gameplay**, **Art**, and **Audio** into one drop-in production layer (`assets/runtime/kit/`).

## Quick Wiring

```js
import {
  createBlueprintFromIdea,
  getArtTheme,
  createGameSession,
  mountGameShell,
} from '../vendor/hgame/kit/index.js';

const blueprint = createBlueprintFromIdea({
  id: 'neon-rush',
  title: '霓虹突围',
  genre: 'action-2d', // action-2d | horde-2d | arena-3d | card-ui
  theme: 'cyber',     // scifi | arcane | arcade | cyber | cozy | ink
});

const theme = getArtTheme(blueprint.art.theme);
const session = createGameSession({ blueprint, app });
const shell = mountGameShell({ root: document.body, session });
```

## Five-Pillar Exports (`kit/index.js`)

| Pillar | Module | Key APIs |
|---|---|---|
| **Design (策划)** | `kit/blueprint.js` | `GENRE_ARCHETYPES`, `defineGameBlueprint`, `evaluateBlueprintBalance`, `createBlueprintFromIdea` |
| **Art (美术)** | `kit/art-themes.js` | `ART_THEMES`, `STANDARD_ART_SPEC`, `getArtTheme`, `resolvePresentationPreset`, `listArtThemes` |
| **Audio (音效)** | `kit/audio-director.js` | `GAME_AUDIO_EVENTS`, `DEFAULT_AUDIO_MATRIX`, `AUDIO_PROFILES`, `createAudioDirector` |
| **Gameplay** | `kit/game-session.js` | `createGameSession` (`startRun`, `presentChoices`, `recordHit`, `recordKill`, `damagePlayer`, `endRun`, `update`, `snapshot`) |
| **UI Shell** | `kit/game-shell-dom.js` | `mountGameShell` (Zero-Prose title/HUD/cards/pause/result/debug wired to `bindUiUxDOM`) |

## CLI Commands

```powershell
# Scaffold from archetype + theme (writes src/game.design.json + complete playable starter)
node scripts/create-game.mjs "<game-dir>" --archetype action-2d --theme cyber --name "霓虹突围"

# Generate or validate a 5-pillar blueprint
npm run blueprint:check -- --init --id my-game --title "标题" --genre arena-3d --theme arcane --out game.design.json
npm run blueprint:check -- "<game-dir>/src/game.design.json"
```
