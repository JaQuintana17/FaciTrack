/**
 * ccs-building-animation.js
 * --------------------------
 * Main requestAnimationFrame render loop.
 * Coordinates the renderer, camera transitions, OrbitControls damping,
 * and any ongoing per-frame effects (pulse glow on selected room, etc.).
 */

import { renderer, scene, clock } from './ccs-building-scene.js';
import { camera, updateCameraTransition } from './ccs-building-camera.js';
import { updateControls }   from './ccs-building-controls.js';

// ─── State ───────────────────────────────────────────────────────────────────
let _animationId  = null;
let _buildingGroup = null;

// Subtle idle rotation speed while not interacting (0 = off)
const IDLE_ROTATE = 0;

/**
 * startAnimationLoop(buildingGroup)
 * Kick off the render loop.
 * @param {THREE.Group} buildingGroup  The building group reference (for per-frame effects)
 */
export function startAnimationLoop(buildingGroup) {
  _buildingGroup = buildingGroup;
  _loop();
}

/**
 * stopAnimationLoop()
 * Cancel the render loop (useful for cleanup / page unload).
 */
export function stopAnimationLoop() {
  if (_animationId !== null) {
    cancelAnimationFrame(_animationId);
    _animationId = null;
  }
}

// ─── Private loop ────────────────────────────────────────────────────────────

function _loop() {
  _animationId = requestAnimationFrame(_loop);

  const delta = clock.getDelta();

  // 1. Camera transition (smooth moveTo animations)
  updateCameraTransition();

  // 2. OrbitControls damping
  updateControls();

  // 3. Per-frame building effects
  if (_buildingGroup) {
    _pulseSelectedRoom(delta);
    _animatePlanters(delta);
  }

  // 4. Render
  renderer.render(scene, camera);
}

// ─── Per-frame effects ───────────────────────────────────────────────────────

let _pulseTime = 0;

/**
 * _pulseSelectedRoom()
 * Gives a subtle opacity pulse to any highlighted room mesh.
 */
function _pulseSelectedRoom(delta) {
  _pulseTime += delta;
  const pulse = 0.45 + 0.12 * Math.sin(_pulseTime * 3.0);

  if (!_buildingGroup) return;
  _buildingGroup.traverse(obj => {
    if (
      obj.userData.isRoom &&
      obj.material &&
      obj.material.color.getHex() === 0x1abc9c  // teal = highlighted
    ) {
      obj.material.opacity = pulse;
    }
  });
}

let _planterTime = 0;

/**
 * _animatePlanters()
 * Gives a very gentle sway to planter meshes — organic feel.
 */
function _animatePlanters(delta) {
  _planterTime += delta * 0.4;
  if (!_buildingGroup) return;
  _buildingGroup.traverse(obj => {
    if (obj.name && obj.name.startsWith('Plant_')) {
      // Extract indices from name  "Plant_<floor>_<idx>"
      const parts = obj.name.split('_');
      const idx   = parseInt(parts[2] || '0', 10);
      obj.rotation.z = Math.sin(_planterTime + idx * 0.7) * 0.018;
    }
  });
}
