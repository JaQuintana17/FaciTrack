/**
 * Admin → Displays.
 *
 * Approving is deliberately done by typing the code that is on the screen,
 * rather than clicking a row: it makes the admin confirm they are activating
 * the panel they think they are, and not whichever one happened to register
 * most recently.
 */
(function () {
    'use strict';

    function say(message, ok) {
        var el = document.getElementById('dspMsg');
        if (!el) return;
        el.textContent = message;
        el.className = 'dsp-msg ' + (ok ? 'ok' : 'bad');
    }

    function post(url, body) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        }).then(function (res) { return res.json(); });
    }

    var codeInput = document.getElementById('dspCode');
    if (codeInput) {
        // The code is shown in upper case on the panel; accept it typed either way.
        codeInput.addEventListener('input', function () {
            this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });
    }

    var approve = document.getElementById('dspApprove');
    if (approve) {
        approve.addEventListener('click', function () {
            var code = (codeInput.value || '').trim();
            if (code.length !== 6) { say('Enter the six-character code shown on the screen.', false); return; }

            approve.disabled = true;
            post('/admin/displays/approve', {
                code: code,
                departmentId: document.getElementById('dspDept').value,
                label: document.getElementById('dspLabel').value,
            })
                .then(function (data) {
                    if (!data.success) { approve.disabled = false; say(data.error, false); return; }
                    say('Approved. The screen will switch over within a few seconds.', true);
                    setTimeout(function () { window.location.reload(); }, 1200);
                })
                .catch(function () {
                    approve.disabled = false;
                    say('Could not reach the server.', false);
                });
        });
    }

    document.addEventListener('click', function (e) {
        var revoke = e.target.closest('[data-revoke]');
        var forget = e.target.closest('[data-forget]');
        if (!revoke && !forget) return;

        var id = (revoke || forget).getAttribute(revoke ? 'data-revoke' : 'data-forget');
        var question = revoke
            ? 'Revoke this display? The screen will go back to showing a code.'
            : 'Forget this screen? It will have to be registered again.';
        if (!window.confirm(question)) return;

        post('/admin/displays/' + encodeURIComponent(id) + (revoke ? '/revoke' : '/forget'))
            .then(function (data) {
                if (!data.success) { say(data.error || 'That did not work.', false); return; }
                window.location.reload();
            })
            .catch(function () { say('Could not reach the server.', false); });
    });
}());
