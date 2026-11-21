import { SpringDamper2D } from '../time/tween.js';
import { createUiSurfaceSpring } from '../ui/ux-motion.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * @typedef {object} WorldHud3DAnchorOptions
 * @property {number} x World X.
 * @property {number} y World Y.
 * @property {number} z World Z.
 * @property {string} [text] Short icon/numeric label (e.g. "♥ 3" or "⚡").
 * @property {number} [progress] Optional bar ratio [0..1].
 * @property {number} [offsetY=0] Screen-space Y offset in pixels.
 * @property {number} [maxDistance=45] Distance beyond which anchor hides.
 * @property {boolean} [visible=true]
 */

/**
 * @typedef {object} WorldHud3DOptions
 * @property {{ worldToScreen: (x: number, y: number, z: number, out?: object | null, viewIndex?: number) => { x: number, y: number, ndcZ: number, visible: boolean }, camera?: { position?: { x: number, y: number, z: number } } }} renderer Three adapter exposing `worldToScreen`.
 * @property {HTMLElement} container Screen overlay element (pointer-events: none).
 * @property {number} [maxItems=32] Pooled DOM anchor count.
 * @property {number} [halfLife=0.045] Screen-space spring smoothing half-life (seconds); 0 disables smoothing.
 * @property {() => HTMLElement} [createElement] Optional custom DOM element factory per pooled slot.
 * @property {(el: HTMLElement, data: WorldHud3DAnchorOptions, screen: { x: number, y: number, scale: number, opacity: number }) => void} [renderElement] Optional custom updater.
 */

/**
 * Pooled world-space-to-screen DOM HUD anchor manager for 3D games.
 * Projects 3D world coordinates via `renderer.worldToScreen`, hides offscreen/behind-camera items,
 * and smooths screen motion with `SpringDamper2D`.
 *
 * @param {WorldHud3DOptions} options
 */
