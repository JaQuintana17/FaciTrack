/**
 * Dean Settings page.
 *
 * The change tracking, save bar and leave guard come from
 * /js/settings-tracker.js — the same behaviour the Instructor settings page
 * uses. This file only supplies what is specific to the dean: one saver per
 * card, plus the password form, which stays outside the tracker.
 */
(function () {
    'use strict';

    // ── Toast ──
    function showToast(type, title, message) {
        var container = document.getElementById('toastContainer');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.innerHTML = '<div class="toast-content">' +
            '<p class="toast-title"></p><p class="toast-message"></p></div>';
        toast.querySelector('.toast-title').textContent = title;
        toast.querySelector('.toast-message').textContent = message;
        container.appendChild(toast);
        setTimeout(function () {
            toast.style.opacity = '0';
            setTimeout(function () { toast.remove(); }, 300);
        }, 4000);
    }

    function request(url, body) {
        return fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then(function (res) { return res.json().catch(function () { return {}; }); })
            .catch(function () { return { success: false, error: 'Network error. Please try again.' }; });
    }

    var REPORT_KEY = 'deanReportSettings';
    var REPORT_FIELDS = ['defaultPeriod', 'reportCollege', 'reportDeanName'];

    // ── Savers, one per card ─────────────────────────────────────────────────
    var savers = {
        profile: function () {
            var firstName = document.getElementById('inputFirstName').value.trim();
            var lastName = document.getElementById('inputLastName').value.trim();
            if (!firstName || !lastName) {
                showToast('error', 'Missing Fields', 'First name and last name are required.');
                return Promise.resolve(false);
            }
            return request('/dean/profile', {
                firstName: firstName,
                middleName: document.getElementById('inputMiddleName').value.trim(),
                lastName: lastName,
            }).then(function (data) {
                if (!data.success) {
                    showToast('error', 'Not Saved', data.error || 'Could not update your profile.');
                    return false;
                }
                // Keep the header card and sidebar in step without a reload
                document.querySelector('.settings-name').textContent = data.name;
                var sidebarName = document.querySelector('.profile-name-mini');
                if (sidebarName) sidebarName.textContent = data.name;
                showToast('success', 'Saved', 'Personal information updated.');
                return true;
            });
        },

        notifications: function () {
            var body = {
                notifyNewRequests: document.getElementById('prefMakeup').checked,
                notifyAnnouncements: document.getElementById('prefAnnouncements').checked,
            };
            // Carry through the preferences this page does not show
            var carried = window.DEAN_CARRIED_PREFS || {};
            Object.keys(carried).forEach(function (key) { body[key] = carried[key]; });

            return request('/dean/settings/notifications', body).then(function (data) {
                if (!data.success) {
                    showToast('error', 'Not Saved', data.error || 'Could not save preferences.');
                    return false;
                }
                showToast('success', 'Saved', 'Notification preferences updated.');
                return true;
            });
        },

        // Report headers are applied by the exporter in the browser, so they are
        // stored per device rather than round-tripped through the server.
        report: function () {
            var payload = {};
            REPORT_FIELDS.forEach(function (id) {
                payload[id] = document.getElementById(id).value;
            });
            try {
                localStorage.setItem(REPORT_KEY, JSON.stringify(payload));
            } catch (err) {
                showToast('error', 'Not Saved', 'This browser is blocking local storage.');
                return Promise.resolve(false);
            }
            showToast('success', 'Saved', 'Report settings saved on this device.');
            return Promise.resolve(true);
        },
    };

    // Restore the per-device report settings before the tracker takes its
    // baseline, or the restored values would themselves look like edits.
    try {
        var saved = JSON.parse(localStorage.getItem(REPORT_KEY) || '{}');
        REPORT_FIELDS.forEach(function (id) {
            if (saved[id]) document.getElementById(id).value = saved[id];
        });
    } catch (err) { /* a cleared or blocked store just means the defaults stand */ }

    var tracker = window.SettingsTracker.create({ savers: savers });

    // ── Security ──
    document.getElementById('btnChangePassword').addEventListener('click', function () {
        var button = this;
        var current = document.getElementById('inputCurrentPw');
        var next = document.getElementById('inputNewPw');
        var confirm = document.getElementById('inputConfirmPw');

        if (!current.value || !next.value || !confirm.value) {
            showToast('error', 'Missing Fields', 'Please fill in all password fields.');
            return;
        }
        if (next.value.length < 8) {
            showToast('error', 'Too Short', 'New password must be at least 8 characters.');
            return;
        }
        if (next.value !== confirm.value) {
            showToast('error', 'Mismatch', 'New passwords do not match.');
            return;
        }

        button.disabled = true;
        request('/dean/password', {
            currentPassword: current.value,
            newPassword: next.value,
        }).then(function (data) {
            button.disabled = false;
            if (!data.success) {
                showToast('error', 'Not Changed', data.error || 'Could not change your password.');
                return;
            }
            current.value = next.value = confirm.value = '';
            showToast('success', 'Updated', 'Password changed successfully.');
        });
    });

    // ── Profile photo ──
    // Saved to the account, not the browser. The sidebar avatar is repainted
    // alongside the settings one so the change is visible without a reload.
    AvatarUpload.init({
        input: 'settingsAvatarInput',
        remove: 'settingsAvatarRemove',
        targets: ['settingsAvatar', 'deanSidebarAvatar'],
        notify: showToast
    });

    if (tracker) tracker.refresh();
}());
