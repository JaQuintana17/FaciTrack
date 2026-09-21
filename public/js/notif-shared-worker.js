// public/js/notif-shared-worker.js
//
// One EventSource shared by every open tab. Without this, five tabs would hold
// five server-sent-event connections for the same person.
//
// Every event the server sends is forwarded to whoever is listening; adding a
// new server event no longer means editing this file.

const FORWARDED = ['notification:new', 'presence:changed'];

let eventSource = null;
const ports = [];

function ensureConnection() {
    if (eventSource) return;

    eventSource = new EventSource('/notifications/stream');

    FORWARDED.forEach(function (name) {
        eventSource.addEventListener(name, function (e) {
            let payload = null;
            try { payload = JSON.parse(e.data); } catch (err) { payload = e.data; }
            broadcast({ type: name, payload: payload });
        });
    });

    eventSource.onerror = function () {
        broadcast({ type: 'connection:error' });

        // CLOSED means the browser has given up rather than scheduled a retry.
        // A host that cannot hold a stream open answers the request in a way
        // that produces exactly this, so the pages are told to stop waiting on
        // the worker and poll for themselves instead.
        if (eventSource.readyState === EventSource.CLOSED) {
            broadcast({ type: 'connection:closed' });
            eventSource = null;
        }
    };

    eventSource.onopen = function () {
        broadcast({ type: 'connection:open' });
    };
}

function broadcast(message) {
    ports.forEach(port => port.postMessage(message));
}

self.onconnect = function (e) {
    const port = e.ports[0];
    ports.push(port);
    ensureConnection();

    port.onmessage = function (event) {
        if (event.data === 'close') {
            const idx = ports.indexOf(port);
            if (idx !== -1) ports.splice(idx, 1);
            // The last tab out closes the connection
            if (ports.length === 0 && eventSource) {
                eventSource.close();
                eventSource = null;
            }
        }
    };

    port.start();
};
