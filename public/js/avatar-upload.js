/**
 * Profile photo upload and removal.
 *
 * One implementation for every role. The same avatar control sits in the
 * sidebars and on the instructor and dean settings pages; keeping a copy per
 * page is how it ended up with three different localStorage keys, no server
 * persistence, and a photo only its owner could ever see.
 *
 * Each avatar host carries data-initials, so a host currently showing a photo
 * still knows what to fall back to when that photo is removed.
 *
 * Usage:
 *   AvatarUpload.init({
 *       input:   'settingsAvatarInput',               // <input type="file"> id
 *       remove:  'settingsAvatarRemove',              // optional remove button id
 *       targets: ['settingsAvatar', 'sidebarAvatar'], // hosts to repaint
 *       notify:  showToast                            // optional (kind, title, message)
 *   });
 */
window.AvatarUpload = (function () {

    function hosts(targets) {
        return targets
            .map(function (id) { return document.getElementById(id); })
            .filter(Boolean);
    }

    function paintOne(host, url) {
        var initials = host.querySelector('.avatar-initials');
        var existing = host.querySelector('.avatar-img');
        if (initials) initials.remove();
        if (existing) existing.remove();
        var img = document.createElement('img');
        img.src = url;
        img.alt = 'Profile photo';
        img.className = 'avatar-img';
        // Before the overlay, so the "change photo" button stays on top.
        host.insertBefore(img, host.querySelector('.avatar-upload-overlay') || null);
    }

    function initialsOne(host, text) {
        var img = host.querySelector('.avatar-img');
        if (img) img.remove();
        var existing = host.querySelector('.avatar-initials');
        if (existing) return;
        var span = document.createElement('span');
        span.className = 'avatar-initials';
        span.textContent = text != null ? text : (host.getAttribute('data-initials') || '');
        host.insertBefore(span, host.querySelector('.avatar-upload-overlay') || null);
    }

    function paint(targets, url) {
        hosts(targets).forEach(function (host) { paintOne(host, url); });
    }

    function showInitials(targets) {
        hosts(targets).forEach(function (host) { initialsOne(host, null); });
    }

    /**
     * What each host shows right now, so a failed request can put it back.
     * Recorded as the image src or the initials text rather than as innerHTML:
     * the file input lives inside the host, and replacing the markup wholesale
     * would hand back a fresh input with no change listener on it.
     */
    function capture(targets) {
        return hosts(targets).map(function (host) {
            var img = host.querySelector('.avatar-img');
            var initials = host.querySelector('.avatar-initials');
            return {
                host: host,
                src: img ? img.getAttribute('src') : null,
                initials: initials ? initials.textContent : null
            };
        });
    }

    function restore(snapshot) {
        snapshot.forEach(function (entry) {
            if (entry.src) paintOne(entry.host, entry.src);
            else initialsOne(entry.host, entry.initials);
        });
    }

    function init(options) {
        var input = document.getElementById(options.input);
        var removeBtn = options.remove ? document.getElementById(options.remove) : null;
        if (!input && !removeBtn) return;

        var targets = options.targets || [];
        var notify = typeof options.notify === 'function' ? options.notify : function () {};

        function setRemoveVisible(visible) {
            if (removeBtn) removeBtn.style.display = visible ? '' : 'none';
        }

        if (input) input.addEventListener('change', function () {
            var file = this.files[0];
            // Clear it so picking the same file twice still fires a change.
            this.value = '';
            if (!file) return;
            if (!file.type || file.type.indexOf('image/') !== 0) {
                return notify('error', 'Not an image', 'Choose a JPG, PNG or WebP file.');
            }

            var previous = capture(targets);

            // Show the local file straight away; the request only confirms it.
            var preview = URL.createObjectURL(file);
            paint(targets, preview);

            var body = new FormData();
            body.append('avatar', file);

            fetch('/profile/avatar', { method: 'POST', body: body, credentials: 'same-origin' })
                .then(readJson)
                .then(function (result) {
                    if (!result.ok) throw new Error(result.data.message || 'Upload failed.');
                    // Repaint from the stored URL, so what is on screen is the
                    // same image every other page will load.
                    paint(targets, result.data.url);
                    setRemoveVisible(true);
                    notify('success', 'Photo updated', 'Your profile photo has been saved.');
                })
                .catch(function (err) {
                    // Never leave a preview standing in for a photo that was
                    // not saved — it would look persisted until the next reload.
                    restore(previous);
                    notify('error', 'Upload failed', err.message);
                })
                .then(function () { URL.revokeObjectURL(preview); });
        });

        if (removeBtn) removeBtn.addEventListener('click', function () {
            // The file is deleted from disk, so this is not undoable without
            // uploading again — worth one question.
            if (!confirm('Remove your profile photo? Your initials will be shown instead.')) return;

            var previous = capture(targets);
            removeBtn.disabled = true;

            fetch('/profile/avatar', { method: 'DELETE', credentials: 'same-origin' })
                .then(readJson)
                .then(function (result) {
                    if (!result.ok) throw new Error(result.data.message || 'Could not remove the photo.');
                    showInitials(targets);
                    setRemoveVisible(false);
                    notify('success', 'Photo removed', 'Your initials are shown instead.');
                })
                .catch(function (err) {
                    restore(previous);
                    notify('error', 'Remove failed', err.message);
                })
                .then(function () { removeBtn.disabled = false; });
        });
    }

    /** Response body alongside the status, tolerating an empty or non-JSON body. */
    function readJson(res) {
        return res.json()
            .catch(function () { return {}; })
            .then(function (data) { return { ok: res.ok, data: data }; });
    }

    return { init: init, paint: paint, showInitials: showInitials };
}());
