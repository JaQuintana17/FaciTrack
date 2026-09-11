/**
 * FaciTrack Email Service
 * Backend-ready with Nodemailer.
 * Currently logs emails to console (no real SMTP configured).
 * To go live: fill in SMTP_* values in .env.local and set EMAIL_ENABLED=true
 */

const nodemailer = require('nodemailer');
const { deepLink } = require('../utils/deepLink');

// ── Transport ──
// SMTP host, port and credentials stay in .env — they are deployment secrets
// and have no business in a database or rendered onto a settings form. The
// administrator controls only the on/off switch, checked in sendEmail().
function createTransport(enabled) {
    if (enabled && process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host:   process.env.SMTP_HOST,
            port:   parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }
    // Console-only transport (backend-ready placeholder)
    return null;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || 'FaciTrack <noreply@cspc.edu.ph>';

/**
 * Send an email. If no real transport is configured, logs to console.
 * @param {object} opts - { to, subject, html, text }
 */
async function sendEmail({ to, subject, html, text }) {
    // Switched off in System Settings behaves exactly like an install with no
    // SMTP configured: console mode, so nothing silently disappears.
    let enabled = process.env.EMAIL_ENABLED === 'true';
    try {
        enabled = await require('./app-settings').get('email_enabled');
    } catch (err) {
        console.error('[Email] Could not read the email setting, using .env:', err.message);
    }

    const transport = createTransport(enabled);
    if (transport) {
        try {
            const info = await transport.sendMail({ from: FROM_ADDRESS, to, subject, html, text });
            console.log(`[Email] Sent to ${to} | Subject: ${subject} | ID: ${info.messageId}`);
            return { success: true, messageId: info.messageId };
        } catch (err) {
            console.error(`[Email] Failed to send to ${to}:`, err.message);
            return { success: false, error: err.message };
        }
    } else {
        // Backend-ready: log the email content
        console.log(`\n[Email - CONSOLE MODE]`);
        console.log(`  To:      ${to}`);
        console.log(`  Subject: ${subject}`);
        console.log(`  Body:    ${text || '(html only)'}`);
        console.log(`[/Email]\n`);
        return { success: true, messageId: 'console-mode' };
    }
}

// ── Email Templates ──

/**
 * Booking confirmation email to student
 */
async function sendBookingConfirmation({ studentEmail, studentName, refNumber, facultyName, slot, date, topic }) {
    return sendEmail({
        to: studentEmail,
        subject: `FaciTrack – Booking Received (${refNumber})`,
        text: `Hi ${studentName},\n\nYour consultation request has been received.\n\nReference: ${refNumber}\nFaculty: ${facultyName}\nDate: ${date}\nTime: ${slot}\nTopic: ${topic}\n\nYou will be notified once the instructor responds.\n\n– FaciTrack, CSPC`,
        html: `<p>Hi <strong>${studentName}</strong>,</p>
               <p>Your consultation request has been received.</p>
               <table><tr><td><strong>Reference:</strong></td><td>${refNumber}</td></tr>
               <tr><td><strong>Faculty:</strong></td><td>${facultyName}</td></tr>
               <tr><td><strong>Date:</strong></td><td>${date}</td></tr>
               <tr><td><strong>Time:</strong></td><td>${slot}</td></tr>
               <tr><td><strong>Topic:</strong></td><td>${topic}</td></tr></table>
               <p>You will be notified once the instructor responds.</p>
               <p>– FaciTrack, CSPC</p>`
    });
}

/**
 * Appointment approved email to student
 */
async function sendApprovalNotification({ studentEmail, studentName, refNumber, facultyName, slot, date }) {
    return sendEmail({
        to: studentEmail,
        subject: `FaciTrack – Appointment Confirmed (${refNumber})`,
        text: `Hi ${studentName},\n\nYour consultation with ${facultyName} has been CONFIRMED.\n\nReference: ${refNumber}\nDate: ${date}\nTime: ${slot}\n\nPlease be on time.\n\n– FaciTrack, CSPC`,
        html: `<p>Hi <strong>${studentName}</strong>,</p>
               <p>Your consultation with <strong>${facultyName}</strong> has been <strong style="color:green">CONFIRMED</strong>.</p>
               <table><tr><td><strong>Reference:</strong></td><td>${refNumber}</td></tr>
               <tr><td><strong>Date:</strong></td><td>${date}</td></tr>
               <tr><td><strong>Time:</strong></td><td>${slot}</td></tr></table>
               <p>Please be on time.</p>
               <p>– FaciTrack, CSPC</p>`
    });
}

/**
 * Appointment declined email to student
 */
async function sendDeclineNotification({ studentEmail, studentName, refNumber, facultyName, reason }) {
    return sendEmail({
        to: studentEmail,
        subject: `FaciTrack – Appointment Declined (${refNumber})`,
        text: `Hi ${studentName},\n\nUnfortunately, your consultation request with ${facultyName} has been declined.\n\nReference: ${refNumber}\nReason: ${reason || 'No reason provided'}\n\nYou may book a new slot at your convenience.\n\n– FaciTrack, CSPC`,
        html: `<p>Hi <strong>${studentName}</strong>,</p>
               <p>Unfortunately, your consultation request with <strong>${facultyName}</strong> has been <strong style="color:red">declined</strong>.</p>
               <table><tr><td><strong>Reference:</strong></td><td>${refNumber}</td></tr>
               <tr><td><strong>Reason:</strong></td><td>${reason || 'No reason provided'}</td></tr></table>
               <p>You may book a new slot at your convenience.</p>
               <p>– FaciTrack, CSPC</p>`
    });
}

/**
 * Auto-reschedule notification email to student
 */
async function sendRescheduleNotification({ studentEmail, studentName, refNumber, facultyName, originalDate, originalSlot, newDate, newSlot }) {
    return sendEmail({
        to: studentEmail,
        subject: `FaciTrack – Appointment Rescheduled (${refNumber})`,
        text: `Hi ${studentName},\n\nYour consultation with ${facultyName} has been automatically rescheduled due to the instructor's unavailability.\n\nReference: ${refNumber}\nOriginal: ${originalDate} at ${originalSlot}\nNew Schedule: ${newDate} at ${newSlot}\n\nIf you have concerns, please contact the faculty directly.\n\n– FaciTrack, CSPC`,
        html: `<p>Hi <strong>${studentName}</strong>,</p>
               <p>Your consultation with <strong>${facultyName}</strong> has been <strong>automatically rescheduled</strong> due to the instructor's unavailability.</p>
               <table>
               <tr><td><strong>Reference:</strong></td><td>${refNumber}</td></tr>
               <tr><td><strong>Original:</strong></td><td>${originalDate} at ${originalSlot}</td></tr>
               <tr><td><strong>New Schedule:</strong></td><td><strong>${newDate} at ${newSlot}</strong></td></tr>
               </table>
               <p>If you have concerns, please contact the faculty directly.</p>
               <p>– FaciTrack, CSPC</p>`
    });
}

/**
 * Administrator login verification code
 */
async function sendOtpCode({ email, name, code, expiresInMinutes }) {
    return sendEmail({
        to: email,
        subject: 'FaciTrack – Your Administrator Verification Code',
        text: `Hi ${name},\n\nYour FaciTrack verification code is: ${code}\n\nIt expires in ${expiresInMinutes} minutes.\n\nIf you did not try to sign in, someone may have your password — change it immediately.\n\n– FaciTrack, CSPC`,
        html: `<p>Hi <strong>${name}</strong>,</p>
               <p>Your FaciTrack verification code is:</p>
               <p style="font-family:monospace;font-size:2rem;letter-spacing:0.5rem;color:#0a3d62;margin:1rem 0;"><strong>${code}</strong></p>
               <p>It expires in <strong>${expiresInMinutes} minutes</strong>.</p>
               <p style="color:#6b7280;font-size:0.875rem;">If you did not try to sign in, someone may have your password — change it immediately.</p>
               <p>– FaciTrack, CSPC</p>`
    });
}

// ── Appointment status update ──

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

// Emails also go out from the reminder cron, where there is no request to
// derive a host from — so unlike the calendar feed this cannot fall back to
// req.get('host'). A missing or stale value yields links that look correct and
// lead nowhere, so state the effective value once at startup.
if (process.env.APP_BASE_URL) {
    console.log(`[Email] Email links will point to ${BASE_URL}`);
} else {
    console.warn(`[Email] APP_BASE_URL is not set — email links will point to ${BASE_URL}. Set it in .env to the host users actually reach.`);
}

/**
 * Absolute link back into the app for this notification.
 * The path comes from the shared helper so email cannot drift from the bell
 * and push again — a make-up decision must not link to the appointments page.
 */
function appointmentLink(appointmentId, role, type) {
    const path = deepLink(appointmentId, role, type);
    return path ? `${BASE_URL.replace(/\/$/, '')}${path}` : null;
}

// Accent colour per status, so the email reads at a glance
const STATUS_ACCENT = {
    approved:    '#16a34a',
    confirmed:   '#16a34a',
    declined:    '#dc2626',
    cancelled:   '#dc2626',
    rescheduled: '#0369a1',
    completed:   '#0d9488',
    reminder:    '#0a3d62',
};

/**
 * Status-change email with a button back into the app.
 * `details` is a list of { label, value } rows shown above the button.
 */
async function sendStatusUpdate({ to, name, heading, status, message, details = [], appointmentId, role, type }) {
    const accent = STATUS_ACCENT[status] || '#0a3d62';
    const link = appointmentLink(appointmentId, role, type);
    // The button names the page it opens, so a make-up email cannot promise
    // an appointment. A role with nowhere to land simply gets no button.
    const linkLabel = type === 'makeup' ? 'View Make-Up Request' : 'View Appointment';

    const rows = details
        .filter(d => d && d.value)
        .map(d => `<tr>
             <td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;">${d.label}</td>
             <td style="padding:4px 0;color:#111827;font-size:14px;font-weight:600;">${d.value}</td>
           </tr>`)
        .join('');

    const text =
        `Hi ${name},\n\n${message}\n\n` +
        details.filter(d => d && d.value).map(d => `${d.label}: ${d.value}`).join('\n') +
        (link ? `\n\nView it here: ${link}` : '') +
        `\n\n– FaciTrack, CSPC`;

    const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;">
      <div style="border-left:4px solid ${accent};padding:0 0 0 16px;margin-bottom:20px;">
        <h2 style="margin:0 0 4px;font-size:19px;color:#111827;">${heading}</h2>
        <p style="margin:0;color:#6b7280;font-size:14px;">FaciTrack &middot; CSPC</p>
      </div>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 18px;">
        Hi <strong>${name}</strong>,<br>${message}
      </p>

      ${rows ? `<table style="border-collapse:collapse;margin:0 0 22px;">${rows}</table>` : ''}

      ${link ? `<a href="${link}"
         style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;
                padding:11px 22px;border-radius:8px;font-size:14px;font-weight:600;">
        ${linkLabel}
      </a>

      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:22px 0 0;">
        If the button does not work, copy this link into your browser:<br>
        <span style="color:#6b7280;word-break:break-all;">${link}</span>
      </p>` : ''}
    </div>`;

    return sendEmail({ to, subject: `FaciTrack – ${heading}`, text, html });
}

module.exports = {
    sendEmail,
    sendOtpCode,
    sendStatusUpdate,
    appointmentLink,
    sendBookingConfirmation,
    sendApprovalNotification,
    sendDeclineNotification,
    sendRescheduleNotification
};
