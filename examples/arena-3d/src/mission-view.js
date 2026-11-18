const READY = 0x56ddff;
const BLOCKED = 0xff8a64;
const CHARGED = 0x6cf8b6;
const LOCKED = 0x59677a;
const SEGMENTS = 48;

export function createMissionView(THREE, world, objective) {
  const marks = new THREE.Group();
  world.add(marks);
  const rim = new THREE.RingGeometry(objective.radius - 0.075, objective.radius, SEGMENTS);
  const stem = new THREE.CylinderGeometry(0.09, 0.18, 1.8, 6);
  const crystal = new THREE.OctahedronGeometry(0.42);
  const gate = new THREE.TorusGeometry(1.4, 0.09, 8, 48);
  const arrow = new THREE.BufferGeometry();
  arrow.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.38, -0.23, 0, -0.25, 0.23, 0, -0.25], 3));
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: READY, toneMapped: false, side: THREE.DoubleSide });
  const guide = new THREE.Mesh(arrow, arrowMaterial);
  marks.add(guide);
  const geometries = [rim, stem, crystal, gate, arrow];
  const materials = [arrowMaterial];

  function marker(point, isExit) {
    const group = new THREE.Group();
    group.position.set(point.x, 0, point.z);
    marks.add(group);
    const material = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
    materials.push(material);
    const circle = new THREE.Mesh(rim, material);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.035;
    group.add(circle);

    const signal = new THREE.Mesh(isExit ? gate : crystal, material);
    signal.position.y = isExit ? 1.5 : 2.3;
    group.add(signal);
    if (isExit) return { material, signal };

    const pillar = new THREE.Mesh(stem, material);
    pillar.position.y = 0.9;
    group.add(pillar);
    const fill = new THREE.RingGeometry(objective.radius - 0.32, objective.radius - 0.17, SEGMENTS);
    geometries.push(fill);
    const progress = new THREE.Mesh(fill, material);
    progress.rotation.x = -Math.PI / 2;
    progress.position.y = 0.04;
    group.add(progress);
    return { material, signal, fill };
  }

  const beacons = objective.beacons.map(point => marker(point, false));
  const exit = marker(objective.exit, true);
  return {
    sync(mission, player, state) {
      const time = state.time;
      beacons.forEach(({ material, signal, fill }, index) => {
        const done = mission.charged[index];
        const active = mission.active === index;
        const progress = done ? 1 : active ? mission.progress / objective.holdSeconds : 0;
        material.color.setHex(done ? CHARGED : active && mission.blocked ? BLOCKED : READY);
        signal.rotation.y = time * (done ? 0.55 : 1.2);
        signal.position.y = 2.3 + Math.sin(time * 2.1 + index) * 0.16;
        fill.setDrawRange(0, Math.floor(progress * SEGMENTS) * 6);
      });
      const unlocked = mission.chargedCount === beacons.length;
      exit.material.color.setHex(unlocked ? CHARGED : LOCKED);
      exit.signal.visible = unlocked;

      let target = objective.exit;
      let nearest = Infinity;
      if (!unlocked) {
        objective.beacons.forEach((point, index) => {
          if (mission.charged[index]) return;
          const distance = Math.hypot(point.x - player.x, point.z - player.z);
          if (distance >= nearest) return;
          nearest = distance;
          target = point;
        });
      }
      const dx = target.x - player.x, dz = target.z - player.z;
      const distance = Math.hypot(dx, dz);
      guide.visible = !state.over && distance > objective.radius;
      if (guide.visible) {
        guide.position.set(player.x + dx / distance * 1.15, player.y + 0.08, player.z + dz / distance * 1.15);
        guide.rotation.y = Math.atan2(dx, dz);
        arrowMaterial.color.setHex(unlocked ? CHARGED : READY);
      }
    },
    dispose() {
      marks.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