export function createWorldHud3D(options) {
  if (!options?.renderer || typeof options.renderer.worldToScreen !== 'function') {
    throw new TypeError('createWorldHud3D requires renderer.worldToScreen');
  }
  if (!options?.container || typeof options.container.appendChild !== 'function') {
    throw new TypeError('createWorldHud3D requires a DOM container');
  }

  const renderer = options.renderer;
  const container = options.container;
  const doc = container.ownerDocument ?? globalThis.document;
  const maxItems = Math.max(1, options.maxItems ?? 32);
  const halfLife = Number.isFinite(options.halfLife) && options.halfLife >= 0 ? options.halfLife : 0.045;
  const renderElement = typeof options.renderElement === 'function' ? options.renderElement : null;

  const createSlotEl = typeof options.createElement === 'function'
    ? options.createElement
    : () => {
        const el = doc.createElement('div');
        el.className = 'hg-world-hud-item';
        if (el.style) {
          el.style.position = 'absolute';
          el.style.left = '0';
          el.style.top = '0';
          el.style.pointerEvents = 'none';
          el.style.transformOrigin = '50% 100%';
          el.style.willChange = 'transform, opacity';
        }
        return el;
      };

  const slots = [];
  for (let i = 0; i < maxItems; i++) {
    const el = createSlotEl();
    el.hidden = true;
    container.appendChild(el);
    slots.push({
      el,
      spring: new SpringDamper2D({ halfLife }),
      wasVisible: false,
      lastText: null,
    });
  }

  const scratchScreen = { x: 0, y: 0, ndcZ: 0, visible: false };
  const activeMap = new Map();

  function update(items, dt = 1 / 60) {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    const camPos = renderer.camera?.position;
    let used = 0;

    for (let i = 0; i < items.length && used < maxItems; i++) {
      const item = items[i];
      if (!item || item.visible === false) continue;

      const slot = slots[used];
      renderer.worldToScreen(item.x, item.y, item.z, scratchScreen, item.viewIndex ?? 0);

      let dist = 0;
      if (camPos) {
        dist = Math.hypot(item.x - (camPos.x || 0), item.y - (camPos.y || 0), item.z - (camPos.z || 0));
      }
      const maxDist = Number.isFinite(item.maxDistance) ? item.maxDistance : 45;
      const visible = scratchScreen.visible && dist <= maxDist;

      if (!visible) {
        slot.el.hidden = true;
        slot.wasVisible = false;
        continue;
      }

      const targetX = scratchScreen.x;
      const targetY = scratchScreen.y + (Number.isFinite(item.offsetY) ? item.offsetY : 0);

      if (!slot.wasVisible || halfLife === 0) {
        slot.spring.snap(targetX, targetY);
      } else {
        slot.spring.step(safeDt, targetX, targetY);
      }
      slot.wasVisible = true;
      slot.el.hidden = false;

      const fadeRatio = maxDist > 0 ? clamp(1 - Math.max(0, dist - maxDist * 0.65) / (maxDist * 0.35), 0.15, 1) : 1;
      const scale = clamp(1 - dist * 0.008, 0.72, 1.05);

      if (renderElement) {
        renderElement(slot.el, item, { x: slot.spring.x, y: slot.spring.y, scale, opacity: fadeRatio });
      } else {
        if (item.text !== undefined && slot.lastText !== item.text) {
          slot.lastText = item.text;
          slot.el.textContent = String(item.text);
        }
        if (slot.el.style) {
          slot.el.style.transform = `translate3d(${slot.spring.x.toFixed(1)}px, ${slot.spring.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
          slot.el.style.opacity = fadeRatio.toFixed(3);
        }
      }

      if (item.id !== undefined) activeMap.set(item.id, slot);
      used++;
    }

    for (let i = used; i < maxItems; i++) {
      slots[i].el.hidden = true;
      slots[i].wasVisible = false;
    }

    return used;
  }

  function dispose() {
    activeMap.clear();
    for (const slot of slots) {
      slot.el.remove?.();
    }
    slots.length = 0;
  }

  return Object.freeze({
    update,
    getSlotCount: () => slots.length,
    dispose,
  });
}

/**
 * @typedef {object} SpatialPanel3DOptions
 * @property {object} THREE Three.js namespace.
 * @property {{ screenToRay?: (clientX: number, clientY: number, out?: object | null, viewIndex?: number | null) => { origin: { x: number, y: number, z: number }, direction: { x: number, y: number, z: number } } }} [renderer] Three adapter (required for pointer ray picking).
 * @property {number} [width=1.6] World-space panel width.
 * @property {number} [height=1.0] World-space panel height.
 * @property {number} [pixelWidth=512] Backing canvas width in pixels.
 * @property {number} [pixelHeight=320] Backing canvas height in pixels.
 * @property {number[]} [position=[0, 0, 0]] Base local position `[x, y, z]`.
 * @property {number[]} [rotation=[0, 0, 0]] Base Euler rotation `[rx, ry, rz]` in radians.
 * @property {number} [maxTiltDeg=10] 3D spring hover tilt in degrees.
 * @property {number} [hoverLift=0.12] Forward Z / upward Y lift on hover in world units.
 * @property {number} [idleFloatAmp=0.025] Gentle idle levitation amplitude in world units.
 * @property {boolean} [lit=false] Use `MeshStandardMaterial` instead of `MeshBasicMaterial`.
 * @property {(ctx: CanvasRenderingContext2D, w: number, h: number, state: import('../ui/ux-motion.js').UiSurfaceSpringState) => void} [draw] Canvas draw callback.
 * @property {(panel: object) => void} [onClick] Triggered when a pointer press + release hits the panel.
 * @property {(hovered: boolean, panel: object) => void} [onHoverChange]
 */

/**
 * True 3D spatial interactive UI plane / card for Three.js scenes and viewWorlds.
 * Combines a dynamic `CanvasTexture` plane with spring-driven 3D tilt/hover/press motion
 * and zero-allocation ray-quad pointer hit testing via `renderer.screenToRay`.
 *
 * @param {SpatialPanel3DOptions} options
 */
export function createSpatialPanel3D(options) {
  const THREE = options?.THREE;
  if (!THREE?.Mesh || !THREE?.PlaneGeometry || !THREE?.Group) {
    throw new TypeError('createSpatialPanel3D requires THREE (Group, Mesh, PlaneGeometry)');
  }

  const renderer = options.renderer ?? null;
  const width = Number.isFinite(options.width) && options.width > 0 ? options.width : 1.6;
  const height = Number.isFinite(options.height) && options.height > 0 ? options.height : 1.0;
  const pixelWidth = Math.max(32, (options.pixelWidth ?? 512) | 0);
  const pixelHeight = Math.max(32, (options.pixelHeight ?? 320) | 0);
  const basePos = Array.isArray(options.position) ? options.position : [0, 0, 0];
  const baseRot = Array.isArray(options.rotation) ? options.rotation : [0, 0, 0];
  const hoverLift = Number.isFinite(options.hoverLift) ? options.hoverLift : 0.12;
  const idleFloatAmp = Number.isFinite(options.idleFloatAmp) ? options.idleFloatAmp : 0.025;
  const drawFn = typeof options.draw === 'function' ? options.draw : null;

  let canvas = null;
  let ctx = null;
  let texture = null;
  if (typeof globalThis.document?.createElement === 'function') {
    canvas = globalThis.document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    ctx = canvas.getContext?.('2d') ?? null;
    if (THREE.CanvasTexture) {
      texture = new THREE.CanvasTexture(canvas);
      if ('SRGBColorSpace' in THREE && 'colorSpace' in texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
      }
    }
  }

  const geometry = new THREE.PlaneGeometry(width, height);
  const MaterialCtor = options.lit && THREE.MeshStandardMaterial
    ? THREE.MeshStandardMaterial
    : (THREE.MeshBasicMaterial ?? THREE.MeshStandardMaterial);
  const material = new MaterialCtor({
    ...(texture ? { map: texture } : {}),
    transparent: true,
    ...(THREE.DoubleSide !== undefined ? { side: THREE.DoubleSide } : {}),
  });

  const root = new THREE.Group();
  root.position?.set?.(basePos[0] || 0, basePos[1] || 0, basePos[2] || 0);
  root.rotation?.set?.(baseRot[0] || 0, baseRot[1] || 0, baseRot[2] || 0);

  const mesh = new THREE.Mesh(geometry, material);
  root.add(mesh);

  const spring = createUiSurfaceSpring({
    maxTiltDeg: Number.isFinite(options.maxTiltDeg) ? options.maxTiltDeg : 10,
    hoverScale: Number.isFinite(options.hoverScale) ? options.hoverScale : 1.05,
    pressScale: Number.isFinite(options.pressScale) ? options.pressScale : 0.96,
    hoverLift,
    pressLift: -hoverLift * 0.35,
    idleFloatAmp,
    idleFloatSpeed: 1.9,
  });

  const scratchRay = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } };
  const scratchInv = THREE.Matrix4 ? new THREE.Matrix4() : null;
  const scratchOrigin = THREE.Vector3 ? new THREE.Vector3() : null;
  const scratchDir = THREE.Vector3 ? new THREE.Vector3() : null;
  const scratchPos = THREE.Vector3 ? new THREE.Vector3() : null;

  let dirty = true;
  let prevHovered = false;
  let pointerPressedInside = false;

  const panelApi = {
    object3d: root,
    mesh,
    spring,
    canvas,
    texture,
    markDirty() { dirty = true; },
    setBaseTransform(pos, rot) {
      if (pos) {
        basePos[0] = pos[0] || 0;
        basePos[1] = pos[1] || 0;
        basePos[2] = pos[2] || 0;
        root.position?.set?.(basePos[0], basePos[1], basePos[2]);
      }
      if (rot) {
        baseRot[0] = rot[0] || 0;
        baseRot[1] = rot[1] || 0;
        baseRot[2] = rot[2] || 0;
        root.rotation?.set?.(baseRot[0], baseRot[1], baseRot[2]);
      }
    },
    intersectRay(rayOrigin, rayDir) {
      if (!mesh.matrixWorld || !scratchInv || !scratchOrigin || !scratchDir || !scratchPos) return null;
      root.updateMatrixWorld?.(true);
      scratchInv.copy(mesh.matrixWorld).invert();
      scratchOrigin.set(rayOrigin.x, rayOrigin.y, rayOrigin.z).applyMatrix4(scratchInv);
      scratchPos.set(
        rayOrigin.x + rayDir.x,
        rayOrigin.y + rayDir.y,
        rayOrigin.z + rayDir.z,
      ).applyMatrix4(scratchInv);
      scratchDir.copy(scratchPos).sub(scratchOrigin);
      if (Math.abs(scratchDir.z) < 1e-6) return null;
      const t = -scratchOrigin.z / scratchDir.z;
      if (t < 0) return null;
      const hx = scratchOrigin.x + scratchDir.x * t;
      const hy = scratchOrigin.y + scratchDir.y * t;
      const halfW = width * 0.5;
      const halfH = height * 0.5;
      if (hx < -halfW || hx > halfW || hy < -halfH || hy > halfH) return null;
      return {
        distance: t,
        nx: clamp(hx / halfW, -1, 1),
        ny: clamp(-hy / halfH, -1, 1),
      };
    },
    handlePointerMove(clientX, clientY, viewIndex = null) {
      if (!renderer?.screenToRay) return null;
      renderer.screenToRay(clientX, clientY, scratchRay, viewIndex);
      const hit = panelApi.intersectRay(scratchRay.origin, scratchRay.direction);
      if (hit) {
        spring.setHover(true, hit.nx, hit.ny);
      } else {
        spring.setHover(false);
      }
      if (prevHovered !== Boolean(hit)) {
        prevHovered = Boolean(hit);
        dirty = true;
        options.onHoverChange?.(prevHovered, panelApi);
      }
      return hit;
    },
    handlePointerDown(clientX, clientY, viewIndex = null) {
      const hit = panelApi.handlePointerMove(clientX, clientY, viewIndex);
      if (hit) {
        pointerPressedInside = true;
        spring.setPressed(true);
        dirty = true;
      }
      return hit;
    },
    handlePointerUp(clientX, clientY, viewIndex = null) {
      const wasDown = pointerPressedInside;
      pointerPressedInside = false;
      spring.setPressed(false);
      dirty = true;
      if (!wasDown) return false;
      const hit = panelApi.handlePointerMove(clientX, clientY, viewIndex);
      if (hit) {
        options.onClick?.(panelApi);
        return true;
      }
      return false;
    },
    update(dt) {
      const st = spring.step(dt);
      const degToRad = Math.PI / 180;
      mesh.rotation?.set?.(st.tiltX * degToRad, st.tiltY * degToRad, 0);
      mesh.position?.set?.(0, st.floatOffset, st.lift - st.floatOffset);
      mesh.scale?.set?.(st.scale, st.scale, 1);

      if (ctx && drawFn && (dirty || !st.settled)) {
        drawFn(ctx, pixelWidth, pixelHeight, st);
        if (texture) texture.needsUpdate = true;
        dirty = false;
      }
      return st;
    },
    dispose() {
      geometry.dispose?.();
      material.dispose?.();
      texture?.dispose?.();
    },
  };

  return Object.freeze(panelApi);
}
