/**
 * One-off helper: generates the VAPID key pair Web Push needs.
 *
 *   node scripts/generate-vapid-keys.js
 *
 * Paste the output into .env. Generate ONCE and keep the same pair — changing
 * the keys invalidates every existing subscription and users must re-enable
 * notifications on each device.
 */
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('\nAdd these to your .env file:\n');
console.log('VAPID_PUBLIC_KEY=' + publicKey);
console.log('VAPID_PRIVATE_KEY=' + privateKey);
console.log('VAPID_SUBJECT=mailto:your-email@cspc.edu.ph\n');
console.log('Keep VAPID_PRIVATE_KEY secret — never commit it.\n');
