/**
 * The "publish my schedule" card.
 *
 * Fetches the subscription URL, wires the copy button and the one-click
 * Google/Apple links, and handles regenerating a leaked link. Role-agnostic —
 * the endpoint prefix is read from the card, so instructor and student settings
 * share this file rather than each growing a copy.
 */
(function () {
    'use strict';

    var card = document.querySelector('[data-feed-card]');
    if (!card) return;

    // /instructor or /student — whichever page mounted the card
    var base = (card.dataset.feedCard || '/instructor') + '/calendar/feed-link';

    var urlInput = document.getElementById('feedUrl');
    var copyBtn = document.getElementById('feedCopy');
    var statusEl = document.getElementById('feedStatus');
    var googleLink = document.getElementById('feedGoogle');
    var appleLink = document.getElementById('feedApple');
    var rotateBtn = document.getElementById('feedRotate');

    function say(message, bad) {
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.classList.toggle('bad', Boolean(bad));
        statusEl.hidden = !message;
    }

    function apply(data) {
        urlInput.value = data.url;

        // Google takes the https URL as a query parameter; Apple opens webcal://
        // directly, which is what makes it a single click on a Mac or iPhone.
        if (googleLink) {
            googleLink.href = 'https://calendar.google.com/calendar/r?cid=' +
                encodeURIComponent(data.url);
        }
        if (appleLink) appleLink.href = data.webcal;
    }

    function load() {
        fetch(base, { headers: { Accept: 'application/json' } })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (!data.success) throw new Error(data.error || 'Could not build the link.');
                apply(data);
            })
            .catch(function (err) {
                urlInput.value = '';
                urlInput.placeholder = 'Could not load the link';
                say(err.message || 'Could not load the link.', true);
            });
    }

    copyBtn.addEventListener('click', function () {
        if (!urlInput.value) return;

        var done = function () {
            copyBtn.textContent = 'Copied';
            copyBtn.classList.add('done');
            setTimeout(function () {
                copyBtn.textContent = 'Copy';
                copyBtn.classList.remove('done');
            }, 2000);
        };

        // navigator.clipboard needs a secure context, which a LAN demo over
        // plain http is not — so fall back to selecting the field.
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(urlInput.value).then(done).catch(function () {
                urlInput.select();
                say('Press Ctrl+C to copy.', false);
            });
        } else {
            urlInput.select();
            urlInput.setSelectionRange(0, urlInput.value.length);
            try {
                document.execCommand('copy');
                done();
            } catch (err) {
                say('Press Ctrl+C to copy.', false);
            }
        }
    });

    if (rotateBtn) {
        rotateBtn.addEventListener('click', function () {
            if (!window.confirm('Regenerate the link? Calendars already subscribed will stop updating.')) return;

            rotateBtn.disabled = true;
            rotateBtn.textContent = 'Regenerating…';

            fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
                .then(function (res) { return res.json(); })
                .then(function (data) {
                    if (!data.success) throw new Error(data.error || 'Could not regenerate.');
                    apply(data);
                    say('New link generated. Re-add it in your calendar app.', false);
                })
                .catch(function (err) { say(err.message || 'Could not regenerate.', true); })
                .finally(function () {
                    rotateBtn.disabled = false;
                    rotateBtn.textContent = 'Regenerate link';
                });
        });
    }

    load();
}());
