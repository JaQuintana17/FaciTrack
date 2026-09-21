/**
 * ccs-building-loader.js
 * -----------------------
 * Procedurally constructs the CSPC CCS Building (Academic Building IV)
 * using Three.js geometry — no external GLB file required.
 *
 * Real building facts (from photos):
 *  • Light sky-blue concrete facade  (#6fb3d2 / #87CEEB range)
 *  • 4 storeys above open ground-floor colonnade
 *  • Prominent vertical columns and horizontal slab edges
 *  • Planter balconies with hanging greenery on each floor
 *  • Grid of louvred/glazed windows
 *  • Central projecting entrance bay + signage
 *  • External stair towers on left and right ends
 *  • Solar panels on roof (flat)
 *  • ~55 m wide × ~14 m deep × ~17 m tall
 *
 * Room meshes are named "Room_<CODE>" so raycasting can identify them.
 */

import * as THREE from 'three';
import { scene }  from './ccs-building-scene.js';
import { ROOM_DATA } from './ccs-building-room-data.js';

// ─── Colour palette ─────────────────────────────────────────────────────────
const C = {
  wall        : 0x72bcd4,   // light sky-blue  (main facade)
  wallDark    : 0x5a9cb8,   // slightly deeper blue  (columns, projections)
  slab        : 0x8ecae6,   // floor slab edge
  column      : 0x5a9cb8,   // vertical columns
  window      : 0x9ec8e8,   // glazing (light blue-grey)
  windowFrame : 0x4a7a94,   // window frame
  balcony     : 0x6aafcc,   // balcony railing concrete
  plant       : 0x2e7d32,   // planter greenery (dark green)
  plantLight  : 0x4caf50,   // planter highlight
  roof        : 0xb0bec5,   // flat roof concrete (light grey)
  solar       : 0x263238,   // solar panel dark
  solarFrame  : 0x546e7a,   // solar panel frame
  signage     : 0xffffff,   // sign text background
  stair       : 0x5a9cb8,   // exterior stair structure
  door        : 0x1a237e,   // main entrance doors (dark navy glass)
  ground      : 0x8fae6b,   // kept for reference
  roomDefault : 0x72bcd4,   // default room colour
  roomHL      : 0x1abc9c,   // highlight (teal) when selected
};

