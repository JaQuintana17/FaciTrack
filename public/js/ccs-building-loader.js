/**
 * ccs-building-loader.js — Three.js r128
 * Loads GLB. Interactive rooms on 2nd and 3rd floor only.
 */
/* globals THREE, ccsScene */

// ── Room definitions — 2nd + 3rd floor, left to right ─────────────────────────
var CCS_ROOMS = [
  // 2nd floor (floorIndex:1) — 5 rooms left → right
  { id:'2F-1', name:'Faculty Lounge',    floor:'2nd Floor', floorIndex:1, bay:0 },
  { id:'2F-2', name:"Dean's Office",     floor:'2nd Floor', floorIndex:1, bay:2 },
  { id:'2F-3', name:'Consultation Room', floor:'2nd Floor', floorIndex:1, bay:4 },
  { id:'2F-4', name:'Mac Lab',           floor:'2nd Floor', floorIndex:1, bay:6 },
  { id:'2F-5', name:'Open Lab',          floor:'2nd Floor', floorIndex:1, bay:8 },
  // 3rd floor (floorIndex:2) — 4 rooms left → right
  { id:'3F-1', name:'IT Lab 1',          floor:'3rd Floor', floorIndex:2, bay:1 },
  { id:'3F-2', name:'IT Lab 2',          floor:'3rd Floor', floorIndex:2, bay:3 },
  { id:'3F-3', name:'ERP Lab',           floor:'3rd Floor', floorIndex:2, bay:6 },
  { id:'3F-4', name:'CS Lab',            floor:'3rd Floor', floorIndex:2, bay:9 },
];

// ── Highlight helpers ──────────────────────────────────────────────────────────
function ccsHighlightRoom(mesh, on) {
  if (!mesh || !mesh.material) return;
  mesh.material.color.setHex(0x1abc9c);
  mesh.material.opacity = on ? 0.45 : 0.0;
}

function ccsResetAllRooms(group) {
  if (!group) return;
  group.traverse(function (o) {
    if (o.userData.isRoom) ccsHighlightRoom(o, false);
  });
}

// ── Add invisible room hit-boxes ───────────────────────────────────────────────
function _addRoomVolumes(group) {
  var BW  = 56, BD = 13, GH = 4.6, FH = 3.52;
  var NC  = 12, CW = 0.88;
  var BAY = (BW - CW) / (NC - 1); // ≈ 5.01
  var ZR  = -BD / 2;
  var rH  = FH - 0.6;
  var roomW = BAY * 1.85 - 0.2;
  var roomD = 2.2;
  var roomZ = ZR + roomD / 2 + 0.3;

  CCS_ROOMS.forEach(function (rd) {
    var floorY = GH + FH * (rd.floorIndex - 1);
    var cx     = -BW / 2 + CW / 2 + (rd.bay + 1.0) * BAY;
    var cy     = floorY + rH / 2 + 0.3;

    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(roomW, rH, roomD),
      new THREE.MeshStandardMaterial({
        color: 0x1abc9c, transparent: true, opacity: 0.0, depthWrite: false
      })
    );
    mesh.name              = 'Room_' + rd.id;
    mesh.position.set(cx, cy, roomZ);
    mesh.userData.isRoom   = true;
    mesh.userData.roomData = rd;
    mesh.castShadow        = false;
    mesh.receiveShadow     = false;
    group.add(mesh);
  });
}

// ── Main entry ────────────────────────────────────────────────────────────────
function ccsBuildingCreate() {
  return new Promise(function (resolve) {

    // Show fallback immediately so building is always visible
    var fallbackGroup = _fallback();
    resolve(fallbackGroup);

    // Also try loading the GLB in background — replace fallback if it loads
    var loader = new THREE.GLTFLoader();
    loader.load(
      '/models/ccs-building.glb?v=' + Date.now(),

      function (gltf) {
        // GLB loaded — remove fallback and add real model
        if (ccsScene) {
          var old = ccsScene.getObjectByName('CCSBuilding');
          if (old) ccsScene.remove(old);
        }
        var group = gltf.scene;
        group.name = 'CCSBuilding';
        group.position.set(0, 0, 0);

        var bbox = new THREE.Box3().setFromObject(group);
        var size = new THREE.Vector3();
        bbox.getSize(size);
        var maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim < 10) {
          group.scale.setScalar(56 / maxDim);
          bbox.setFromObject(group);
        }
        group.position.y = -bbox.min.y;

        group.traverse(function (child) {
          if (!child.isMesh) return;
          child.castShadow    = true;
          child.receiveShadow = true;
          var mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(function (m) {
            if (m.map) { m.map.encoding = THREE.sRGBEncoding; m.map.needsUpdate = true; }
            m.needsUpdate = true;
          });
        });

        if (ccsScene) {
          ccsScene.add(group);
          _addRoomVolumes(group);
          console.log('[CCS] GLB swapped in');
        }
      },

      function (xhr) {
        if (xhr.total > 0) {
          var pct = Math.round(xhr.loaded / xhr.total * 100);
          var el  = document.querySelector('.ccs-loading-text');
          if (el && el.style.display !== 'none') el.textContent = 'Enhancing… ' + pct + '%';
        }
      },

      function (err) {
        console.warn('[CCS] GLB failed (using fallback already shown):', err);
      }
    );
  });
}

