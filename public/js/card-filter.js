/**
 * Search and filter over a set of already-rendered cards.
 *
 * The card grids are server-rendered, so rather than shipping the data twice
 * this reads what to match against from `data-search` and any `data-*`
 * attributes the page names as filters. Nothing is re-rendered — cards are
 * shown or hidden — which keeps links, focus and the back button intact.
 *
 * Used by the student's instructor grid and appointment history, so the two
 * behave the same way.
 */
(function (global) {
    'use strict';

    /**
     * @param {object}   config
     * @param {string}   config.cardSelector   e.g. '.inst-card'
     * @param {string}   [config.search]       selector for the text input
     * @param {Array}    [config.filters]      [{ selector, attr }] — matches card.dataset[attr]
     * @param {string}   [config.count]        selector for the result counter
     * @param {string}   [config.empty]        selector for the no-results block
     * @param {string}   [config.noun]         'instructor', 'appointment'
     * @param {function} [config.onFilter]     called with the visible cards after each pass
     */
    function create(config) {
        var cards = Array.prototype.slice.call(document.querySelectorAll(config.cardSelector));
        if (!cards.length) return null;

        var searchInput = config.search ? document.querySelector(config.search) : null;
        var countEl = config.count ? document.querySelector(config.count) : null;
        var emptyEl = config.empty ? document.querySelector(config.empty) : null;

        var filters = (config.filters || []).map(function (spec) {
            return { el: document.querySelector(spec.selector), attr: spec.attr };
        }).filter(function (f) { return f.el; });

        function matches(card) {
            var passesFilters = filters.every(function (f) {
                if (!f.el.value || f.el.value === 'all') return true;
                return card.dataset[f.attr] === f.el.value;
            });
            if (!passesFilters) return false;

            var query = (searchInput && searchInput.value || '').toLowerCase().trim();
            if (!query) return true;
            return (card.dataset.search || '').indexOf(query) !== -1;
        }

        function apply() {
            var visible = [];
            cards.forEach(function (card) {
                var show = matches(card);
                card.hidden = !show;
                if (show) visible.push(card);
            });

            if (countEl) {
                var noun = config.noun || 'result';
                countEl.textContent = visible.length + ' ' + noun + (visible.length === 1 ? '' : 's');
            }
            if (emptyEl) emptyEl.hidden = visible.length > 0;
            if (config.onFilter) config.onFilter(visible);
        }

        if (searchInput) searchInput.addEventListener('input', apply);
        filters.forEach(function (f) { f.el.addEventListener('change', apply); });

        apply();
        return { apply: apply, cards: cards };
    }

    global.CardFilter = { create: create };
}(window));
