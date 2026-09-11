/**
 * ccs-building-interactions.js — Three.js r128
 * Hover over 2nd/3rd floor rooms → floating tooltip at cursor position.
 * Works at any camera angle.
 */
/* globals THREE, ccsCamera, ccsRenderer, ccsControls,
   ccsCameraMoveTo, ccsCameraHome, ccsHighlightRoom, ccsResetAllRooms */

var _group    = null;
var _rooms    = [];
var _hovered  = null;
var _ray      = new THREE.Raycaster();
var _mouse    = new THREE.Vector2();
var _lastX    = 0;
var _lastY    = 0;

function ccsInteractionsInit(group) {
  _group = group;
  group.traverse(function (o) {
    if (o.userData.isRoom) _rooms.push(o);
  });

  // Canvas events
  ccsRenderer.domElement.addEventListener('mousemove',  _onMove);
  ccsRenderer.domElement.addEventListener('mouseleave', _onLeave);
  ccsRenderer.domElement.addEventListener('touchstart', _onTouch, { passive: true });

  // Floor buttons
  document.querySelectorAll('[data-ccs-floor]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var val = btn.getAttribute('data-ccs-floor');
      var fi  = val === 'all' ? -1 : parseInt(val, 10);
      _setFloor(fi);
      document.querySelectorAll('[data-ccs-floor]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-ccs-floor') === val);
      });
    });
  });

  // Reset
  var rb = document.getElementById('ccs-btn-reset-overlay');
  if (rb) rb.addEventListener('click', function () { _hidePanel(); ccsCameraHome(); });

  // Search
  var inp = document.getElementById('ccs-search-input');
  if (inp) inp.addEventListener('keydown', function (e) { if (e.key==='Enter') _search(inp.value); });

  // View buttons
  var views = {
    'ccs-btn-top'  : [new THREE.Vector3(0,85,2),   new THREE.Vector3(0,0,0)],
    'ccs-btn-front': [new THREE.Vector3(0,10,62),  new THREE.Vector3(0,6,0)],
    'ccs-btn-left' : [new THREE.Vector3(-70,12,0), new THREE.Vector3(0,7,0)],
    'ccs-btn-right': [new THREE.Vector3( 70,12,0), new THREE.Vector3(0,7,0)],
  };
  Object.keys(views).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () {
      ccsCameraMoveTo(views[id][0], views[id][1], 1100);
    });
  });
}

// ── Mouse move — hover detection ──────────────────────────────────────────────
function _onMove(e) {
  var rect = ccsRenderer.domElement.getBoundingClientRect();
  _lastX = e.clientX;
  _lastY = e.clientY;
  _mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  _mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

  _ray.setFromCamera(_mouse, ccsCamera);
  var hits = _ray.intersectObjects(_rooms, false);
  var hit  = hits.length ? hits[0].object : null;

  if (hit !== _hovered) {
    // Un-hover previous
    if (_hovered) {
      _hovered.material.opacity = 0.0;
      _hovered = null;
    }
    // Hover new
    if (hit) {
      _hovered = hit;
      hit.material.color.setHex(0x1abc9c);
      hit.material.opacity = 0.35;
      _showPanel(hit.userData.roomData, e.clientX, e.clientY);
    } else {
      _hidePanel();
    }
  } else if (hit && _hovered) {
    // Update panel position as mouse moves
    _movePanel(e.clientX, e.clientY);
  }

  ccsRenderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
}

function _onLeave() {
  if (_hovered) { _hovered.material.opacity = 0.0; _hovered = null; }
  _hidePanel();
  ccsRenderer.domElement.style.cursor = 'grab';
}

// ── Touch ─────────────────────────────────────────────────────────────────────
function _onTouch(e) {
  if (!e.touches.length) return;
  var t    = e.touches[0];
  var rect = ccsRenderer.domElement.getBoundingClientRect();
  _mouse.x =  ((t.clientX - rect.left) / rect.width)  * 2 - 1;
  _mouse.y = -((t.clientY - rect.top)  / rect.height) * 2 + 1;
  _ray.setFromCamera(_mouse, ccsCamera);
  var hits = _ray.intersectObjects(_rooms, false);
  if (hits.length) {
    _hovered = hits[0].object;
    _hovered.material.color.setHex(0x1abc9c);
    _hovered.material.opacity = 0.35;
    _showPanel(_hovered.userData.roomData, t.clientX, t.clientY);
  }
}

// ── Floating panel ────────────────────────────────────────────────────────────
function _showPanel(rd, clientX, clientY) {
  var panel = document.getElementById('ccs-room-panel');
  if (!panel) return;
  document.getElementById('rp-name').textContent  = rd.name;
  document.getElementById('rp-floor').textContent = rd.floor;
  document.getElementById('rp-id').textContent    = 'CCS — ' + rd.floor;
  _movePanel(clientX, clientY);
  panel.classList.remove('rp-hidden');
  panel.classList.add('rp-visible');
}

function _movePanel(clientX, clientY) {
  var panel = document.getElementById('ccs-room-panel');
  if (!panel) return;
  var wrap  = document.getElementById('ccs-canvas-wrap');
  if (!wrap) return;
  var wr    = wrap.getBoundingClientRect();
  // Position panel relative to canvas-wrap
  var ox    = clientX - wr.left;
  var oy    = clientY - wr.top;
  // Keep panel inside canvas bounds
  var pw    = panel.offsetWidth  || 220;
  var ph    = panel.offsetHeight || 120;
  var px    = Math.min(ox + 14, wr.width  - pw - 10);
  var py    = Math.max(oy - ph - 10, 10);
  panel.style.left = px + 'px';
  panel.style.top  = py + 'px';
  panel.style.right = 'auto';
}

function _hidePanel() {
  var panel = document.getElementById('ccs-room-panel');
  if (!panel) return;
  panel.classList.remove('rp-visible');
  panel.classList.add('rp-hidden');
}

// ── Floor camera ──────────────────────────────────────────────────────────────
function _setFloor(fi) {
  var GH=4.60, FH=3.52;
  if (fi < 0) {
    ccsCameraHome();
  } else {
    var fy = fi===0 ? GH*0.5 : GH + FH*(fi-1) + FH*0.5;
    ccsCameraMoveTo(new THREE.Vector3(0, fy+14, 55), new THREE.Vector3(0, fy, 0), 1000);
  }
}

// ── Search ────────────────────────────────────────────────────────────────────
function _search(query) {
  if (!query || !query.trim()) return;
  var q = query.trim().toLowerCase();
  for (var i=0; i<_rooms.length; i++) {
    var rd = _rooms[i].userData.roomData;
    if (rd.name.toLowerCase().indexOf(q) !== -1 || rd.id.toLowerCase().indexOf(q) !== -1) {
      // Fly to that room's floor
      _setFloor(rd.floorIndex);
      _rooms[i].material.color.setHex(0x1abc9c);
      _rooms[i].material.opacity = 0.35;
      _hovered = _rooms[i];
      _showPanel(rd, window.innerWidth/2, window.innerHeight/2);
      var inp = document.getElementById('ccs-search-input');
      if (inp) inp.value = '';
      break;
    }
  }
}
