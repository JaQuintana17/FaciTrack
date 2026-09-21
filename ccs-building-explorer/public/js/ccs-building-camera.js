/**
 * ccs-building-camera.js
 * -----------------------
 * Sets up the PerspectiveCamera and exposes smooth animated
 * camera transition helpers used by interactions and UI modules.
 */

import * as THREE from 'three';

// ─── Exported singletons ────────────────────────────────────────────────────
export let camera;

// Default (home) position — front-quarter view matching the real photo angle
export const HOME_POSITION = new THREE.Vector3(0, 22, 52);
export const HOME_TARGET   = new THREE.Vector3(0,  8,  0);

// Active transition state
let _transitioning = false;
let _transStart    = 0;
let _transDuration = 1400; // ms

let _fromPos    = new THREE.Vector3();
let _toPos      = new THREE.Vector3();
let _fromTarget = new THREE.Vector3();
let _toTarget   = new THREE.Vector3();

let _controls = null; // injected by ccs-building-controls after creation

/**
 * createCamera()
 * Called once during init. Sets up a PerspectiveCamera at the home position.
 */
export function createCamera() {
  camera = new THREE.PerspectiveCamera(
    45,                                          // FOV
    window.innerWidth / window.innerHeight,      // aspect
    0.5,                                         // near
    500                                          // far
  );
  camera.position.copy(HOME_POSITION);
  camera.lookAt(HOME_TARGET);

  // Update aspect on resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
}

/**
 * Inject the OrbitControls reference so camera transitions can
 * also move the controls target smoothly.
 * @param {OrbitControls} controls
 */
export function injectControls(controls) {
  _controls = controls;
}

/**
 * moveTo(targetPos, targetLook, duration?)
 * Smoothly animates the camera from its current position to targetPos,
 * pointing at targetLook.
 *
 * @param {THREE.Vector3} targetPos   World-space destination
 * @param {THREE.Vector3} targetLook  World-space look-at point
 * @param {number}        duration    Animation duration in ms (default 1400)
 */
export function moveTo(targetPos, targetLook, duration = 1400) {
  _fromPos.copy(camera.position);
  _toPos.copy(targetPos);

  _fromTarget.copy(_controls ? _controls.target : HOME_TARGET);
  _toTarget.copy(targetLook);

  _transDuration = duration;
  _transStart    = performance.now();
  _transitioning = true;
}

/**
 * moveHome()
 * Animate back to the default front-quarter view.
 */
export function moveHome() {
  moveTo(HOME_POSITION, HOME_TARGET, 1200);
}

/**
 * updateCameraTransition()
 * Called every frame from the animation loop.
 * Returns true while a transition is in progress.
 * @returns {boolean}
 */
export function updateCameraTransition() {
  if (!_transitioning) return false;

  const elapsed  = performance.now() - _transStart;
  const progress = Math.min(elapsed / _transDuration, 1);
  const t        = _easeInOutCubic(progress);

  camera.position.lerpVectors(_fromPos, _toPos, t);

  if (_controls) {
    _controls.target.lerpVectors(_fromTarget, _toTarget, t);
    _controls.update();
  }

  if (progress >= 1) {
    _transitioning = false;
    camera.position.copy(_toPos);
    if (_controls) {
      _controls.target.copy(_toTarget);
      _controls.update();
    }
  }

  return _transitioning;
}

/**
 * isTransitioning()
 * @returns {boolean}
 */
export function isTransitioning() {
  return _transitioning;
}

// ─── Easing ─────────────────────────────────────────────────────────────────
function _easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
