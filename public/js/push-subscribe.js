/**
 * FaciTrack device notifications (Web Push).
 *
 * Exposes window.FaciTrackPush so any page can render its own toggle:
 *   FaciTrackPush.isSupported()  → browser can do push at all
 *   FaciTrackPush.getState()     → 'unsupported' | 'denied' | 'on' | 'off'
 *   FaciTrackPush.enable()       → asks permission, subscribes, saves to server
 *   FaciTrackPush.disable()      → unsubscribes and removes it server-side
 */
window.FaciTrackPush = (function () {

    function isSupported() {
        return 'serviceWorker' in navigator &&
               'PushManager' in window &&
               'Notification' in window;
    }

    /** VAPID keys travel as base64url but PushManager wants a Uint8Array. */
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
    }

    async function getSubscription() {
        if (!isSupported()) return null;
        const reg = await navigator.serviceWorker.ready;
        return reg.pushManager.getSubscription();
    }

    async function getState() {
        if (!isSupported()) return 'unsupported';
        if (Notification.permission === 'denied') return 'denied';
        const sub = await getSubscription();
        return sub ? 'on' : 'off';
    }

    async function enable() {
        if (!isSupported()) {
            return { ok: false, error: 'This browser does not support notifications.' };
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            return { ok: false, error: 'Notifications were blocked. Enable them in your browser settings.' };
        }

        // The server owns the VAPID public key — never hardcode it here
        const keyRes = await fetch('/notifications/push/public-key');
        const keyData = await keyRes.json();
        if (!keyData.publicKey) {
            return { ok: false, error: 'Push notifications are not configured on the server yet.' };
        }

        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();

        if (!sub) {
            sub = await reg.pushManager.subscribe({
                // Required by browsers: every push must show a visible notification
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
            });
        }

        const res = await fetch('/notifications/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub),
        });
        const data = await res.json();
        if (!data.success) return { ok: false, error: data.error || 'Could not save the subscription.' };

        return { ok: true };
    }

    async function disable() {
        const sub = await getSubscription();
        if (!sub) return { ok: true };

        try {
            await fetch('/notifications/push/subscribe', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: sub.endpoint }),
            });
        } catch (_) { /* still unsubscribe locally below */ }

        await sub.unsubscribe();
        return { ok: true };
    }

    return { isSupported, getState, enable, disable };
})();
