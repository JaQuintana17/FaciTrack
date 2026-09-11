/**
 * Student > Settings.
 *
 * Two independent things live on this page:
 *
 *   Device notifications — drives this browser's push subscription, so it takes
 *   effect the moment it is toggled and is deliberately outside the unsaved-
 *   changes tracking. It is per-device; there is nothing on the account to save.
 *
 *   Faculty directory — department and its "start here" preference, saved
 *   together through the shared SettingsTracker so this page behaves like the
 *   Instructor, Dean and Admin settings pages.
 */
(function () {
    'use strict';

    function showToast(type, title, message) {
        var c = document.getElementById('toastContainer');
        if (!c) return;
        var t = document.createElement('div');
        t.className = 'toast ' + type;
        t.innerHTML = '<div class="toast-content"><p class="toast-title">' + title +
            '</p><p class="toast-message">' + message + '</p></div>';
        c.appendChild(t);
        setTimeout(function () {
            t.style.opacity = '0';
            setTimeout(function () { t.remove(); }, 300);
        }, 4000);
    }

    // ── Device notifications (Web Push) ──

    var pushToggle = document.getElementById('pushToggle');
    var pushMsg = document.getElementById('pushMsg');
    var pushTestBtn = document.getElementById('pushTestBtn');

    function sayPush(text, ok) {
        pushMsg.textContent = text;
        pushMsg.style.color = ok ? '#166534' : '#dc2626';
        pushMsg.style.display = text ? 'block' : 'none';
    }

    function refreshPush() {
        return window.FaciTrackPush.getState().then(function (state) {
            pushToggle.checked = state === 'on';
            pushToggle.disabled = state === 'unsupported' || state === 'denied';
            pushTestBtn.style.display = state === 'on' ? 'inline-block' : 'none';

            if (state === 'unsupported') {
                sayPush('This browser does not support device notifications.', false);
            } else if (state === 'denied') {
                sayPush('Notifications are blocked. Allow them in your browser settings to turn this on.', false);
            } else {
                sayPush('', true);
            }
        });
    }

    pushToggle.addEventListener('change', function () {
        var wanted = this.checked;
        pushToggle.disabled = true;
        sayPush('', true);

        var action = wanted ? window.FaciTrackPush.enable() : window.FaciTrackPush.disable();
        action.then(function (result) {
            if (!result.ok) {
                sayPush(result.error, false);
                pushToggle.checked = !wanted;
            } else {
                sayPush(wanted ? 'Device notifications enabled.' : 'Device notifications turned off.', true);
            }
            pushToggle.disabled = false;
            refreshPush();
        });
    });

    pushTestBtn.addEventListener('click', function () {
        fetch('/notifications/push/test', { method: 'POST' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                sayPush(data.success && data.sent
                    ? 'Test notification sent to ' + data.sent + ' device(s).'
                    : 'Could not send the test notification.', Boolean(data.sent));
            })
            .catch(function () { sayPush('Could not send the test notification.', false); });
    });

    refreshPush();

    // ── Faculty directory ──

    var deptSelect = document.getElementById('deptSelect');
    var ownDeptToggle = document.getElementById('ownDeptToggle');
    var dirMsg = document.getElementById('dirMsg');

    function sayDir(text, ok) {
        dirMsg.textContent = text;
        dirMsg.style.color = ok ? '#166534' : '#dc2626';
        dirMsg.style.display = text ? 'block' : 'none';
    }

    // The toggle has nothing to point at without a department, so it follows the
    // select rather than letting someone save a preference that does nothing.
    function syncToggleAvailability() {
        var hasDept = Boolean(deptSelect.value);
        ownDeptToggle.disabled = !hasDept;
        if (!hasDept) ownDeptToggle.checked = false;
        sayDir(hasDept ? '' : 'Choose your department to use this.', false);
    }

    deptSelect.addEventListener('change', syncToggleAvailability);
    syncToggleAvailability();

    var savers = {
        directory: function () {
            return fetch('/student/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    departmentId: deptSelect.value || null,
                    directoryOwnDept: ownDeptToggle.checked,
                }),
            })
                .then(function (r) { return r.json().catch(function () { return {}; }); })
                .then(function (data) {
                    if (!data.success) {
                        showToast('error', 'Not Saved', data.error || 'Please try again.');
                        return false;
                    }
                    showToast('success', 'Saved', 'Directory settings updated.');
                    return true;
                })
                .catch(function () {
                    showToast('error', 'Not Saved', 'Please try again.');
                    return false;
                });
        },
    };

    window.SettingsTracker.create({ savers: savers });
}());