// ── Procedural fallback ───────────────────────────────────────────────────────
function _fallback() {
  var g = new THREE.Group();
  g.name = 'CCSBuilding';

  function b(w, h, d, hex, x, y, z) {
    var m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: hex })
    );
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }

  var BW=56, BD=13, GH=4.6, FH=3.52, TH=GH+FH*3;
  var NC=12, CW=0.88, BAY=(BW-CW)/11;
  var ZF=BD/2, ZR=-BD/2;

  // Ground
  b(260,0.10,200, 0xa8a460, 0,-0.05,20);
  b(78, 0.18,14,  0xa8a8a0, 0, 0,   10);
  b(160,0.12,28,  0x888880, 0, 0,   30);

  // Structure
  b(BW,TH,0.5, 0x6fb8d4, 0,TH/2,ZR+0.26);              // rear wall
  b(0.66,TH,BD, 0x5496b2, -BW/2+0.33,TH/2,0);           // side L
  b(0.66,TH,BD, 0x5496b2,  BW/2-0.33,TH/2,0);           // side R

  // Columns
  for (var i=0;i<NC;i++) {
    b(CW,TH,1.25, 0x5496b2, -BW/2+CW/2+i*BAY,TH/2,ZF-0.38);
  }

  // Slab bands
  for (var f=1;f<=3;f++) {
    var sy=f===1?GH:GH+FH*(f-1);
    b(BW+0.2,0.32,BD,   0x92cfe0, 0,sy+0.16,0);
    b(BW+0.3,0.32,0.32, 0x92cfe0, 0,sy+0.16,ZF+0.03);
    b(BW+0.3,0.22,0.38, 0x182838, 0,sy-0.09,ZF+0.03);
  }

  // Windows + planters + GREEN GRASS on each floor slab edge (like in photos)
  for (var fl=1;fl<4;fl++) {
    var fY=GH+FH*(fl-1);
    for (var bw=0;bw<NC-1;bw++) {
      var bx=-BW/2+CW/2+(bw+0.5)*BAY;
      b(BAY-CW-0.30,1.55+0.24,0.16, 0xf0ece2, bx,fY+1.2,ZR+0.66);
      b(BAY-CW-0.60,1.55,     0.08, 0xb8d4e8, bx,fY+1.2,ZR+0.76);
    }
    // Planter concrete box at slab front edge
    b(BW-1,0.44,1.10, 0x5496b2, 0,fY+0.55,ZF+0.15);
    // Green grass on planter — varied heights for realism
    var nGrass = 20;
    for (var gp=0; gp<nGrass; gp++) {
      var gpx = -BW/2 + 1.5 + gp*(BW-3)/(nGrass-1);
      var gph = 0.22 + (gp%5)*0.06;
      var gpc = gp%3===0 ? 0x2d8a32 : gp%2===0 ? 0x3aaa3e : 0x1e6b22;
      b((BW-3)/(nGrass-1)*0.85, gph, 0.52, gpc, gpx, fY+0.55+gph/2, ZF+0.18);
    }
  }

  // Sign
  b(26,0.78,0.20, 0xf0f0ee, 0,GH*0.58,ZR+0.52);
  b(18,0.32,0.10, 0x1a2535, 0,GH*0.58,ZR+0.70);

  // Roof
  b(BW+0.9,0.55,BD+0.8, 0xa0b0b8, 0,TH+0.28,0);
  b(BW+1.5,1.1,0.30, 0x5496b2, 0,TH+0.86,ZF+0.24);
  b(BW+1.5,1.1,0.30, 0x5496b2, 0,TH+0.86,ZR-0.24);

  // Right stair
  b(3.2,TH,0.50, 0x5496b2, BW/2+2.6,TH/2,ZR+0.55);
  b(0.50,TH*0.88,BD*0.45, 0x5496b2, BW/2+4.0,TH*0.44,ZR*0.5);

  // Left utility
  b(3.2,GH*0.86,5.5, 0xb0b4b0, -BW/2-1.8,GH*0.43,ZR+3.2);

  // Lamp posts
  [-22,-8,8,22].forEach(function(lx) {
    b(0.16,7.2,0.16, 0x425060, lx,3.6,24);
    b(0.50,0.32,0.50, 0xfff8c8, lx,7.3,24);
    b(1.80,0.09,0.09, 0x425060, lx,7.2,24);
  });

  // Vehicles
  b(3.9,0.88,1.78, 0x141414, -8,  0.52,29);
  b(2.1,0.72,1.62, 0x141414, -8.2,1.24,29);
  b(4.4,0.95,1.90, 0xe2e4e6, -32, 0.60,29);
  b(3.2,0.82,1.78, 0xe2e4e6, -32, 1.38,29);
  [[-22,16],[-19,16],[36,14],[39,14]].forEach(function(mv) {
    b(1.65,0.55,0.35, 0x141414, mv[0],0.62,mv[1]);
    b(0.22,0.58,0.22, 0x111111, mv[0]-0.65,0.30,mv[1]);
    b(0.22,0.58,0.22, 0x111111, mv[0]+0.65,0.30,mv[1]);
  });

  ccsScene.add(g);
  _addRoomVolumes(g);
  return g;
}
