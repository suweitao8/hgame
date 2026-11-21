import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// GLB files are served only from the local catalogued model endpoint.
// The viewer never creates a placeholder mesh or fabricates animation clips.
export class CharacterModelViewer {
  constructor({ stage, uvCanvas, uvSelect, uvControls, runButton, status }) {
    Object.assign(this, { stage, uvCanvas, uvSelect, uvControls, runButton, status });
    this.version = 0;
    this.animationFrame = 0;
    this.uvSelect.addEventListener('change', () => this.drawUV());
    this.runButton.addEventListener('click', () => this.toggleRun());
  }

  clear() {
    this.version += 1;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.controls?.dispose();
    if (this.gltf) {
      this.gltf.scene.traverse(node => {
        node.geometry?.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (!material) continue;
          for (const value of Object.values(material)) {
            if (value?.isTexture) value.dispose();
          }
          material.dispose();
        }
      });
    }
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.stage.replaceChildren();
    this.stage.hidden = true;
    this.uvCanvas.hidden = true;
    this.uvControls.hidden = true;
    this.runButton.hidden = true;
    this.runButton.disabled = true;
    this.runButton.textContent = '播放 Run';
    this.uvSelect.replaceChildren();
    this.renderer = null;
    this.controls = null;
    this.mixer = null;
    this.runAction = null;
    this.playing = false;
    this.gltf = null;
    this.uvMeshes = [];
    this.status.textContent = '';
  }

  async open(url, mode) {
    this.clear();
    if (!url) return;
    const currentVersion = this.version;
    this.status.textContent = '正在载入模型…';
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(url);
    } catch (error) {
      if (currentVersion === this.version) {
        this.status.textContent = '模型加载失败：请检查 GLB 是否自包含贴图、是否使用了不支持的压缩格式。';
        console.error('GLB load failed:', error);
      }
      return;
    }
    if (currentVersion !== this.version) {
      gltf.scene.traverse(node => node.geometry?.dispose());
      return;
    }
    this.gltf = gltf;
    if (mode === 'uv') {
      this.showUV();
      return;
    }
    try {
      this.show3D(mode);
    } catch (error) {
      this.status.textContent = '无法显示 3D 模型：当前浏览器可能未启用 WebGL。';
      console.error('3D renderer unavailable:', error);
    }
  }

  show3D(mode) {
    this.stage.hidden = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202721);
    scene.add(new THREE.HemisphereLight(0xf6faff, 0x53614e, 2.2));
    const keyLight = new THREE.DirectionalLight(0xfff8e8, 2.7);
    keyLight.position.set(4, 8, 6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x99bbfa, 1.1);
    fillLight.position.set(-5, 3, -4);
    scene.add(fillLight);
    scene.add(this.gltf.scene);

    const bounds = new THREE.Box3().setFromObject(this.gltf.scene);
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const size = Math.max(bounds.isEmpty() ? 1 : bounds.getSize(new THREE.Vector3()).length(), 0.1);
    const camera = new THREE.PerspectiveCamera(40, 1, Math.max(size / 10000, 0.001), size * 100);
    camera.position.copy(center).add(new THREE.Vector3(size * 0.9, size * 0.4, size * 1.25));
    const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'default' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer = renderer;
    this.stage.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.minDistance = size * 0.25;
    controls.maxDistance = size * 12;
    controls.update();
    this.controls = controls;

    const resize = () => {
      if (!this.renderer) return;
      const width = Math.max(1, this.stage.clientWidth);
      const height = Math.max(1, this.stage.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(this.stage);
    this.inView = true;
    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(entries => {
        this.inView = entries.some(entry => entry.isIntersecting);
      });
      this.intersectionObserver.observe(this.stage);
    }

    const meshes = [];
    this.gltf.scene.traverse(node => { if (node.isMesh) meshes.push(node); });
    const triangles = meshes.reduce((total, mesh) => {
      const geometry = mesh.geometry;
      return total + Math.floor((geometry.index?.count || geometry.attributes.position?.count || 0) / 3);
    }, 0);
    this.status.textContent = `${meshes.length} 个网格 · ${triangles.toLocaleString()} 个三角面 · 鼠标拖动旋转，滚轮缩放`;

    if (mode === 'low') {
      const run = this.gltf.animations.find(clip => /run|running|跑步|奔跑/i.test(clip.name));
      this.runButton.hidden = false;
      if (run) {
        this.mixer = new THREE.AnimationMixer(this.gltf.scene);
        this.runAction = this.mixer.clipAction(run);
        this.runButton.disabled = false;
        this.runAction.play();
        this.playing = true;
        this.runButton.textContent = '暂停 Run';
        this.status.textContent += ` · Run 动画：${run.name}`;
      } else {
        this.runButton.textContent = '无 Run 动画';
        this.runButton.disabled = true;
        this.status.textContent += ' · 模型未包含 Run 动画';
      }
    }
    const clock = new THREE.Clock();
    const tick = () => {
      this.animationFrame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      if (!document.hidden && this.inView) {
        if (this.playing) this.mixer?.update(dt);
        controls.update();
        renderer.render(scene, camera);
      }
    };
    tick();
  }

  toggleRun() {
    if (!this.runAction) return;
    this.playing = !this.playing;
    this.runAction.paused = !this.playing;
    this.runButton.textContent = this.playing ? '暂停 Run' : '播放 Run';
  }

  showUV() {
    this.uvCanvas.hidden = false;
    this.uvMeshes = [];
    this.gltf.scene.traverse(node => {
      if (node.isMesh && node.geometry?.attributes.uv) {
        this.uvMeshes.push(node);
      }
    });
    if (!this.uvMeshes.length) {
      this.status.textContent = '该模型没有 UV 坐标，无法显示展开图。';
      return;
    }
    this.uvControls.hidden = false;
    this.uvMeshes.forEach((mesh, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = mesh.name || `网格 ${index + 1}`;
      this.uvSelect.append(option);
    });
    this.status.textContent = 'UV 展开线框 · 可选择网格查看坐标与贴图';
    this.drawUV();
  }

  drawUV() {
    const canvas = this.uvCanvas;
    const context = canvas.getContext('2d');
    if (!context) {
      this.status.textContent = '当前浏览器无法绘制 UV 画布。';
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#171e18';
    context.fillRect(0, 0, width, height);
    const boxSize = Math.min(width - 40, height - 40);
    const x = (width - boxSize) / 2;
    const y = (height - boxSize) / 2;
    context.fillStyle = '#263127';
    context.fillRect(x, y, boxSize, boxSize);
    const mesh = this.uvMeshes[Number(this.uvSelect.value) || 0];
    if (!mesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const image = material?.map?.image;
    if (image) {
      try { context.drawImage(image, x, y, boxSize, boxSize); } catch { /* unsupported image source */ }
    }
    const uv = mesh.geometry.getAttribute('uv');
    const index = mesh.geometry.index;
    const count = index ? index.count : uv.count;
    const max = Math.min(count - (count % 3), 300000);
    context.save();
    context.beginPath();
    context.rect(x, y, boxSize, boxSize);
    context.clip();
    context.strokeStyle = '#d6f59b';
    context.lineWidth = 1;
    for (let i = 0; i < max; i += 3) {
      context.beginPath();
      for (let j = 0; j < 3; j++) {
        const vertex = index ? index.getX(i + j) : i + j;
        const u = uv.getX(vertex);
        const v = uv.getY(vertex);
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        const px = x + u * boxSize;
        // glTF 2.0 UV origin (0, 0) is the upper-left of the texture.
        const py = y + v * boxSize;
        if (j === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.stroke();
    }
    context.restore();
    context.strokeStyle = '#9eb794';
    context.lineWidth = 2;
    context.strokeRect(x, y, boxSize, boxSize);
    this.status.textContent = `UV：${mesh.name || '未命名网格'} · ${Math.floor(max / 3).toLocaleString()} 个三角面${max < count ? '（为流畅预览已限制绘制数量）' : ''}`;
  }
}
