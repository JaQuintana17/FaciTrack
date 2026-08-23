// public/js/notif-shared-worker.js
let eventSource = null;
const ports = [];

function ensureConnection() {
    if (eventSource) return;

    eventSource = new EventSource('/notifications/stream');

    eventSource.addEventListener('notification:new', function(e) {
        const notif = JSON.parse(e.data);
        broadcast({ type: 'notification:new', payload: notif });
    });

    eventSource.onerror = function() {
        broadcast({ type: 'connection:error' });
    };
}

function broadcast(message) {
    ports.forEach(port => port.postMessage(message));
}

self.onconnect = function(e) {
    const port = e.ports[0];
    ports.push(port);
    ensureConnection();

    port.onmessage = function(event) {
        if (event.data === 'close') {
            const idx = ports.indexOf(port);
            if (idx !== -1) ports.splice(idx, 1);
            if (ports.length === 0 && eventSource) {
                eventSource.close();
                eventSource = null;
            }
        }
    };

    port.start();
};