/**
 * ccs-building-interactions.js
 * -----------------------------
 * Handles all mouse/touch interactions:
 *   - Raycasting click → select room
 *   - Hover highlight
 *   - Search-by-room-code
 *   - Floor isolation toggle
 */

import * as THREE from 'three';
import { camera }            from './ccs-building-camera.js';
import { renderer, scene }   from './ccs-building-scene.js';
import { moveTo, moveHome }  from './ccs-building-camera.js';
import { highlightRoom, resetAllRooms } from './ccs-building-loader.js';
import { getRoomByCode, getRoomByObjectName, FLOOR_NAMES } from './ccs-building-room-data.js';
import { showRoomPanel, hideRoomPanel, showToast } from './ccs-building-ui.js';

// ─── State ───────────────────────────────────────────────────────────────────
let _buildingGroup    = null;
let _raycaster        = new THREE.Raycaster();
let _mouse            = new THREE.Vector2();
let _selectedMesh     = null;
let _hoveredMesh      = null;
let _activeFloor      = -1;   // -1 = all floors visible
let _roomMeshes       = [];

/**
 * initInteractions(buildingGroup)
 * Call once after the building is built.
 * @param {THREE.Group} buildingGroup
 */
export function initInteractions(buildingGroup) {
  _buildingGroup = buildingGroup;

  // Collect all room meshes upfront for fast raycasting
  buildingGroup.traverse(obj => {
    if (obj.userData.isRoom) _roomMeshes.push(obj);
  });

  // Event listeners
  renderer.domElement.addEventListener('click',     _onClick);
  renderer.domElement.addEventListener('mousemove', _onMouseMove);
  renderer.domElement.addEventListener('touchstart', _onTouch, { passive: true });

  // Search input
  const searchInput = document.getElementById('search-input');
  const searchBtn   = document.getElementById('search-btn');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') _handleSearch(searchInput.value);
    });
  }
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const input = document.getElementById('search-input');
      if (input) _handleSearch(input.value);
    });
  }

  // Floor buttons
  document.querySelectorAll('[data-floor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fi = parseInt(btn.dataset.floor, 10);
      setActiveFloor(fi === _activeFloor ? -1 : fi); // toggle
      // Update active state styling
      document.querySelectorAll('[data-floor]').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.floor, 10) === _activeFloor)
      );
    });
  });

  // Reset-view button
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetView();
    });
  }
}

// ─── Click / hover ───────────────────────────────────────────────────────────

function _onClick(event) {
  _setMouseFromEvent(event);
  _raycaster.setFromCamera(_mouse, camera);

  const hits = _raycaster.intersectObjects(_roomMeshes, false);
  if (hits.length > 0) {
    _selectRoom(hits[0].object);
  } else {
    // Click on empty space — deselect
    _deselect();
  }
}

function _onMouseMove(event) {
  _setMouseFromEvent(event);
  _raycaster.setFromCamera(_mouse, camera);

  const hits = _raycaster.intersectObjects(_roomMeshes, false);
  const hit  = hits.length > 0 ? hits[0].object : null;

  if (hit !== _hoveredMesh) {
    // Un-hover previous
    if (_hoveredMesh && _hoveredMesh !== _selectedMesh) {
      _hoveredMesh.material.opacity = 0.18;
    }
    // Hover new
    if (hit && hit !== _selectedMesh) {
      hit.material.opacity = 0.38;
    }
    _hoveredMesh = hit;
    renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
  }
}

function _onTouch(event) {
  if (!event.touches.length) return;
  const t = event.touches[0];
  _setMouseFromXY(t.clientX, t.clientY);
  _raycaster.setFromCamera(_mouse, camera);

  const hits = _raycaster.intersectObjects(_roomMeshes, false);
  if (hits.length > 0) _selectRoom(hits[0].object);
}

// ─── Room selection ──────────────────────────────────────────────────────────

function _selectRoom(mesh) {
  // Deselect previous
  if (_selectedMesh && _selectedMesh !== mesh) {
    highlightRoom(_selectedMesh, false);
  }

  _selectedMesh = mesh;
  highlightRoom(mesh, true);

  // Animate camera toward the room
  const worldPos = new THREE.Vector3();
  mesh.getWorldPosition(worldPos);

  const camOffset = new THREE.Vector3(
    worldPos.x + 6,
    worldPos.y + 8,
    worldPos.z + 18
  );
  moveTo(camOffset, worldPos, 1200);

  // Show info panel
  const roomData = getRoomByObjectName(mesh.name);
  if (roomData) showRoomPanel(roomData);
}

function _deselect() {
  if (_selectedMesh) {
    highlightRoom(_selectedMesh, false);
    _selectedMesh = null;
  }
  hideRoomPanel();
}

// ─── Search ──────────────────────────────────────────────────────────────────

function _handleSearch(query) {
  if (!query || !query.trim()) return;

  const code     = query.trim().toUpperCase();
  const roomData = getRoomByCode(code);

  if (!roomData) {
    showToast(`Room "${query}" not found.`, 'error');
    return;
  }

  // Find the matching mesh
  const mesh = _roomMeshes.find(m => m.name === roomData.objectName);
  if (mesh) {
    _selectRoom(mesh);
    showToast(`Found: ${roomData.room} — ${roomData.floor}`, 'success');
  }

  // Clear input
  const input = document.getElementById('search-input');
  if (input) input.value = '';
}

// ─── Floor isolation ─────────────────────────────────────────────────────────

/**
 * setActiveFloor(floorIndex)
 * Highlights rooms on the selected floor; dims others.
 * Pass -1 to show all floors equally.
 * @param {number} floorIndex  0-3 or -1 for all
 */
export function setActiveFloor(floorIndex) {
  _activeFloor = floorIndex;

  if (!_buildingGroup) return;

  _buildingGroup.traverse(obj => {
    if (obj.userData.isRoom) {
      const fi = _getRoomFloorIndex(obj.name);

      if (floorIndex === -1) {
        // All visible
        obj.material.opacity = 0.18;
        obj.visible          = true;
      } else if (fi === floorIndex) {
        // This floor — bright
        obj.material.opacity = 0.45;
        obj.visible          = true;
      } else {
        // Other floors — hidden
        obj.material.opacity = 0.04;
        obj.visible          = true;
      }
    }
  });

  // Move camera to face the selected floor
  if (floorIndex >= 0) {
    const floorY = floorIndex === 0
      ? 2
      : 2 + floorIndex * 3.8;

    moveTo(
      new THREE.Vector3(0, floorY + 8, 42),
      new THREE.Vector3(0, floorY, 0),
      1000
    );
    showToast(`${FLOOR_NAMES[floorIndex]} selected`, 'info');
  } else {
    moveHome();
  }
}

// ─── Reset view ──────────────────────────────────────────────────────────────

export function resetView() {
  _deselect();
  resetAllRooms(_buildingGroup);
  setActiveFloor(-1);
  moveHome();

  // Reset floor button states
  document.querySelectorAll('[data-floor]').forEach(b => b.classList.remove('active'));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _setMouseFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  _setMouseFromXY(event.clientX, event.clientY, rect);
}

function _setMouseFromXY(cx, cy, rect) {
  if (!rect) rect = renderer.domElement.getBoundingClientRect();
  _mouse.x =  ((cx - rect.left) / rect.width)  * 2 - 1;
  _mouse.y = -((cy - rect.top)  / rect.height) * 2 + 1;
}

/**
 * Extract floor index from a room mesh name via ROOM_DATA lookup.
 */
function _getRoomFloorIndex(objectName) {
  const r = getRoomByObjectName(objectName);
  return r ? r.floorIndex : -1;
}
