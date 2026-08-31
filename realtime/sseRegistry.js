
const clients = new Map(); // userId (internal numeric id) -> Set of res objects

function addClient(userId, res) {
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(res);
}

function removeClient(userId, res) {
    const set = clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) clients.delete(userId);
}

function pushToUser(userId, eventName, payload) {
    const set = clients.get(userId);
    if (!set) return;
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) {
        res.write(data);
    }
}

/**
 * Send to every connected client, whoever they are.
 *
 * Presence is the case for this: when someone walks into a room, every open
 * dean board and availability page wants to know, not one particular user.
 */
function broadcast(eventName, payload) {
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const set of clients.values()) {
        for (const res of set) res.write(data);
    }
}

module.exports = { addClient, removeClient, pushToUser, broadcast };