// ─── Shared materials ───────────────────────────────────────────────────────
function mat(color, roughness = 0.75, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

const M = {
  wall        : mat(C.wall,        0.80),
  wallDark    : mat(C.wallDark,    0.80),
  column      : mat(C.column,      0.75),
  slab        : mat(C.slab,        0.70),
  window      : mat(C.window,      0.10, 0.05),
  windowFrame : mat(C.windowFrame, 0.65),
  balcony     : mat(C.balcony,     0.80),
  plant       : mat(C.plant,       0.90),
  plantLight  : mat(C.plantLight,  0.90),
  roof        : mat(C.roof,        0.85),
  solar       : mat(C.solar,       0.10, 0.6),
  solarFrame  : mat(C.solarFrame,  0.40, 0.4),
  signage     : mat(C.signage,     0.60),
  stair       : mat(C.stair,       0.78),
  door        : mat(C.door,        0.05, 0.1),
};

// ─── Building dimensions ─────────────────────────────────────────────────────
const BW  = 54;   // total width  (x)
const BD  = 12;   // total depth  (z)
const FH  = 3.8;  // floor height
const GH  = 4.2;  // ground-floor colonnade height (taller)
const FLOORS = 4; // 4 storeys
const TH  = GH + FH * (FLOORS - 1); // total height ≈ 15.6 m

// Column grid: 10 bays across, so 11 columns
const N_COLS  = 11;
const COL_W   = 0.9;
const COL_H   = TH;

// ─── Main entry point ────────────────────────────────────────────────────────
export function buildBuilding() {
  const buildingGroup = new THREE.Group();
  buildingGroup.name  = 'CCSBuilding';

  _addMainStructure(buildingGroup);
  _addColumns(buildingGroup);
  _addSlabEdges(buildingGroup);
  _addWindows(buildingGroup);
  _addPlanterBalconies(buildingGroup);
  _addCentralEntrance(buildingGroup);
  _addExternalStairs(buildingGroup);
  _addRoof(buildingGroup);
  _addRoomMeshes(buildingGroup);

  // Centre the building at origin (ground level = y:0)
  buildingGroup.position.set(0, 0, 0);
  scene.add(buildingGroup);

  return buildingGroup;
}

// ─── Structure helpers ───────────────────────────────────────────────────────

/** Main wall box — full building footprint */
function _addMainStructure(g) {
  // Rear wall (full height solid)
  const rearWall = _box(BW, TH, 0.6, M.wall, 'WallRear');
  rearWall.position.set(0, TH / 2, -BD / 2 + 0.3);
  rearWall.castShadow = rearWall.receiveShadow = true;
  g.add(rearWall);

  // Side walls
  [-1, 1].forEach(side => {
    const sw = _box(0.7, TH, BD, M.wallDark, `WallSide${side > 0 ? 'R' : 'L'}`);
    sw.position.set(side * (BW / 2 - 0.35), TH / 2, 0);
    sw.castShadow = sw.receiveShadow = true;
    g.add(sw);
  });

  // Floor infill panels between columns (facade, per floor)
  for (let f = 1; f < FLOORS; f++) {
    const y = GH + FH * (f - 1) + FH / 2;
    // lower panel (below window sill)
    const panel = _box(BW - 2, 0.9, 0.3, M.wall, `FloorPanel_${f}`);
    panel.position.set(0, GH + FH * (f - 1) + 0.45, BD / 2 - 0.15);
    panel.castShadow = true;
    g.add(panel);
    void y; // suppress lint
  }
}

/** Vertical columns across facade and rear */
function _addColumns(g) {
  const spacing = BW / (N_COLS - 1);
  for (let i = 0; i < N_COLS; i++) {
    const x = -BW / 2 + i * spacing;

    // Front facade columns (full height)
    const col = _box(COL_W, COL_H, COL_W, M.column, `Col_Front_${i}`);
    col.position.set(x, COL_H / 2, BD / 2);
    col.castShadow = col.receiveShadow = true;
    g.add(col);

    // Rear columns (shorter — just structural)
    const colR = _box(COL_W, COL_H, COL_W, M.column, `Col_Rear_${i}`);
    colR.position.set(x, COL_H / 2, -BD / 2);
    colR.castShadow = colR.receiveShadow = true;
    g.add(colR);
  }
}

/** Horizontal slab edges between floors */
function _addSlabEdges(g) {
  // Ground floor beam / base
  const base = _box(BW, 0.5, BD + 0.4, M.slab, 'SlabBase');
  base.position.set(0, 0.25, 0);
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  for (let f = 1; f <= FLOORS; f++) {
    const y = (f === 1 ? GH : GH + FH * (f - 1));

    // Main slab soffit strip (front face)
    const slab = _box(BW + 0.4, 0.55, 1.2, M.slab, `Slab_${f}`);
    slab.position.set(0, y, BD / 2 + 0.5);
    slab.castShadow = slab.receiveShadow = true;
    g.add(slab);

    // Full floor slab
    const floor = _box(BW, 0.35, BD, M.slab, `Floor_${f}`);
    floor.position.set(0, y - 0.18, 0);
    floor.receiveShadow = true;
    g.add(floor);
  }
}

/** Windows — 3 per bay, on floors 1-4 */
function _addWindows(g) {
  const spacing = BW / (N_COLS - 1);
  const bays    = N_COLS - 1; // 10 bays

  for (let b = 0; b < bays; b++) {
    const bx = -BW / 2 + (b + 0.5) * spacing;

    for (let f = 0; f < FLOORS; f++) {
      const baseY = f === 0 ? GH : GH + FH * f;
      // 3 windows per bay per floor
      const wins = f === 0 ? 2 : 3;
      for (let w = 0; w < wins; w++) {
        const wx  = bx + (w - (wins - 1) / 2) * (spacing / wins);
        const wy  = baseY + FH * 0.55;
        const wh  = FH * 0.52;
        const ww  = spacing / wins - 0.18;

        // Frame
        const frame = _box(ww + 0.12, wh + 0.12, 0.15, M.windowFrame, `WinFrame_${b}_${f}_${w}`);
        frame.position.set(wx, wy, BD / 2 + 0.06);
        g.add(frame);

        // Glazing
        const win = _box(ww, wh, 0.08, M.window, `Win_${b}_${f}_${w}`);
        win.position.set(wx, wy, BD / 2 + 0.1);
        g.add(win);
      }
    }
  }
}

/** Planter balcony strips with hanging greenery */
function _addPlanterBalconies(g) {
  for (let f = 1; f < FLOORS; f++) {
    const y = GH + FH * (f - 1);

    // Concrete planter ledge
    const ledge = _box(BW - 1, 0.4, 1.0, M.balcony, `Planter_${f}`);
    ledge.position.set(0, y + 0.2, BD / 2 + 0.9);
    ledge.castShadow = ledge.receiveShadow = true;
    g.add(ledge);

    // Greenery on planter (row of small box shrubs)
    for (let p = 0; p < 18; p++) {
      const px = -BW / 2 + 1.5 + p * (BW - 3) / 17;
      const plant = _box(1.6, 0.35 + Math.random() * 0.2, 0.55, M.plant, `Plant_${f}_${p}`);
      plant.position.set(px, y + 0.58, BD / 2 + 0.95);
      g.add(plant);
    }
  }
}

/** Central entrance bay with signage */
function _addCentralEntrance(g) {
  // Central projecting canopy (slightly wider, deeper bay in photos)
  const canopy = _box(12, 0.5, 3.5, M.slab, 'EntranceCanopy');
  canopy.position.set(0, GH, BD / 2 + 1.6);
  canopy.castShadow = canopy.receiveShadow = true;
  g.add(canopy);

  // Canopy support columns (2)
  [-4, 4].forEach((x, i) => {
    const col = _box(0.9, GH, 0.9, M.column, `EntranceCol_${i}`);
    col.position.set(x, GH / 2, BD / 2 + 2.5);
    col.castShadow = col.receiveShadow = true;
    g.add(col);
  });

  // Glass entrance doors (3 sets)
  [-2.5, 0, 2.5].forEach((x, i) => {
    const door = _box(1.6, GH * 0.75, 0.1, M.door, `Door_${i}`);
    door.position.set(x, GH * 0.375, BD / 2 + 0.12);
    g.add(door);
  });

  // Signage strip — "ACADEMIC BUILDING IV"
  const sign = _box(14, 0.7, 0.18, M.signage, 'Signage');
  sign.position.set(0, GH * 0.25, BD / 2 + 0.22);
  g.add(sign);

  // Dark sign text panel
  const signText = _box(10, 0.32, 0.05, mat(0x1a237e, 0.4), 'SignageText');
  signText.position.set(0, GH * 0.25, BD / 2 + 0.32);
  g.add(signText);
}

/** External stair towers on both ends (visible in side-elevation photos) */
function _addExternalStairs(g) {
  [-1, 1].forEach((side, si) => {
    const sx = side * (BW / 2 + 2.0);

    // Stair tower enclosure
    const tower = _box(4, TH * 0.85, BD * 0.6, M.stair, `StairTower_${si}`);
    tower.position.set(sx, TH * 0.425, 0);
    tower.castShadow = tower.receiveShadow = true;
    g.add(tower);

    // Stair flights (zig-zag slabs up the face)
    for (let f = 0; f < FLOORS - 1; f++) {
      const sy  = GH + FH * f + FH / 2;
      const fl  = _box(3.2, 0.2, 2.8, M.slab, `StairFlight_${si}_${f}`);
      fl.position.set(sx, sy, side * -1);
      fl.rotation.z = side * 0.32; // diagonal slant
      fl.castShadow = true;
      g.add(fl);
    }

    // Handrail posts
    for (let p = 0; p < 6; p++) {
      const py = GH + p * (TH - GH) / 5;
      const post = _box(0.1, 0.9, 0.1, M.column, `Handrail_${si}_${p}`);
      post.position.set(sx + side * 1.5, py + 0.45, 0);
      g.add(post);
    }
  });
}

/** Flat roof with solar panel array */
function _addRoof(g) {
  // Main roof slab
  const roofSlab = _box(BW + 1, 0.6, BD + 1, M.roof, 'RoofSlab');
  roofSlab.position.set(0, TH + 0.3, 0);
  roofSlab.castShadow = roofSlab.receiveShadow = true;
  g.add(roofSlab);

  // Parapet walls
  [
    { pos: [0, TH + 0.85, BD / 2 + 0.2],    size: [BW + 1, 1.1, 0.3] },
    { pos: [0, TH + 0.85, -(BD / 2 + 0.2)], size: [BW + 1, 1.1, 0.3] },
    { pos: [BW / 2 + 0.55, TH + 0.85, 0],   size: [0.3, 1.1, BD + 1.4] },
    { pos: [-(BW / 2 + 0.55), TH + 0.85, 0], size: [0.3, 1.1, BD + 1.4] },
  ].forEach(({ pos, size }, i) => {
    const p = _box(...size, M.wallDark, `Parapet_${i}`);
    p.position.set(...pos);
    g.add(p);
  });

  // Solar panel grid (back half of roof)
  const panelW = 1.6, panelD = 0.8;
  const cols   = 14, rows = 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = -BW / 2 + 3 + c * (panelW + 0.25);
      const pz = -BD / 2 + 1 + r * (panelD + 0.35);

      // Panel surface
      const panel = _box(panelW, 0.06, panelD, M.solar, `Solar_${r}_${c}`);
      panel.position.set(px, TH + 0.65, pz);
      panel.rotation.x = -0.22; // slight southward tilt
      g.add(panel);

      // Frame
      const frame = _box(panelW + 0.08, 0.04, panelD + 0.06, M.solarFrame, `SolarFrame_${r}_${c}`);
      frame.position.set(px, TH + 0.64, pz);
      frame.rotation.x = -0.22;
      g.add(frame);
    }
  }

  // Water tank / utility box on roof
  const tank = _box(2.5, 2.0, 2.5, M.roof, 'RoofTank');
  tank.position.set(BW / 2 - 5, TH + 1.6, 0);
  g.add(tank);
}

