const pool = require('../configs/db');
const b = require('bcrypt');
const UserModel = require('../models/UserModel');
const DepartmentModel = require('../models/DepartmentModel');
const RoomModel = require('../models/RoomModel');
const AuditLogModel = require('../models/AuditLogModel');
const ConsultationRoomModel = require('../models/ConsultationRoomModel');
const appSettings = require('../services/app-settings');
const PresenceModel = require('../models/PresenceModel');
const { buildAdminUser } = require('../utils/sessionUser');

// The employment types the users table actually allows. Read once so the
// dashboard breakdown cannot drift from the column definition.
const EMPLOYMENT_TYPES = ['Permanent', 'Job Order', 'Co-Terminus', 'Casual', 'COS', 'Temporary'];

const AdminController = {

    // DASHBOARD

    async renderDashboard(req, res) {
        try {
            const admin = buildAdminUser(req.session);

            const [everyone, rooms, logs] = await Promise.all([
                UserModel.getUsersWithDepartment(),
                RoomModel.getRooms({
                    fields: `r.id, r.room_number, r.room_type, r.status,
                             r.is_ble_scanner_installed,
                             CONCAT(u.first_name, ' ', u.last_name) AS assigned_faculty_name`,
                }),
                AuditLogModel.getAll({ limit: 25 }),
            ]);

            // "Staff" is teaching and leadership — administrators are not faculty
            const staff = everyone
                .filter(u => u.role === 'Dean' || u.role === 'Instructor')
                .map(u => ({
                    name: [u.first_name, u.last_name].filter(Boolean).join(' '),
                    role: u.role,
                    employmentType: u.employment_type || 'Unspecified',
                    status: String(u.status || '').toLowerCase(),
                }));

            const roomData = (rooms || []).map(r => ({
                roomNumber: r.room_number,
                roomType: r.room_type,
                bleScanner: Boolean(r.is_ble_scanner_installed),
                assignedFaculty: r.assigned_faculty_name || 'Unassigned',
                status: String(r.status || '').toLowerCase(),
            }));

            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);

            const logRows = (logs || []).map(l => ({
                user: [l.first_name, l.last_name].filter(Boolean).join(' ') || l.role || 'System',
                action: l.action,
                type: l.type,
                timestamp: formatLogTime(l.created_at),
                isToday: new Date(l.created_at) >= startOfToday,
            }));

            const dean = everyone.find(u => u.role === 'Dean');

            res.render('pages/admin/dashboard', {
                title: 'FaciTrack - Admin Dashboard',
                admin,
                users: staff,
                roomData,
                logs: logRows,
                employmentTypes: EMPLOYMENT_TYPES,
                departmentName: admin.department || '—',
                deanName: dean ? `${dean.first_name} ${dean.last_name}` : '—',
            });
        } catch (err) {
            console.error('[AdminController.renderDashboard]', err);
            res.status(500).send('Failed to load the dashboard.');
        }
    },

    // SYSTEM SETTINGS

    async renderSettingsPage(req, res) {
        try {
            const admin = buildAdminUser(req.session);
            const settings = await appSettings.all();

            res.render('pages/admin/settings', {
                title: 'FaciTrack - System Settings',
                admin,
                settings,
                // Shown as read-only context — SMTP credentials stay in .env
                smtpConfigured: Boolean(process.env.SMTP_HOST),
                smtpHost: process.env.SMTP_HOST || null,
            });
        } catch (err) {
            console.error('[AdminController.renderSettingsPage]', err);
            res.status(500).send('Failed to load system settings.');
        }
    },

    async updateSettings(req, res) {
        try {
            const admin = await UserModel.getUserByPublicId(req.session.userId);
            const result = await appSettings.save(req.body, admin?.internal_id ?? null);

            if (!result.ok) {
                return res.status(422).json({ success: false, error: result.errors[0], errors: result.errors });
            }

            try {
                await AuditLogModel.log(admin.internal_id, admin.role,
                    `Updated system settings (${Object.keys(req.body).join(', ')})`, 'settings');
            } catch (err) {
                console.error('[AuditLog] Failed to log settings change:', err);
            }

            res.json({ success: true, settings: await appSettings.all() });
        } catch (err) {
            console.error('[AdminController.updateSettings]', err);
            res.status(500).json({ success: false, error: 'Failed to save settings.' });
        }
    },

    // BLE BEACONS

    /** Everything the BLE Devices page shows, shaped once for both callers. */
    async _beaconsPageData(admin) {
        const [beacons, scanners, awaiting, instructors, settings] = await Promise.all([
            PresenceModel.getBeacons(),
            PresenceModel.getScanners(),
            PresenceModel.getRoomsAwaitingScanner(),
            ConsultationRoomModel.getInstructors(admin.departmentId),
            appSettings.all(),
        ]);

        const scannerOfflineAfter = settings.presence_scanner_offline_after_sec ?? 60;
        const tagOfflineAfter = settings.presence_absent_after_sec ?? 120;

        // "Online" is decided here rather than in the view, so the tiles and
        // the tables can never disagree about what counts as alive.
        const scannerRows = scanners.map(s => ({
            ...s,
            online: s.secs_since_report !== null && s.secs_since_report <= scannerOfflineAfter,
        }));
        const beaconRows = beacons.map(b => ({
            ...b,
            online: b.secs_since_seen !== null && b.secs_since_seen <= tagOfflineAfter,
        }));

        return {
            beacons: beaconRows,
            scanners: scannerRows,
            roomsAwaitingScanner: awaiting,
            instructors,
            scannerConfigured: Boolean(process.env.PRESENCE_INGEST_KEY),
            rssiThreshold: settings.presence_rssi_threshold,
            scannerOfflineAfter,
            tagOfflineAfter,
            stats: {
                scannersOnline: scannerRows.filter(s => s.online).length,
                scannersTotal: scannerRows.length,
                tagsAssigned: beaconRows.filter(b => b.instructor_id).length,
                tagsOnline: beaconRows.filter(b => b.online).length,
                tagsTotal: beaconRows.length,
            },
        };
    },

    /** The same data as JSON, for the page to refresh itself on a nudge. */
    async getBeaconsJson(req, res) {
        try {
            const data = await AdminController._beaconsPageData(buildAdminUser(req.session));
            res.json({ success: true, ...data });
        } catch (err) {
            console.error('[AdminController.getBeaconsJson]', err);
            res.status(500).json({ success: false, error: 'Could not load BLE devices.' });
        }
    },

    /**
     * Scanner health and tag assignment. A tag appears here on its own the
     * first time a scanner hears it, so switching a new Minew E8 on is enough
     * to make it available to hand out.
     */
    async renderBeaconsPage(req, res) {
        try {
            const admin = buildAdminUser(req.session);
            const data = await AdminController._beaconsPageData(admin);

            res.render('pages/admin/beacons', {
                title: 'FaciTrack - BLE Devices',
                admin,
                ...data,
            });
        } catch (err) {
            console.error('[AdminController.renderBeaconsPage]', err);
            res.status(500).send('Failed to load the BLE devices page.');
        }
    },

    async assignBeacon(req, res) {
        try {
            const result = await PresenceModel.assignBeacon(
                Number(req.params.id),
                req.body.instructorId || null,
                req.body.label,
            );
            if (!result.ok) return res.status(422).json({ success: false, error: result.error });

            const admin = await UserModel.getUserByPublicId(req.session.userId);
            try {
                await AuditLogModel.log(admin.internal_id, admin.role,
                    req.body.instructorId ? 'Assigned a BLE tag' : 'Unassigned a BLE tag', 'presence');
            } catch (err) {
                console.error('[AuditLog] Failed to log tag assignment:', err);
            }
            res.json({ success: true });
        } catch (err) {
            console.error('[AdminController.assignBeacon]', err);
            res.status(500).json({ success: false, error: 'Could not save the tag.' });
        }
    },

    /**
     * Tune one room's presence threshold, or clear it to follow the
     * system-wide default again.
     */
    async setRoomThreshold(req, res) {
        try {
            const raw = req.body.threshold;
            let threshold = null;

            if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
                threshold = Number(raw);
                if (!Number.isInteger(threshold) || threshold < -100 || threshold > -30) {
                    return res.status(422).json({
                        success: false,
                        error: 'Threshold must be a whole number between -100 and -30 dBm.',
                    });
                }
            }

            const ok = await PresenceModel.setRoomThreshold(Number(req.params.id), threshold);
            if (!ok) return res.status(404).json({ success: false, error: 'Room not found.' });

            const admin = await UserModel.getUserByPublicId(req.session.userId);
            try {
                await AuditLogModel.log(admin.internal_id, admin.role,
                    threshold === null
                        ? 'Cleared a room presence threshold'
                        : `Set a room presence threshold to ${threshold} dBm`,
                    'presence');
            } catch (err) {
                console.error('[AuditLog] Failed to log threshold change:', err);
            }

            res.json({ success: true, threshold });
        } catch (err) {
            console.error('[AdminController.setRoomThreshold]', err);
            res.status(500).json({ success: false, error: 'Could not save the threshold.' });
        }
    },

    async setBeaconActive(req, res) {
        try {
            const ok = await PresenceModel.setBeaconActive(Number(req.params.id), req.body.active !== false);
            res.json({ success: ok, error: ok ? null : 'Tag not found.' });
        } catch (err) {
            console.error('[AdminController.setBeaconActive]', err);
            res.status(500).json({ success: false, error: 'Could not update the tag.' });
        }
    },

    async removeBeacon(req, res) {
        try {
            const ok = await PresenceModel.removeBeacon(Number(req.params.id));
            res.json({ success: ok, error: ok ? null : 'Tag not found.' });
        } catch (err) {
            console.error('[AdminController.removeBeacon]', err);
            res.status(500).json({ success: false, error: 'Could not remove the tag.' });
        }
    },

    // USERS
    async renderUsersPage(req, res) {
        const admin = buildAdminUser(req.session);

        const [users, departments, rooms] = await Promise.all([
            UserModel.getUsersWithDepartment(),
            DepartmentModel.getDepartments(),
            RoomModel.getRooms({
                fields: 'r.id, r.room_type, r.room_number'
            })
        ]);

        res.render('pages/admin/users', {
            title: 'FaciTrack - Faculty Management',
            admin: admin,
            users: users,
            rooms: rooms,
            departments: departments
        })
    },

    async createUser(req, res) {
        try {
            const { firstName, middleName, lastName, role,
                status, email, roomId, departmentId, password,
                employmentType, position, profilePicture } = req.body;

            const errors = {};

            if (!firstName?.trim()) errors.firstName = 'First Name is required.';
            if (!lastName?.trim()) errors.lastName = 'Last Name is required.';
            if (!role?.trim()) errors.role = 'Role is required.';
            if (!employmentType?.trim()) errors.employmentType = 'Employment Type is required.';
            if (!position?.trim()) errors.position = 'Position/Title is required.';
            if (!password.trim()) errors.password = 'Password is required.';
            if (!roomId) errors.baseRoom = 'Base Room is required.';
            else if (password.length < 8) errors.password = 'Password must be at least 8 characters.';

            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                errors.email = 'Invalid email format.';
            }

            if (Object.keys(errors).length > 0) {
                return res.status(422).json({ success: false, errors })
            }

            // hash the password
            const hashedPassword = await b.hash(password, 10);

            // insert new user with UserModel
            await UserModel.insertUserByAdmin({
                firstName,
                middleName,
                lastName,
                email,
                role,
                roomId,
                departmentId,
                status,
                employmentType,
                position,
                hashedPassword,
            });

            try {
                const user = await UserModel.getUserByPublicId(req.session.userId);
                await AuditLogModel.log(user.internal_id, user.role, 'Created user', 'users');
            } catch (logErr) {
                console.error('[AuditLog] Failed to log users:', logErr);
            }

            res.json({
                success: true,
                message: 'User created successfully!'
            })
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({
                    success: false,
                    errors: {
                        email: 'Email already exists.'
                    }
                });
            }
            console.error(`[UserController.createUser] ${err}`);
            res.status(500).json({
                success: false,
                error: 'Failed to create user.'
            });
        }
    },

    async updateUser(req, res) {
        try {
            const { publicId } = req.params;

            const {
                firstName, middleName, lastName, email,
                role, roomId, departmentId, status,
                employmentType, position } = req.body;

            const errors = {};
            if (!publicId) {
                errors.id = `User's identifier is missing.`;
            }
            if (!firstName?.trim()) {
                errors.firstName = 'First name is required.';
            }
            if (!lastName?.trim()) {
                errors.lastName = 'Last name is required.';
            }
            if (!email?.trim()) {
                errors.email = 'Email is required.';
            }
            if (!role?.trim()) {
                errors.role = 'Role is required.';
            }
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                errors.email = 'Invalid email format.';
            }
            if (role !== 'Student') {
                if (!employmentType?.trim()) {
                    errors.employmentType = 'Employment type is required.';
                }

                if (!position?.trim()) {
                    errors.position = 'Position/Title is required.';
                }

                if (!roomId) {
                    errors.baseRoom = 'Base Room is required.';
                }

                if (!departmentId) {
                    errors.department = 'Department is required.';
                }
            }

            if (Object.keys(errors).length > 0) {
                return res.status(422).json({
                    success: false,
                    errors
                });
            }

            await UserModel.updateUser(publicId, {
                firstName,
                middleName,
                lastName,
                email,
                role,
                roomId: role === 'Student' ? null : roomId,
                departmentId: role === 'Student' ? null : departmentId,
                status,
                employmentType: role === 'Student' ? null : employmentType,
                position: role === 'Student' ? null : position
            });

            try {
                const user = await UserModel.getUserByPublicId(req.session.userId);
                await AuditLogModel.log(
                    user.internal_id,
                    user.role,
                    'Updated user',
                    'users'
                );
            } catch (logErr) {
                console.error('[AuditLog] Failed to log users:', logErr);
            }
            res.json({
                success: true,
                message: `${firstName} ${lastName} updated successfully!`
            });
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({
                    success: false,
                    errors: {
                        email: 'Email already exists.'
                    }
                });
            }
            console.error('[AdminController.updateUser]', err);
            res.status(500).json({
                success: false,
                error: 'Failed to update user.'
            });
        }
    },

    async deleteUser(req, res) {
        try {
            const { publicId } = req.params;

            if (!publicId) errors.id = `User's identifier is missing.`;

            const affectedRows = await UserModel.deleteUser(publicId);

            if (affectedRows === 0) {
                return res.status(404).json({ success: false, error: 'User not found.' });
            }

            try {
                const user = await UserModel.getUserByPublicId(req.session.userId);
                await AuditLogModel.log(user.internal_id, user.role, 'Deleted user', 'users');
            } catch (logErr) {
                console.error('[AuditLog] Failed to log users:', logErr);
            }

            res.json({ success: true, message: `User deleted successfully!` });

        } catch (err) {
            console.error('[AdminController.deleteUser]', err);
            res.status(500).json({ success: false, error: 'Failed to delete user.' });
        }
    },

    // ROOMS 
    async renderRoomsPage(req, res) {
        const admin = buildAdminUser(req.session);

        const [departments, rooms] = await Promise.all([
            DepartmentModel.getDepartments(),
            RoomModel.getRooms({
                fields: `r.id, 
                        r.room_number, 
                        r.room_type, 
                        r.department_id,
                        r.capacity,
                        d.full_name AS department_name, 
                        d.building AS building_name, 
                        CONCAT(u.last_name + ', ' + u.first_name) AS assigned_faculty_name, 
                        r.is_ble_scanner_installed, 
                        r.status`
            })
        ]);

        res.render('pages/admin/rooms', {
            title: 'FaciTrack - Rooms Management',
            admin: admin,
            departments: departments,
            roomData: rooms
        });
    },

    async createRoom(req, res) {
        try {
            const { roomNumber, department, roomType, bleStatus, assignedFaculty, status, capacity } = req.body;

            const errors = {};

            if (!roomNumber) errors.roomNumber = 'Room Number is required.';
            if (!department) errors.department = 'Department is required.';
            if (!roomType) errors.roomType = 'Room Type is required.';
            if (bleStatus == null || bleStatus === '') errors.bleStatus = 'BLE Scanner status is required.';
            if (!status) errors.status = 'Status is required.';

            // return early if at least one error is present
            if (Object.keys(errors).length > 0) {
                return res.status(422).json({ success: false, errors })
            }

            // await for the room model to finish inserting new room
            await RoomModel.insertRoomByAdmin({
                roomNumber,
                department,
                roomType,
                bleStatus,
                assignedFaculty,
                status,
                capacity
            });

            try {
                const user = await UserModel.getUserByPublicId(req.session.userId);
                await AuditLogModel.log(user.internal_id, user.role, 'Created room', 'rooms');
            } catch (logErr) {
                console.error('[AuditLog] Failed to log room:', logErr);
            }

            return res.status(200).json({
                success: true,
                message: 'Room created successfully!'
            })
        } catch (err) {
            console.error(`[AdminController.createRoom] ${err}`);
            res.status(500).json({
                success: false,
                error: 'Failed to create room.'
            });
        }
    },

    async updateRoom(req, res) {
        try {
            const { roomId } = req.params;
            const { roomNumber, department, roomType, bleStatus, assignedFaculty, status, capacity } = req.body;

            const errors = {};

            if (!roomNumber) errors.roomNumber = 'Room Number is required.';
            if (!department) errors.department = 'Department is required.';
            if (!roomType) errors.roomType = 'Room Type is required.';
            if (!status) errors.status = 'Status is required.';

            // return early if at least one error is present
            if (Object.keys(errors).length > 0) {
                return res.status(422).json({ success: false, errors })
            }

            // await for the room model to finish updating new room
            await RoomModel.updateRoom(roomId, {
                roomNumber,
                department,
                roomType,
                bleStatus,
                assignedFaculty: assignedFaculty || null,
                status,
                capacity
            });

            try {
                const user = await UserModel.getUserByPublicId(req.session.userId);
                await AuditLogModel.log(user.internal_id, user.role, 'Updated room', 'rooms');
            } catch (logErr) {
                console.error('[AuditLog] Failed to log room:', logErr);
            }

            return res.status(200).json({
                success: true,
                message: 'Room updated successfully!'
            })
        } catch (err) {
            console.error(`[AdminController.updateRoom] ${err}`);
            res.status(500).json({
                success: false,
                error: 'Failed to update room.'
            });
        }
    },

    async deleteRoom(req, res) {
        try {
            const { roomId } = req.params;

            if (!roomId) errors.id = `Room's identifier is missing.`;

            const affectedRows = await RoomModel.deleteRoom(roomId);

            if (affectedRows === 0) {
                return res.status(404).json({ success: false, error: 'Room not found.' });
            }

            try {
                const user = await UserModel.getUserByPublicId(req.session.userId);
                await AuditLogModel.log(user.internal_id, user.role, 'Deleted room', 'rooms');
            } catch (logErr) {
                console.error('[AuditLog] Failed to log room:', logErr);
            }

            res.json({ success: true, message: `Room deleted successfully!` });

        } catch (err) {
            console.error('[AdminController.deleteRoom]', err);
            res.status(500).json({ success: false, error: 'Failed to delete room.' });
        }
    },

    async renderReportsPage(req, res) {
        try {
            const admin = buildAdminUser(req.session);

            const auditLogs = await AuditLogModel.getAll();

            res.render('pages/admin/reports', {
                title: 'FaciTrack - Reports',
                admin,
                logs: auditLogs,
            });
        } catch (err) {
            console.error('[AdminController.renderReportsPage]', err);
            res.status(500).send('Failed to load reports page.');
        }
    },

    // CONSULTATION ROOM

    /**
     * A week of consultations in the administrator's own department. The grid
     * itself is filled by /admin/consultation-room/slots so a date change does
     * not reload the page.
     */
    async renderConsultationRoomPage(req, res) {
        try {
            const admin = buildAdminUser(req.session);
            const { start, end } = weekAround(req.query.date);
            const instructors = await ConsultationRoomModel.getInstructors(admin.departmentId);

            res.render('pages/admin/consultation-room', {
                title: 'FaciTrack - Consultation Room',
                admin,
                instructors,
                startDate: start,
                endDate: end,
            });
        } catch (err) {
            console.error('[AdminController.renderConsultationRoomPage]', err);
            res.status(500).send('Failed to load the consultation room page.');
        }
    },

    async getConsultationSlots(req, res) {
        try {
            const { start, end } = weekAround(req.query.start);
            const startDate = isDate(req.query.start) ? req.query.start : start;
            const endDate = isDate(req.query.end) ? req.query.end : end;

            const slots = await ConsultationRoomModel.getSlots(startDate, endDate, {
                instructorId: req.query.instructor || null,
                // Taken from the session, never the query string — this is a
                // scope the caller must not be able to widen.
                departmentId: req.session.departmentId || null,
            });

            res.json({ success: true, startDate, endDate, slots });
        } catch (err) {
            console.error('[AdminController.getConsultationSlots]', err);
            res.status(500).json({ success: false, error: 'Failed to load consultations.' });
        }
    },
}

/** "14 Mar, 2:05 PM" — short enough for a dashboard row. */
function formatLogTime(value) {
    const d = new Date(value);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-PH', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    });
}

function isDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Monday-to-Sunday week containing `date`, as YYYY-MM-DD strings. */
function weekAround(date) {
    // Parsed as UTC so the week boundary does not shift with the server's zone.
    const base = isDate(date) ? new Date(`${date}T00:00:00Z`) : new Date();
    const day = (base.getUTCDay() + 6) % 7;          // Monday = 0

    const monday = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - day));
    const sunday = new Date(monday.getTime() + 6 * 86400000);

    return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

module.exports = AdminController;