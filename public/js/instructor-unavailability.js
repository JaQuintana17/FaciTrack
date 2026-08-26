/**
 * Shared behaviour for the "Mark Date Unavailable" modal.
 * Pairs with views/partials/unavailability-modal.ejs.
 *
 * Blocking is always full-day (one date, or an inclusive range). After the block
 * is saved, any appointments already on those days are listed so the instructor
 * can reschedule or cancel each one.
 *
 * Pages may set window.onUnavailabilityChanged to refresh their own UI.
 */
const UnavailModal = (function () {

  let blocked = { startDate: null, endDate: null, reason: null };
  let remaining = 0;               // appointments still awaiting a decision
  let slotCache = null;            // reschedule options, fetched once per open
  let onAffectedStep = false;      // step 2 guards against an accidental dismiss

  const $ = id => document.getElementById(id);

  function fmtDate(key) {
    const d = new Date(key + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function rangeLabel(start, end) {
    return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
  }

  function countDays(start, end) {
    const ms = new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00');
    return Math.floor(ms / 86400000) + 1;
  }

  /** Live summary under the date inputs. */
  function updateSummary() {
    const start = $('unavailStartDate').value;
    const end = $('unavailEndDate').value || start;
    const box = $('unavailSummary');

    if (!start || end < start) { box.style.display = 'none'; return; }

    const days = countDays(start, end);
    box.textContent = days === 1
      ? `Blocking ${fmtDate(start)} — full day.`
      : `Blocking ${days} full days: ${rangeLabel(start, end)}.`;
    box.style.display = 'block';
    $('unavailConfirmBtn').textContent = days === 1 ? 'Block Date' : 'Block ' + days + ' Dates';
  }

  function showError(el, msg) {
    const box = $(el);
    box.textContent = msg;
    box.style.display = 'block';
  }

  function open(prefillDate, options) {
    const opts = options || {};
    onAffectedStep = false;
    // Reset to step 1
    $('unavailStepForm').style.display = '';
    $('unavailFooterForm').style.display = '';
    $('unavailStepAffected').style.display = 'none';
    $('unavailFooterAffected').style.display = 'none';
    $('unavailModalTitle').textContent = 'Mark Date Unavailable';

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const min = tomorrow.toISOString().split('T')[0];

    $('unavailStartDate').min = min;
    $('unavailEndDate').min = min;
    $('unavailStartDate').value = prefillDate || '';
    $('unavailEndDate').value = '';
    $('unavailReason').value = '';
    $('unavailFormError').style.display = 'none';
    $('unavailSummary').style.display = 'none';
    $('unavailConfirmBtn').disabled = false;
    $('unavailConfirmBtn').textContent = 'Block Date';
    document.querySelectorAll('.unav-preset').forEach(p => p.classList.remove('selected'));

    slotCache = null;
    // Contextual prompt, e.g. when opened straight after setting On Leave
    const promptBox = $('unavailPrompt');
    if (opts.prompt) {
      promptBox.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:.1rem">' +
        '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
        '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
        '<span>' + escapeHtml(opts.prompt) + '</span>';
      promptBox.style.display = 'flex';
    } else {
      promptBox.style.display = 'none';
    }
    if (opts.reason) $('unavailReason').value = opts.reason;

    $('unavailModal').classList.add('show');
    document.body.classList.add('modal-open');
    updateSummary();
  }

  /**
   * Closing from the header X or the backdrop. On step 2 the dates are already
   * blocked and each appointment still needs an answer, so leaving silently is
   * what made this look like the block "went through" by accident.
   */
  function requestClose() {
    if (onAffectedStep && remaining > 0) {
      showError('unavailAffectedError',
        remaining + ' appointment(s) still need a decision. Reschedule them, use ' +
        '"Decline all remaining", or "Undo block" to unblock these dates.');
      return;
    }
    close();
  }

  /** Remove the block that was just saved, for when it was not intended. */
  async function undoBlock() {
    const btn = $('unavailUndoBtn');
    if (!blocked.startDate) return close();

    btn.disabled = true;
    btn.textContent = 'Undoing…';

    try {
      const res = await fetch('/instructor/unavailability/range', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: blocked.startDate, endDate: blocked.endDate }),
      });
      const data = await res.json();

      if (!data.success) {
        btn.disabled = false;
        btn.textContent = 'Undo block';
        return showError('unavailAffectedError', data.error || 'Could not undo the block.');
      }

      toast('success', 'Block Removed', 'Those dates are open for booking again.');
      btn.disabled = false;
      btn.textContent = 'Undo block';
      remaining = 0;
      close();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Undo block';
      showError('unavailAffectedError', 'Network error. Please try again.');
    }
  }

  function close() {
    onAffectedStep = false;
    $('unavailModal').classList.remove('show');
    document.body.classList.remove('modal-open');
    // Let the host page refresh once the instructor is done
    if (blocked.startDate && typeof window.onUnavailabilityChanged === 'function') {
      window.onUnavailabilityChanged(blocked);
      blocked = { startDate: null, endDate: null, reason: null };
    }
  }

  async function submit() {
    const startDate = $('unavailStartDate').value;
    const endDate = $('unavailEndDate').value || startDate;
    const reason = $('unavailReason').value.trim();
    const btn = $('unavailConfirmBtn');
    $('unavailFormError').style.display = 'none';

    if (!startDate) return showError('unavailFormError', 'Please select a start date.');
    if (endDate < startDate) return showError('unavailFormError', 'The end date cannot be earlier than the start date.');

    btn.disabled = true;
    btn.textContent = 'Blocking…';

    try {
      const res = await fetch('/instructor/unavailability/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, reason: reason || null }),
      });
      const data = await res.json();

      if (!data.success) {
        btn.disabled = false;
        btn.textContent = 'Block Date';
        return showError('unavailFormError', data.error || 'Failed to block the date.');
      }

      blocked = { startDate: data.startDate, endDate: data.endDate, reason: data.reason };

      if (!data.affectedCount) {
        toast('success', 'Date Blocked', `${rangeLabel(data.startDate, data.endDate)} blocked. No appointments were affected.`);
        close();
        return;
      }

      showAffected(data);

    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Block Date';
      showError('unavailFormError', 'Network error. Please try again.');
    }
  }

  /** Switch to step 2 and render one card per affected appointment. */
  function showAffected(data) {
    remaining = data.affectedCount;
    onAffectedStep = true;
    $('unavailAffectedError').style.display = 'none';

    $('unavailStepForm').style.display = 'none';
    $('unavailFooterForm').style.display = 'none';
    $('unavailStepAffected').style.display = '';
    $('unavailFooterAffected').style.display = '';
    $('unavailModalTitle').textContent = 'Appointments Affected';

    $('unavailBlockedNote').textContent =
      `${rangeLabel(data.startDate, data.endDate)} is now blocked. Students can no longer book these days.`;

    $('unavailAffectedList').innerHTML = data.affected.map(renderCard).join('');
    toast('warning', 'Date Blocked', `${data.affectedCount} appointment(s) need your attention.`);
  }

  function renderCard(apt) {
    return `
      <div class="unav-apt" id="unavApt${apt.id}">
        <div class="unav-apt-head">
          <div>
            <div class="unav-apt-who">${escapeHtml(apt.studentName)}<span class="unav-badge ${apt.status}">${escapeHtml(apt.status)}</span></div>
            <div class="unav-apt-meta">
              ${fmtDate(apt.date)} · ${apt.timeStart} – ${apt.timeEnd}<br>
              ${escapeHtml(apt.courseSubject)} · ${escapeHtml(apt.sectionGroup)}<br>
              ${escapeHtml(apt.topic)}
            </div>
          </div>
          <div class="unav-apt-actions" id="unavActions${apt.id}">
            <button type="button" class="unav-btn unav-btn-resched"
                    onclick="UnavailModal.pickSlot(${apt.id})">Reschedule</button>
            <button type="button" class="unav-btn unav-btn-cancel"
                    onclick="UnavailModal.declineOne(${apt.id})">Decline</button>
          </div>
        </div>
        <div class="unav-slotpick" id="unavPick${apt.id}" style="display:none;"></div>
      </div>`;
  }

  /** Load bookable slots (blocked dates are already excluded server-side) and show a picker. */
  async function pickSlot(id) {
    const box = document.getElementById('unavPick' + id);
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }

    box.style.display = '';
    box.innerHTML = '<p class="unav-apt-meta">Loading available slots…</p>';

    try {
      if (!slotCache) {
        const res = await fetch('/instructor/appointments/reschedule-options');
        const data = await res.json();
        slotCache = data.success ? data.slots : [];
      }

      const options = slotCache.flatMap(g =>
        g.subSlots.map(s => `<option value="${s.id}">${fmtDate(g.date)} · ${s.timeStart} – ${s.timeEnd}</option>`)
      );

      if (!options.length) {
        box.innerHTML = '<p class="unav-apt-meta">No open slots available. You may need to add consultation hours first.</p>';
        return;
      }

      box.innerHTML = `
        <select id="unavSlot${id}">${options.join('')}</select>
        <button type="button" class="unav-btn unav-btn-resched"
                onclick="UnavailModal.confirmReschedule(${id})">Confirm new slot</button>`;
    } catch (err) {
      box.innerHTML = '<p class="unav-apt-meta">Could not load slots. Please try again.</p>';
    }
  }

  async function confirmReschedule(id) {
    const slotId = document.getElementById('unavSlot' + id)?.value;
    if (!slotId) return;

    try {
      const res = await fetch(`/instructor/appointments/${id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newSlotId: slotId, reason: blocked.reason || 'Instructor unavailable' }),
      });
      const data = await res.json();

      if (!data.success) return showError('unavailAffectedError', data.error || 'Failed to reschedule.');

      markResolved(id, 'Rescheduled');
    } catch (err) {
      showError('unavailAffectedError', 'Network error. Please try again.');
    }
  }

  async function declineOne(id) {
    try {
      const res = await fetch(`/instructor/appointments/${id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: blocked.reason || 'Instructor unavailable on this date' }),
      });
      const data = await res.json();

      if (!data.success) return showError('unavailAffectedError', data.error || 'Failed to cancel.');

      markResolved(id, 'Declined');
    } catch (err) {
      showError('unavailAffectedError', 'Network error. Please try again.');
    }
  }

  /** Decline everything still undecided in the blocked range. */
  async function declineAll() {
    const btn = $('unavailCancelAllBtn');
    btn.disabled = true;
    btn.textContent = 'Declining…';

    try {
      const res = await fetch('/instructor/unavailability/cancel-affected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: blocked.startDate,
          endDate: blocked.endDate,
          reason: blocked.reason || 'Instructor unavailable on this date',
        }),
      });
      const data = await res.json();

      if (!data.success) {
        btn.disabled = false;
        btn.textContent = 'Decline all remaining';
        return showError('unavailAffectedError', data.error || 'Failed to decline appointments.');
      }

      document.querySelectorAll('.unav-apt:not(.resolved)').forEach(el => {
        markResolved(el.id.replace('unavApt', ''), 'Declined');
      });
      toast('success', 'Appointments Declined', `${data.cancelledCount} student(s) were notified.`);
      btn.textContent = 'Decline all remaining';
      btn.disabled = false;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Decline all remaining';
      showError('unavailAffectedError', 'Network error. Please try again.');
    }
  }

  function markResolved(id, label) {
    const card = document.getElementById('unavApt' + id);
    if (!card || card.classList.contains('resolved')) return;

    card.classList.add('resolved');
    const pick = document.getElementById('unavPick' + id);
    if (pick) pick.style.display = 'none';
    document.getElementById('unavActions' + id).innerHTML =
      `<span class="unav-apt-status">✓ ${label}</span>`;

    remaining--;
    if (remaining <= 0) {
      $('unavailCancelAllBtn').style.display = 'none';
      $('unavailAffectedError').style.display = 'none';
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Use the page's toast if it has one, otherwise stay silent. */
  function toast(type, title, msg) {
    if (typeof window.showToast === 'function') window.showToast(type, title, msg);
  }

  // ── Wire up the static controls once the DOM is ready ──
  document.addEventListener('DOMContentLoaded', function () {
    if (!$('unavailModal')) return;

    $('unavailStartDate').addEventListener('change', function () {
      // Keep the end date from drifting before the start
      $('unavailEndDate').min = this.value;
      if ($('unavailEndDate').value && $('unavailEndDate').value < this.value) {
        $('unavailEndDate').value = '';
      }
      updateSummary();
    });
    $('unavailEndDate').addEventListener('change', updateSummary);

    document.querySelectorAll('.unav-preset').forEach(btn => {
      btn.addEventListener('click', function () {
        const wasSelected = this.classList.contains('selected');
        document.querySelectorAll('.unav-preset').forEach(p => p.classList.remove('selected'));
        if (!wasSelected) {
          this.classList.add('selected');
          $('unavailReason').value = this.dataset.reason;
        } else {
          $('unavailReason').value = '';
        }
      });
    });
  });

  return {
    open, close, requestClose, submit, pickSlot, confirmReschedule,
    declineOne, declineAll, undoBlock,
  };
})();