/**
 * _addRoomMeshes()
 * Creates invisible (transparent) clickable room volumes inside the building.
 * Each mesh is named "Room_<CODE>" to match ROOM_DATA objectName.
 * They are slightly visible (low opacity) so they can be highlighted on click.
 */
function _addRoomMeshes(g) {
  // Room layout per floor — approximate bounding boxes
  // floorIndex 0 = ground, 1 = second, etc.
  // Each room is a box mesh placed at approximate bay position
  const spacing  = BW / (N_COLS - 1); // ~5.4 m per bay
  const roomH    = FH - 0.55;

  ROOM_DATA.forEach(roomData => {
    const fi = roomData.floorIndex;
    // Derive x position from room code hash (spread rooms across bays)
    const bayIndex = _roomToBayIndex(roomData.room, N_COLS - 1);
    const x        = -BW / 2 + (bayIndex + 0.5) * spacing;
    const y        = fi === 0 ? GH / 2 : GH + FH * (fi - 1) + roomH / 2 + 0.4;

    // Room volume mesh (clickable, semi-transparent)
    const geo  = new THREE.BoxGeometry(spacing - 0.3, roomH, BD - 0.4);
    const mMat = new THREE.MeshStandardMaterial({
      color       : C.roomDefault,
      transparent : true,
      opacity     : 0.18,
      roughness   : 0.8,
      depthWrite  : false,
    });
    const mesh  = new THREE.Mesh(geo, mMat);
    mesh.name   = roomData.objectName;      // e.g. "Room_CCS201"
    mesh.position.set(x, y, -BD / 4);
    mesh.castShadow    = false;
    mesh.receiveShadow = false;

    // Store original colour for reset
    mesh.userData.baseColor     = C.roomDefault;
    mesh.userData.highlightColor = C.roomHL;
    mesh.userData.roomCode       = roomData.room;
    mesh.userData.isRoom         = true;

    g.add(mesh);
  });
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

/** Create a BoxGeometry mesh with the given dimensions and material */
function _box(w, h, d, material, name = '') {
  const geo  = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name  = name;
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Map a room code to a bay index (0 … N-1) deterministically.
 * Uses a simple hash so rooms spread across the building width.
 */
function _roomToBayIndex(code, maxBays) {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) & 0xffff;
  }
  return hash % maxBays;
}

/**
 * highlightRoom(mesh, highlighted)
 * Switches a room mesh between default and teal highlight.
 * @param {THREE.Mesh} mesh
 * @param {boolean}    highlighted
 */
export function highlightRoom(mesh, highlighted) {
  if (!mesh || !mesh.material) return;
  mesh.material.color.setHex(highlighted ? C.roomHL : C.roomDefault);
  mesh.material.opacity = highlighted ? 0.55 : 0.18;
}

/**
 * resetAllRooms(buildingGroup)
 * Removes highlight from every room mesh.
 * @param {THREE.Group} buildingGroup
 */
export function resetAllRooms(buildingGroup) {
  buildingGroup.traverse(obj => {
    if (obj.userData.isRoom) highlightRoom(obj, false);
  });
}
