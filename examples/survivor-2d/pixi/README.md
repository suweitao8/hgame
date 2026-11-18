# 余烬守望 / Ember Watch

Follow either amber marker, collect an ember, and survive until the center ring opens. Defend the ring for five seconds to extract. Defeated enemies drop embers that unlock upgrades. WASD and arrows move. Click a card or press 1, 2, or 3 to take an upgrade.

The first extraction unlocks Storm. Retrieve both embers and hold the smaller center ring for seven seconds before the 17-second deadline. The game remembers the unlock and the selected mode across reloads.

Ember Watch uses the default Pixi starter and the deterministic survivor simulation in `../src/sim/`. The character catalog maps three originated ImageGen cutouts to HGame's atlas slots. The WebP files total about 21 KB and live in HGame's content-addressed asset store.

Generate `ember-watch` inside the WebAsset-managed HTML games root, then run the following commands from the engine checkout. The build script installs the game source in that generated project and runs its regular Pixi compiler.

```powershell
node scripts/create-game.mjs <game-dir> --preset pixi2d --bare --with audio,save,diagnostics --name "余烬守望" --no-git
npm --prefix <game-dir> ci
node examples/survivor-2d/pixi/build.mjs <game-dir>
node examples/survivor-2d/pixi/simulate.mjs
node examples/survivor-2d/pixi/simulate.mjs --storm
npm run playtest -- ember-watch --webasset --scenario examples/survivor-2d/pixi/playtest.mjs --ready '#game[data-engine-ready=true]'
```

For a source checkout without the shared media store, add `--procedural` to the build command to use the starter's procedural atlas. The standard build restores the authored characters using the manifest and `HGAME_ASSET_STORE`. To replace a character, update its catalog path and refresh the manifest with the asset CLI.
