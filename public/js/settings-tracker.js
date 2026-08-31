/**
 * Unsaved-changes tracking for settings pages.
 *
 * Each `.settings-card[data-card="name"]` is compared against the snapshot
 * taken when the page loaded. Reverting a field by hand clears the warning, so
 * the page never nags about a change that is no longer there. One save bar
 * commits every dirty card; a card is only re-baselined once the server has
 * accepted it, so a failed save stays visibly unsaved.
 *
 * Pages supply a `savers` map — one function per card name, returning a
 * promise of true on success. Everything else (the bar, the leave guard, the
 * in-app navigation dialog) lives here so Instructor and Dean settings behave
 * identically. Pair with /css/settings-chrome.css.
 *
 * Expects in the markup: #dirtyBar, #dirtyBarText, #btnSaveAll, #btnDiscardAll,
 * and #leaveOverlay with #leaveBody, #leaveStay, #leaveDiscard, #leaveSave.
 * Fields marked [data-no-track] are ignored — passwords and transient controls.
 */
(function (global) {
    'use strict';

    function create(options) {
        var savers = options.savers || {};
        var onChange = options.onChange || function () {};

        var cards = Array.prototype.slice.call(document.querySelectorAll('.settings-card'));
        var dirtyBar = document.getElementById('dirtyBar');
        var dirtyBarText = document.getElementById('dirtyBarText');
        var saveAllBtn = document.getElementById('btnSaveAll');
        var discardBtn = document.getElementById('btnDiscardAll');

        if (!cards.length || !dirtyBar || !saveAllBtn) return null;

        // ── Dirty state ──

        /** A card's current state, as a comparable string. */
        function snapshot(card) {
            var fields = card.querySelectorAll(
                'input:not([data-no-track]), select:not([data-no-track]), textarea:not([data-no-track])');
            return Array.prototype.map.call(fields, function (field) {
                if (field.type === 'checkbox' || field.type === 'radio') return field.checked ? '1' : '0';
                return field.value;
            }).join(' ');
        }

        function baseline(card) { card.dataset.baseline = snapshot(card); }
        function isDirty(card) { return card.dataset.baseline !== snapshot(card); }
        function dirtyCards() { return cards.filter(isDirty); }

        function refresh() {
            cards.forEach(function (card) { card.classList.toggle('is-dirty', isDirty(card)); });

            var count = dirtyCards().length;
            dirtyBar.classList.toggle('show', count > 0);
            // Mobile pins the bar to the viewport, so the page needs room beneath it
            document.body.classList.toggle('has-unsaved', count > 0);
            if (dirtyBarText) {
                dirtyBarText.textContent = count === 1
                    ? 'You have unsaved changes in 1 section.'
                    : 'You have unsaved changes in ' + count + ' sections.';
            }
            onChange(count);
        }

        cards.forEach(function (card) {
            baseline(card);
            card.addEventListener('input', refresh);
            card.addEventListener('change', refresh);
        });

        // ── Saving ──

        /** Runs a card's saver and re-baselines it only if the server accepted it. */
        function saveCard(name) {
            var card = document.querySelector('.settings-card[data-card="' + name + '"]');
            if (!savers[name]) return Promise.resolve(true);
            return Promise.resolve(savers[name]()).then(function (ok) {
                if (ok) {
                    baseline(card);
                    refresh();
                }
                return ok;
            });
        }

        // Cards save in sequence rather than in parallel, so their toasts stay readable
        function saveAll() {
            saveAllBtn.disabled = true;
            return dirtyCards().reduce(function (chain, card) {
                return chain.then(function (allOk) {
                    return saveCard(card.dataset.card).then(function (ok) { return allOk && ok; });
                });
            }, Promise.resolve(true)).then(function (allOk) {
                saveAllBtn.disabled = false;
                return allOk;
            });
        }

        saveAllBtn.addEventListener('click', saveAll);

        if (discardBtn) {
            discardBtn.addEventListener('click', function () {
                // The baselines are the last saved values, so a reload is the discard
                window.removeEventListener('beforeunload', warnBeforeUnload);
                window.location.reload();
            });
        }

        // ── Leaving the page ──

        function warnBeforeUnload(event) {
            if (!dirtyCards().length) return;
            event.preventDefault();
            event.returnValue = '';
            return '';
        }
        window.addEventListener('beforeunload', warnBeforeUnload);

        // beforeunload cannot be customised, so in-app navigation gets a real dialog
        var leaveOverlay = document.getElementById('leaveOverlay');
        var pendingHref = null;

        function closeLeaveModal() {
            if (leaveOverlay) leaveOverlay.classList.remove('show');
            pendingHref = null;
        }

        function leaveNow() {
            window.removeEventListener('beforeunload', warnBeforeUnload);
            window.location.href = pendingHref;
        }

        if (leaveOverlay) {
            document.addEventListener('click', function (event) {
                var link = event.target.closest('a[href]');
                if (!link || !dirtyCards().length) return;

                var href = link.getAttribute('href');
                if (!href || href.charAt(0) === '#' || link.target === '_blank') return;
                if (link.origin && link.origin !== window.location.origin) return;
                if (href === window.location.pathname) return;

                event.preventDefault();
                pendingHref = link.href;
                var body = document.getElementById('leaveBody');
                if (body) {
                    body.textContent = 'You have unsaved changes in ' + dirtyCards().length +
                        ' section(s). Save them before leaving?';
                }
                leaveOverlay.classList.add('show');
            });

            document.getElementById('leaveStay').addEventListener('click', closeLeaveModal);
            document.getElementById('leaveDiscard').addEventListener('click', leaveNow);
            document.getElementById('leaveSave').addEventListener('click', function () {
                var href = pendingHref;
                saveAll().then(function (allOk) {
                    if (!allOk) { closeLeaveModal(); return; }
                    pendingHref = href;
                    leaveNow();
                });
            });
            leaveOverlay.addEventListener('click', function (event) {
                if (event.target === leaveOverlay) closeLeaveModal();
            });
        }

        refresh();

        return {
            refresh: refresh,
            baseline: baseline,
            saveAll: saveAll,
            saveCard: saveCard,
            dirtyCards: dirtyCards,
        };
    }

    global.SettingsTracker = { create: create };
}(window));
