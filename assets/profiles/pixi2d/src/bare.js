import { startPixiGame } from './engine/startPixiGame.js';

await startPixiGame(({ app, Scene }) => {
  app.scenes.add(new Scene('main'));
  return { scene: 'main', state: () => ({ scene: app.scenes.current?.name ?? null }) };
});
