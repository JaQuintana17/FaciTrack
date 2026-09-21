/**
 * ccs-building-scene.js
 * ----------------------
 * Initialises the Three.js renderer, scene, lighting, sky gradient,
 * ground plane, and exposes them to the rest of the modules.
 */

import * as THREE from 'three';

// ─── Exported singletons ────────────────────────────────────────────────────
export let renderer, scene, clock;

/**
 * createScene()
 * Boots the renderer, builds the scene graph with lights and environment,
 * and appends the canvas to #canvas-container.
 */
export function createScene() {
  // ── Renderer ──────────────────────────────────────────────────────────
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled  = true;
  renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace   = THREE.SRGBColorSpace;
  renderer.toneMapping        = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const container = document.getElementById('canvas-container');
  container.appendChild(renderer.domElement);

  // ── Scene ─────────────────────────────────────────────────────────────
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd6eaf8, 60, 200);

  // Sky gradient via a large sphere with vertex colours
  _buildSkyGradient();

  // ── Lights ────────────────────────────────────────────────────────────
  _buildLights();

  // ── Ground plane ──────────────────────────────────────────────────────
  _buildGround();

  // ── Clock ─────────────────────────────────────────────────────────────
  clock = new THREE.Clock();

  // ── Resize handler ────────────────────────────────────────────────────
  window.addEventListener('resize', _onResize);
}

// ─── Private helpers ────────────────────────────────────────────────────────

function _buildSkyGradient() {
  // Shader-based sky sphere with top→bottom gradient
  const vertexShader = `
    varying vec3 vWorldPos;
    void main() {
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = `
    varying vec3 vWorldPos;
    void main() {
      float t = clamp((vWorldPos.y + 30.0) / 120.0, 0.0, 1.0);
      // horizon: soft blue-white   →  zenith: CSPC deep blue
      vec3 horizon = vec3(0.85, 0.93, 0.98);
      vec3 zenith  = vec3(0.04, 0.24, 0.38);
      gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
    }
  `;
  const skyMat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
  });
  const skyGeo  = new THREE.SphereGeometry(180, 32, 15);
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.name  = 'Sky';
  scene.add(skyMesh);
}

function _buildLights() {
  // Ambient — soft fill
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  ambient.name  = 'AmbientLight';
  scene.add(ambient);

  // Primary sun — angled from upper-right-front (matches photos)
  const sun       = new THREE.DirectionalLight(0xfff8e7, 1.6);
  sun.name        = 'SunLight';
  sun.position.set(35, 60, 40);
  sun.castShadow  = true;
  sun.shadow.mapSize.width  = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near    = 1;
  sun.shadow.camera.far     = 220;
  sun.shadow.camera.left    = -50;
  sun.shadow.camera.right   =  50;
  sun.shadow.camera.top     =  50;
  sun.shadow.camera.bottom  = -50;
  sun.shadow.bias           = -0.0003;
  scene.add(sun);

  // Soft fill from the opposite side
  const fill    = new THREE.DirectionalLight(0xddeeff, 0.35);
  fill.name     = 'FillLight';
  fill.position.set(-30, 20, -30);
  scene.add(fill);

  // Hemisphere (sky ↔ ground bounce)
  const hemi     = new THREE.HemisphereLight(0xb0d8f5, 0x8aaf6e, 0.4);
  hemi.name      = 'HemiLight';
  scene.add(hemi);
}

function _buildGround() {
  // Concrete apron + grass field
  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x8fae6b }); // grass
  const ground    = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  ground.name = 'Ground';
  scene.add(ground);

  // Concrete slab in front of the building
  const slabGeo = new THREE.PlaneGeometry(56, 20);
  const slabMat = new THREE.MeshLambertMaterial({ color: 0xbdbdbd });
  const slab    = new THREE.Mesh(slabGeo, slabMat);
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(0, 0.02, 16);
  slab.receiveShadow = true;
  slab.name = 'ConcreteSlab';
  scene.add(slab);
}

function _onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
}
