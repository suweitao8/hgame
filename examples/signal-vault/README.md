# 信号密室 / Signal Vault

A three-room grid puzzle. Push signal cells onto sockets of the same shape, then walk through the opened gate. Move with arrow keys, WASD, or a swipe. Z and the undo button reverse the last move. Completing a room advances the saved checkpoint when the player selects the next room.

The reference uses the default Pixi 2D profile, a TileMap with mutable gate tiles, and the command-driven scheduler. The board art is drawn to a shared atlas from source. Grid rules and layouts are separate from rendering and can run under Node.

```powershell
node scripts/create-game.mjs <game-dir> --preset pixi2d --bare --tick-hz 0 --with audio,save,tilemap2d --name "信号密室" --no-git
npm --prefix <game-dir> ci
node examples/signal-vault/build.mjs <game-dir>
npm run test:examples
npm run playtest -- signal-vault --webasset --scenario examples/signal-vault/playtest.mjs --ready '#game[data-engine-ready=true]'
```

Generate `signal-vault` under the WebAsset-managed games directory. The reference build uses the generated project's compiler and installs the WebAsset runtime import map.
