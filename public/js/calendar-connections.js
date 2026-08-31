/**
 * Connected Calendars, on the instructor settings page.
 *
 * Every change here saves immediately rather than joining the page's unsaved-
 * changes tracking — connecting a feed performs a network fetch, so it cannot
 * sit pending behind a Save button.
 */
(function () {
    'use strict';

    var list = document.getElementById('calList');
    if (!list) return;

    var empty = document.getElementById('calEmpty');
    var status = document.getElementById('calStatus');
    var modal = document.getElementById('calAddModal');

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function ago(value) {
        if (!value) return 'never synced';
        var then = new Date(String(value).replace(' ', 'T'));
        var mins = Math.round((Date.now() - then.getTime()) / 60000);
        if (!isFinite(mins)) return 'never synced';
        if (mins < 1) return 'synced just now';
        if (mins < 60) return 'synced ' + mins + 'm ago';
        if (mins < 1440) return 'synced ' + Math.round(mins / 60) + 'h ago';
        return 'synced ' + Math.round(mins / 1440) + 'd ago';
    }

    function say(message, kind) {
        if (!status) return;
        status.hidden = !message;
        status.textContent = message || '';
        status.className = 'cal-status' + (kind ? ' ' + kind : '');
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    function render(connections) {
        list.innerHTML = (connections || []).map(function (c) {
            var failed = c.last_status === 'error';
            return '' +
            '<li class="cal-item' + (failed ? ' has-error' : '') + '" data-id="' + escapeHtml(c.id) + '">' +
              '<div class="cal-item-head">' +
                '<div class="cal-item-id">' +
                  '<span class="cal-provider ' + escapeHtml(c.provider) + '">' +
                    (c.provider === 'google' ? 'Google' : c.provider === 'apple' ? 'Apple' : 'Calendar') +
                  '</span>' +
                  '<span class="cal-name">' + escapeHtml(c.display_name) + '</span>' +
                '</div>' +
                '<button type="button" class="cal-remove" data-remove title="Disconnect">&times;</button>' +
              '</div>' +
              '<p class="cal-meta">' +
                escapeHtml(c.feed_hint) + ' · ' + escapeHtml(String(c.event_count)) + ' events · ' +
                escapeHtml(ago(c.last_synced_at)) +
              '</p>' +
              (failed ? '<p class="cal-error">' + escapeHtml(c.last_error || 'Last sync failed.') + '</p>' : '') +
              '<div class="cal-item-controls">' +
                '<label class="cal-field"><span>Blocks appointments</span>' +
                  '<select class="modal-input" data-rule data-no-track>' +
                    ['ask', 'always', 'never'].map(function (v) {
                      var label = v === 'ask' ? 'Ask me' : v === 'always' ? 'Always' : 'Never';
                      return '<option value="' + v + '"' + (c.blocking_rule === v ? ' selected' : '') + '>' + label + '</option>';
                    }).join('') +
                  '</select>' +
                '</label>' +
                '<label class="cal-toggle">' +
                  '<input type="checkbox" data-auto data-no-track' + (c.auto_sync ? ' checked' : '') + '>' +
                  '<span>Auto-sync</span>' +
                '</label>' +
                '<label class="cal-toggle">' +
                  '<input type="checkbox" data-titles data-no-track' + (c.import_titles ? ' checked' : '') + '>' +
                  '<span>Import titles</span>' +
                '</label>' +
                '<button type="button" class="cal-sync-one" data-sync>Sync</button>' +
              '</div>' +
            '</li>';
        }).join('');

        empty.hidden = (connections || []).length > 0;
    }

    function load() {
        fetch('/instructor/calendar/connections')
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) render(d.connections); })
            .catch(function () { say('Could not load your calendars.', 'bad'); });
    }

    // ── Per-connection controls ────────────────────────────────────────────

    function patch(id, body) {
        return fetch('/instructor/calendar/connections/' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) { say(d.error || 'Could not save that.', 'bad'); return; }
                render(d.connections);
                say('Saved.', 'ok');
            })
            .catch(function () { say('Network error.', 'bad'); });
    }

    list.addEventListener('change', function (e) {
        var item = e.target.closest('.cal-item');
        if (!item) return;
        if (e.target.hasAttribute('data-rule')) patch(item.dataset.id, { blockingRule: e.target.value });
        if (e.target.hasAttribute('data-auto')) patch(item.dataset.id, { autoSync: e.target.checked });
        if (e.target.hasAttribute('data-titles')) patch(item.dataset.id, { importTitles: e.target.checked });
    });

    list.addEventListener('click', function (e) {
        var item = e.target.closest('.cal-item');
        if (!item) return;

        if (e.target.hasAttribute('data-remove')) {
            if (!confirm('Disconnect this calendar? Its imported events will be removed.')) return;
            fetch('/instructor/calendar/connections/' + encodeURIComponent(item.dataset.id), { method: 'DELETE' })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) { say(d.error || 'Could not disconnect.', 'bad'); return; }
                    render(d.connections);
                    say('Calendar disconnected.', 'ok');
                })
                .catch(function () { say('Network error.', 'bad'); });
        }

        if (e.target.hasAttribute('data-sync')) syncNow(item.dataset.id, e.target);
    });

    function syncNow(id, button) {
        var label = button ? button.textContent : '';
        if (button) { button.disabled = true; button.textContent = 'Syncing…'; }
        say('Syncing…');

        fetch('/instructor/calendar/sync' + (id ? '/' + encodeURIComponent(id) : ''), { method: 'POST' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (button) { button.disabled = false; button.textContent = label; }
                if (!d.success) { say(d.error || 'Sync failed.', 'bad'); return; }
                render(d.connections);

                if (d.failures && d.failures.length) {
                    say(d.failures[0].name + ': ' + d.failures[0].error, 'bad');
                    return;
                }
                say(d.imported + ' event' + (d.imported === 1 ? '' : 's') + ' imported.' +
                    (d.pending ? ' ' + d.pending + ' need a decision on the Appointments page.' : ''), 'ok');
            })
            .catch(function () {
                if (button) { button.disabled = false; button.textContent = label; }
                say('Network error.', 'bad');
            });
    }

    document.getElementById('calSyncAll').addEventListener('click', function () {
        syncNow(null, this);
    });

    // ── Connecting a new calendar ──────────────────────────────────────────

    var nameField = document.getElementById('calAddName');
    var urlField = document.getElementById('calAddUrl');
    var ruleField = document.getElementById('calAddRule');
    var titlesField = document.getElementById('calAddTitles');
    var errorBox = document.getElementById('calAddError');
    var confirmBtn = document.getElementById('calAddConfirm');

    function closeModal() { modal.classList.remove('show'); }

    document.getElementById('calAddOpen').addEventListener('click', function () {
        nameField.value = '';
        urlField.value = '';
        ruleField.value = 'ask';
        titlesField.checked = true;
        errorBox.style.display = 'none';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Connect';
        modal.classList.add('show');
        urlField.focus();
    });

    document.getElementById('calAddClose').addEventListener('click', closeModal);
    document.getElementById('calAddCancel').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

    confirmBtn.addEventListener('click', function () {
        var url = urlField.value.trim();
        if (!url) {
            errorBox.textContent = 'Paste the calendar address first.';
            errorBox.style.display = 'block';
            return;
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Checking…';
        errorBox.style.display = 'none';

        fetch('/instructor/calendar/connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: url,
                displayName: nameField.value.trim(),
                blockingRule: ruleField.value,
                importTitles: titlesField.checked,
            }),
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Connect';
                if (!d.success) {
                    errorBox.textContent = d.error || 'That calendar could not be added.';
                    errorBox.style.display = 'block';
                    return;
                }
                render(d.connections);
                closeModal();
                say(d.imported + ' event' + (d.imported === 1 ? '' : 's') + ' imported.' +
                    (d.pending ? ' ' + d.pending + ' need a decision on the Appointments page.' : ''), 'ok');
            })
            .catch(function () {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Connect';
                errorBox.textContent = 'Network error. Please try again.';
                errorBox.style.display = 'block';
            });
    });

    load();
}());
