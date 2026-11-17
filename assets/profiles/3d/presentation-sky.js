// Optional scene-owned procedural sky, shared by both 3D starters.
export async function installPresentationSky({ app, scene, renderer, THREE, base, Component, Entity, settings }) {
  if (!settings || settings.enabled === false) return null;
  const { enabled, environment = false, ...options } = settings;
  const { createProceduralSky3D } = await import(base + '/integrations/sky3d.js');
  if (app.disposed) return null;
  const world = renderer.getWorld(scene);
  const previousEnvironment = world.environment;
  const sky = createProceduralSky3D(THREE, options);
  try {
    world.add(sky.mesh);
    renderer.setSky(sky);
    sky.update(0, renderer.camera.position);
    if (environment) sky.bakeEnvironment(renderer.renderer, { targetScene: world });
    const driver = scene.add(new Entity({ name: 'presentation-sky' }));
    driver.addComponent(new class extends Component {
      update(dt) { sky.update(dt, renderer.camera.position); }
    }());
    scene.onDispose(() => {
      if (world.environment === sky.environmentTexture) world.environment = previousEnvironment;
      renderer.setSky(null);
      sky.dispose();
    });
    return sky;
  } catch (error) {
    if (world.environment === sky.environmentTexture) world.environment = previousEnvironment;
    renderer.setSky(null);
    sky.dispose();
    throw error;
  }
}
