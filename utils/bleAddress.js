/**
 * What kind of BLE address is this?
 *
 * The top two bits of the first octet say whether an address is fixed or one
 * a device is rotating for privacy. That distinction is the whole reason this
 * file exists: 111 of the 164 rows this system had collected were phones
 * re-randomising as people walked past, and no amount of pruning wins against
 * addresses that change every fifteen minutes.
 *
 * An asset tag broadcasts a static address. Anything rotating is somebody's
 * phone or headphones, and assigning an instructor to it would bind them to an
 * identity that ceases to exist within the hour.
 */

const TYPES = {
    'static-random': {
        label: 'Static',
        assignable: true,
        note: 'Fixed address — what an asset tag broadcasts.',
    },
    'resolvable-private': {
        label: 'Rotating',
        assignable: false,
        note: 'A phone or wearable. This address changes every few minutes.',
    },
    'non-resolvable-private': {
        label: 'Rotating',
        assignable: false,
        note: 'A privacy address. It will not be the same tomorrow.',
    },
    public: {
        label: 'Public',
        assignable: true,
        note: 'A manufacturer-assigned address. Fixed.',
    },
};

/**
 * @param {string} mac  "c3:00:00:70:11:a3"
 * @returns {'static-random'|'resolvable-private'|'non-resolvable-private'|'public'|'unknown'}
 */
function addressType(mac) {
    if (typeof mac !== 'string') return 'unknown';
    const first = parseInt(mac.slice(0, 2), 16);
    if (!Number.isFinite(first)) return 'unknown';

    switch (first >> 6) {
        case 0b11: return 'static-random';
        case 0b01: return 'resolvable-private';
        case 0b00: return 'non-resolvable-private';
        // A public address has the same top bits as a non-resolvable private
        // one, so the two cannot be told apart from the address alone. BLE
        // carries the distinction beside the address, not inside it, and the
        // scanners do not forward it — so this branch is unreachable and the
        // two collapse into "rotating". Calling a fixed address rotating costs
        // a manual override; the opposite costs a tag that stops working.
        default: return 'public';
    }
}

/** Address type plus how it should be presented, for the discovery list. */
function describeAddress(mac) {
    const type = addressType(mac);
    const meta = TYPES[type] || { label: 'Unknown', assignable: false, note: 'Unrecognised address.' };
    return { type, ...meta };
}

/** Is this address stable enough to bind a person to? */
function isAssignable(mac) {
    return describeAddress(mac).assignable;
}

module.exports = { addressType, describeAddress, isAssignable, TYPES };
