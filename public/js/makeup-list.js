/**
 * Status tabs and search for both make-up request lists.
 *
 * Every request card renders once with a `data-status` and a lowercased
 * `data-search` haystack, so filtering is instant and needs no round trip.
 * The instructor and dean pages share this — only the tabs differ.
 */
(function () {
    'use strict';

    var tabs = document.querySelectorAll('.mk-tab');
    var cards = document.querySelectorAll('.mk-req');
    var searchInput = document.getElementById('mkSearch');
    var clearBtn = document.getElementById('mkSearchClear');
    var emptyBox = document.getElementById('mkFilterEmpty');
    if (!tabs.length && !searchInput) return;

    var activeStatus = 'all';
    var query = '';

    function apply() {
        var shown = 0;

        cards.forEach(function (card) {
            var matchesTab = activeStatus === 'all' || card.dataset.status === activeStatus;
            var matchesQuery = !query || (card.dataset.search || '').indexOf(query) !== -1;
            var visible = matchesTab && matchesQuery;
            card.hidden = !visible;
            if (visible) shown++;
        });

        // The per-status "nothing here" blocks belong to their own tab only
        document.querySelectorAll('.mk-panel-empty').forEach(function (box) {
            box.hidden = !(box.dataset.status === activeStatus && !query && !shown);
        });

        if (emptyBox) {
            emptyBox.hidden = shown > 0 || !query;
            if (!emptyBox.hidden) emptyBox.textContent = 'Nothing matches "' + searchInput.value.trim() + '".';
        }
        if (clearBtn) clearBtn.hidden = !query;
    }

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            tabs.forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');
            activeStatus = tab.dataset.tab;
            document.body.dataset.mkTab = activeStatus;
            apply();
        });
    });

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            query = this.value.trim().toLowerCase();
            apply();
        });
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { this.value = ''; query = ''; apply(); }
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            searchInput.value = '';
            query = '';
            searchInput.focus();
            apply();
        });
    }

    var initial = document.querySelector('.mk-tab.active');
    if (initial) activeStatus = initial.dataset.tab;
    document.body.dataset.mkTab = activeStatus;
    apply();
}());
