/**
 * Subscribing to server-sent events, in one place.
 *
 * The notification panel grew its own copy of this; anything new should use
 * this instead so a change to how the connection is made happens once.
 *
 *     Realtime.on('presence:changed', function (payload) { ... });
 *
 * Prefers the SharedWorker so every open tab shares one connection. Browsers
 * without SharedWorker — several mobile ones — fall back to an EventSource per
 * tab, which costs a connection but behaves identically to the caller.
 */
(function (global) {
    'use strict';

    var handlers = {};
    var started = false;
    var connected = false;

    function emit(type, payload) {
        (handlers[type] || []).forEach(function (fn) {
            try { fn(payload); } catch (err) { console.error('[Realtime] handler for ' + type + ':', err); }
        });
    }

    function start() {
        if (started) return;
        started = true;

        if (global.SharedWorker) {
            try {
                var worker = new SharedWorker('/js/notif-shared-worker.js');
                worker.port.start();
                worker.port.onmessage = function (e) {
                    if (!e.data || !e.data.type) return;
                    if (e.data.type === 'connection:open') connected = true;
                    if (e.data.type === 'connection:error') connected = false;
                    emit(e.data.type, e.data.payload);
                };
                global.addEventListener('beforeunload', function () {
                    try { worker.port.postMessage('close'); } catch (err) { /* closing anyway */ }
                });
                return;
            } catch (err) {
                // Some browsers expose SharedWorker but refuse to construct it
                console.warn('[Realtime] SharedWorker unavailable, using a direct stream:', err.message);
            }
        }

        var stream = new EventSource('/notifications/stream');
        ['notification:new', 'presence:changed'].forEach(function (name) {
            stream.addEventListener(name, function (e) {
                var payload = null;
                try { payload = JSON.parse(e.data); } catch (err) { payload = e.data; }
                emit(name, payload);
            });
        });
        stream.onopen = function () { connected = true; emit('connection:open'); };
        stream.onerror = function () { connected = false; emit('connection:error'); };
    }

    global.Realtime = {
        /** Register a handler. The connection opens on the first subscription. */
        on: function (type, handler) {
            (handlers[type] = handlers[type] || []).push(handler);
            start();
            return this;
        },
        isConnected: function () { return connected; },
    };
})(window);
