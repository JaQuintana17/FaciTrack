/**
 * ccs-building-ui.js
 * -------------------
 * Manages all DOM-side UI interactions:
 *   - Room info panel (show / hide / update)
 *   - Toast notifications
 *   - Loading overlay
 *   - Sidebar toggle on mobile
 *   - Status badge colour rendering
 */

import { STATUS_COLORS } from './ccs-building-room-data.js';

// ─── Panel ───────────────────────────────────────────────────────────────────

/**
 * showRoomPanel(roomData)
 * Populate and reveal the floating room-info card.
 * @param {object} roomData  A ROOM_DATA entry
 */
export function showRoomPanel(roomData) {
  const panel = document.getElementById('room-panel');
  if (!panel) return;

  // Populate fields
  _setText('panel-room',        roomData.room);
  _setText('panel-faculty',     roomData.faculty);
  _setText('panel-floor',       roomData.floor);
  _setText('panel-description', roomData.description || '');

  // Status badge
  const badge = document.getElementById('panel-status');
  if (badge) {
    badge.textContent            = roomData.status;
    badge.style.backgroundColor = STATUS_COLORS[roomData.status] || '#7F8C8D';
  }

  // Animate in
  panel.classList.remove('panel-hidden');
  panel.classList.add('panel-visible');

  // Close button
  const closeBtn = document.getElementById('panel-close');
  if (closeBtn) {
    closeBtn.onclick = hideRoomPanel;
  }
}

/**
 * hideRoomPanel()
 * Slide the panel out.
 */
export function hideRoomPanel() {
  const panel = document.getElementById('room-panel');
  if (!panel) return;
  panel.classList.remove('panel-visible');
  panel.classList.add('panel-hidden');
}

// ─── Toast ───────────────────────────────────────────────────────────────────

let _toastTimer = null;

/**
 * showToast(message, type)
 * Briefly shows a small notification bar.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
export function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  // Clear any running dismiss timer
  if (_toastTimer) clearTimeout(_toastTimer);

  toast.textContent = message;
  toast.className   = `toast toast-${type} toast-visible`;

  _toastTimer = setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hidden');
  }, 3000);
}

// ─── Loading overlay ─────────────────────────────────────────────────────────

/**
 * hideLoadingOverlay()
 * Fades out the initial loading screen once the scene is ready.
 */
export function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;

  overlay.style.opacity    = '0';
  overlay.style.transition = 'opacity 0.8s ease';

  setTimeout(() => {
    overlay.style.display = 'none';
  }, 850);
}

// ─── Sidebar mobile toggle ───────────────────────────────────────────────────

/**
 * initSidebarToggle()
 * Wires up the hamburger menu button for mobile sidebar open/close.
 */
export function initSidebarToggle() {
  const menuBtn  = document.getElementById('menu-toggle');
  const sidebar  = document.getElementById('sidebar');
  if (!menuBtn || !sidebar) return;

  menuBtn.addEventListener('click', () => {
    sidebar.classList.toggle('sidebar-open');
    menuBtn.setAttribute(
      'aria-expanded',
      sidebar.classList.contains('sidebar-open').toString()
    );
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', e => {
    if (
      sidebar.classList.contains('sidebar-open') &&
      !sidebar.contains(e.target) &&
      e.target !== menuBtn
    ) {
      sidebar.classList.remove('sidebar-open');
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
