/**
 * ccs-building-controls.js
 * -------------------------
 * Wraps Three.js OrbitControls with sensible defaults for a
 * building-explorer experience and exposes the controls instance.
 */

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { camera, HOME_TARGET, injectControls } from './ccs-building-camera.js';
import { renderer } from './ccs-building-scene.js';

// ─── Exported singleton ─────────────────────────────────────────────────────
export let controls;

/**
 * createControls()
 * Must be called after createCamera() and createScene().
 */
export function createControls() {
  controls = new OrbitControls(camera, renderer.domElement);

  // Damping — smooth inertia feel
  controls.enableDamping    = true;
  controls.dampingFactor    = 0.07;

  // Zoom limits
  controls.minDistance      = 10;
  controls.maxDistance      = 110;

  // Vertical orbit limits (don't flip underground)
  controls.minPolarAngle    = 0.15;                // ~8.5°  above zenith
  controls.maxPolarAngle    = Math.PI / 2 - 0.05; // just above horizon

  // Pan limits — keep building in frame
  controls.maxTargetRadius  = 28;

  // Start target at building centre
  controls.target.copy(HOME_TARGET);

  // Touch support
  controls.touches = {
    ONE  : 1, // ROTATE
    TWO  : 2, // DOLLY_PAN
  };

  controls.update();

  // Register with camera module so transitions also move the target
  injectControls(controls);
}

/**
 * updateControls()
 * Must be called every frame (only effective when damping is enabled).
 */
export function updateControls() {
  controls.update();
}
