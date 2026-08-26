const express = require('express');
const router = express.Router();
const { authenticateUser, createSession, getRoleRedirect, revokeSession } = require('../services/auth');
const { requireRole, setSessionCookie, clearSessionCookie } = require('../middleware/auth');

// Import shared stores from instructor router
const instructorRouter = require('./instructor');
const MakeupController = require('../controllers/MakeupController');
const MakeupRequestModel = require('../models/MakeupRequestModel');
const NotificationModel = require('../models/NotificationModel');

// Router-level middleware: log all dean route requests
router.use((req, res, next) => {
    console.log(`[Dean Router] ${req.method} ${req.originalUrl}`);
    next();
});

// Shared simulated data
function getSharedData() {
    const dean = {
        name: 'Dr. Lourdes Reyes',
        email: 'dean@cspc.edu.ph',
        position: 'Dean',
        department: 'College of Computer Studies'
    };

    const faculty = [
        {
            id: 1,
            name: 'Dr. Maria Santos',
            position: 'Professor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 201',
            bleStatus: 'in-room',
            bleLastDetected: '2 minutes ago',
            hoursThisMonth: 48,
            consultationsThisMonth: 32,
            avgDuration: '42 min'
        },
        {
            id: 2,
            name: 'Prof. Jose Dela Cruz',
            position: 'Associate Professor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 105',
            bleStatus: 'out-of-room',
            bleLastDetected: '1 hour ago',
            hoursThisMonth: 36,
            consultationsThisMonth: 24,
            avgDuration: '38 min'
        },
        {
            id: 3,
            name: 'Dr. Ana Villanueva',
            position: 'Assistant Professor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 203',
            bleStatus: 'in-room',
            bleLastDetected: '5 minutes ago',
            hoursThisMonth: 42,
            consultationsThisMonth: 28,
            avgDuration: '45 min'
        },
        {
            id: 4,
            name: 'Prof. Carlos Bautista',
            position: 'Instructor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 102',
            bleStatus: 'out-of-room',
            bleLastDetected: '3 hours ago',
            hoursThisMonth: 30,
            consultationsThisMonth: 18,
            avgDuration: '35 min'
        },
        {
            id: 5,
            name: 'Dr. Ramon Aquino',
            position: 'Associate Professor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 204',
            bleStatus: 'in-room',
            bleLastDetected: '10 minutes ago',
            hoursThisMonth: 40,
            consultationsThisMonth: 22,
            avgDuration: '40 min'
        },
        {
            id: 6,
            name: 'Prof. Liza Navarro',
            position: 'Instructor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 106',
            bleStatus: 'in-room',
            bleLastDetected: '8 minutes ago',
            hoursThisMonth: 28,
            consultationsThisMonth: 15,
            avgDuration: '33 min'
        },
        {
            id: 7,
            name: 'Dr. Eduardo Flores',
            position: 'Professor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 202',
            bleStatus: 'in-room',
            bleLastDetected: '3 minutes ago',
            hoursThisMonth: 44,
            consultationsThisMonth: 30,
            avgDuration: '44 min'
        },
        {
            id: 8,
            name: 'Prof. Grace Mendoza',
            position: 'Assistant Professor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 107',
            bleStatus: 'out-of-room',
            bleLastDetected: '2 hours ago',
            hoursThisMonth: 32,
            consultationsThisMonth: 20,
            avgDuration: '36 min'
        },
        {
            id: 9,
            name: 'Dr. Benjamin Reyes',
            position: 'Associate Professor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 205',
            bleStatus: 'in-room',
            bleLastDetected: '15 minutes ago',
            hoursThisMonth: 38,
            consultationsThisMonth: 25,
            avgDuration: '39 min'
        },
        {
            id: 10,
            name: 'Prof. Maricel Castro',
            position: 'Instructor',
            department: 'College of Computer Studies',
            officeRoom: 'CCS Building, Room 103',
            bleStatus: 'out-of-room',
            bleLastDetected: '4 hours ago',
            hoursThisMonth: 26,
            consultationsThisMonth: 14,
            avgDuration: '32 min'
        }
    ];

    // Generate dates relative to today so period filters (This Week / This Month) work
    function relDate(offsetDays) {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return d.toISOString().split('T')[0]; // YYYY-MM-DD for reliable Date parsing
    }
    const allAppointments = [
        { id: 1,  studentName: 'Juan Dela Cruz',    studentId: '2021-00123', instructorName: 'Dr. Maria Santos',     date: relDate(0),  time: '2:00 PM',  duration: '30 minutes', topic: 'Thesis consultation regarding system architecture', status: 'pending',   isToday: true  },
        { id: 2,  studentName: 'Ana Reyes',          studentId: '2021-00456', instructorName: 'Dr. Maria Santos',     date: relDate(1),  time: '10:00 AM', duration: '30 minutes', topic: 'Grade inquiry for Midterm exam',                    status: 'pending',   isToday: false },
        { id: 3,  studentName: 'Carlos Mendoza',     studentId: '2021-00789', instructorName: 'Dr. Maria Santos',     date: relDate(0),  time: '3:30 PM',  duration: '45 minutes', topic: 'Project proposal review',                           status: 'confirmed', isToday: true  },
        { id: 4,  studentName: 'Maria Garcia',       studentId: '2021-00321', instructorName: 'Prof. Jose Dela Cruz', date: relDate(-2), time: '1:00 PM',  duration: '30 minutes', topic: 'Academic advising',                                 status: 'declined',  isToday: false },
        { id: 5,  studentName: 'Pedro Lim',          studentId: '2022-00111', instructorName: 'Dr. Ana Villanueva',   date: relDate(0),  time: '9:00 AM',  duration: '30 minutes', topic: 'Research methodology guidance',                     status: 'confirmed', isToday: true  },
        { id: 6,  studentName: 'Rosa Fernandez',     studentId: '2022-00222', instructorName: 'Prof. Carlos Bautista',date: relDate(1),  time: '11:00 AM', duration: '45 minutes', topic: 'Capstone project feedback',                         status: 'pending',   isToday: false },
        { id: 7,  studentName: 'Luis Torres',        studentId: '2021-00555', instructorName: 'Dr. Ana Villanueva',   date: relDate(-1), time: '2:00 PM',  duration: '30 minutes', topic: 'Grade reconsideration request',                     status: 'confirmed', isToday: false },
        { id: 8,  studentName: 'Kristine Uy',        studentId: '2022-00333', instructorName: 'Dr. Ramon Aquino',     date: relDate(0),  time: '1:00 PM',  duration: '30 minutes', topic: 'AI project consultation',                           status: 'confirmed', isToday: true  },
        { id: 9,  studentName: 'Mark Villanueva',    studentId: '2022-00444', instructorName: 'Prof. Liza Navarro',   date: relDate(2),  time: '2:00 PM',  duration: '45 minutes', topic: 'Web app debugging session',                         status: 'pending',   isToday: false },
        { id: 10, studentName: 'Sheila Ramos',       studentId: '2021-00666', instructorName: 'Dr. Eduardo Flores',   date: relDate(0),  time: '3:00 PM',  duration: '30 minutes', topic: 'Network security thesis review',                    status: 'confirmed', isToday: true  },
        { id: 11, studentName: 'Jerome Pascual',     studentId: '2022-00555', instructorName: 'Prof. Grace Mendoza',  date: relDate(3),  time: '10:00 AM', duration: '30 minutes', topic: 'Mobile app UI feedback',                            status: 'pending',   isToday: false },
        { id: 12, studentName: 'Diane Soriano',      studentId: '2021-00777', instructorName: 'Dr. Benjamin Reyes',   date: relDate(0),  time: '11:00 AM', duration: '45 minutes', topic: 'Data science capstone guidance',                    status: 'confirmed', isToday: true  },
        { id: 13, studentName: 'Ryan Ocampo',        studentId: '2022-00666', instructorName: 'Prof. Maricel Castro', date: relDate(1),  time: '1:00 PM',  duration: '30 minutes', topic: 'System design review',                              status: 'pending',   isToday: false }
    ];

    const presenceLogs = [
        { facultyName: 'Dr. Maria Santos', timestamp: '2026-03-17 09:15 AM', status: 'entered', location: 'CCS Building, Room 201', duration: null },
        { facultyName: 'Dr. Maria Santos', timestamp: '2026-03-17 11:30 AM', status: 'exited', location: 'CCS Building, Room 201', duration: '2h 15m' },
        { facultyName: 'Dr. Ana Villanueva', timestamp: '2026-03-17 08:45 AM', status: 'entered', location: 'CCS Building, Room 203', duration: null },
        { facultyName: 'Prof. Jose Dela Cruz', timestamp: '2026-03-17 09:00 AM', status: 'entered', location: 'CCS Building, Room 105', duration: null },
        { facultyName: 'Prof. Jose Dela Cruz', timestamp: '2026-03-17 10:00 AM', status: 'exited', location: 'CCS Building, Room 105', duration: '1h 0m' },
        { facultyName: 'Dr. Maria Santos', timestamp: '2026-03-17 01:00 PM', status: 'entered', location: 'CCS Building, Room 201', duration: null },
        { facultyName: 'Prof. Carlos Bautista', timestamp: '2026-03-17 07:30 AM', status: 'entered', location: 'CCS Building, Room 102', duration: null },
        { facultyName: 'Prof. Carlos Bautista', timestamp: '2026-03-17 10:30 AM', status: 'exited', location: 'CCS Building, Room 102', duration: '3h 0m' },
        { facultyName: 'Dr. Ramon Aquino', timestamp: '2026-03-17 08:00 AM', status: 'entered', location: 'CCS Building, Room 204', duration: null },
        { facultyName: 'Dr. Ramon Aquino', timestamp: '2026-03-17 11:00 AM', status: 'exited', location: 'CCS Building, Room 204', duration: '3h 0m' },
        { facultyName: 'Prof. Liza Navarro', timestamp: '2026-03-17 09:30 AM', status: 'entered', location: 'CCS Building, Room 106', duration: null },
        { facultyName: 'Dr. Eduardo Flores', timestamp: '2026-03-17 08:30 AM', status: 'entered', location: 'CCS Building, Room 202', duration: null },
        { facultyName: 'Prof. Grace Mendoza', timestamp: '2026-03-17 07:45 AM', status: 'entered', location: 'CCS Building, Room 107', duration: null },
        { facultyName: 'Prof. Grace Mendoza', timestamp: '2026-03-17 09:45 AM', status: 'exited', location: 'CCS Building, Room 107', duration: '2h 0m' },
        { facultyName: 'Dr. Benjamin Reyes', timestamp: '2026-03-17 10:00 AM', status: 'entered', location: 'CCS Building, Room 205', duration: null },
        { facultyName: 'Prof. Maricel Castro', timestamp: '2026-03-17 07:00 AM', status: 'entered', location: 'CCS Building, Room 103', duration: null },
        { facultyName: 'Prof. Maricel Castro', timestamp: '2026-03-17 11:00 AM', status: 'exited', location: 'CCS Building, Room 103', duration: '4h 0m' }
    ];

    const recentActivity = presenceLogs.slice(0, 6);

    return { dean, faculty, allAppointments, presenceLogs, recentActivity };
}

/**
 * The bits of chrome every dean page needs from the database: the bell and
 * the sidebar's pending badge. Spread this into the render locals.
 */
async function deanChrome(deanPublicId) {
    const [notifications, pendingMakeupCount] = await Promise.all([
        NotificationModel.getForUser(deanPublicId).catch(() => []),
        getPendingMakeupCount(deanPublicId),
    ]);
    return { notifications, pendingMakeupCount };
}

// Sidebar badge — the real queue, scoped to this dean's department
async function getPendingMakeupCount(deanPublicId) {
    try {
        const requests = await MakeupRequestModel.getByDepartment(deanPublicId);
        return requests.filter(r => r.status === 'pending').length;
    } catch (err) {
        console.error('[Dean] Could not count pending make-ups:', err.message);
        return 0;
    }
}

// Dean Dashboard
router.get('/dashboard', async (req, res) => {
    const data = getSharedData();
    res.render('pages/dean/dashboard', {
        title: 'FaciTrack - Dean Dashboard',
        ...data,
        ...(await deanChrome(req.session.userId))
    });
});

// Faculty list with real-time BLE status
// Supports query parameters: ?bleStatus=in-room|out-of-room
router.get('/faculty', async (req, res) => {
    const data = getSharedData();
    const { bleStatus } = req.query;

    let filteredFaculty = data.faculty;
    if (bleStatus) {
        filteredFaculty = filteredFaculty.filter(f => f.bleStatus === bleStatus);
    }

    res.render('pages/dean/faculty', {
        title: 'FaciTrack - Faculty',
        ...data,
        faculty: filteredFaculty,
        filterBleStatus: bleStatus || '',
        ...(await deanChrome(req.session.userId))
    });
});

// Add instructor (POST) — prototype: returns success JSON
router.post('/faculty', (req, res) => {
    const { name, position, officeRoom } = req.body;
    if (!name || !position || !officeRoom) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    // In a real app this would persist to DB; prototype just acknowledges
    res.json({ success: true, message: `${name} added to faculty list.` });
});

// Delete instructor (POST with _method override or direct DELETE)
router.post('/faculty/:id/delete', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid ID.' });
    // In a real app this would remove from DB; prototype just acknowledges
    res.json({ success: true, message: `Instructor #${id} removed.` });
});

// Monitoring — redirects to Faculty (merged page)
router.get('/monitoring', (_req, res) => {
    res.redirect('/dean/faculty');
});

// Workload reports per faculty
router.get('/reports', async (req, res) => {
    const data = getSharedData();
    res.render('pages/dean/reports', {
        title: 'FaciTrack - Reports',
        ...data,
        ...(await deanChrome(req.session.userId))
    });
});

// Presence Logs
router.get('/presence', async (req, res) => {
    const data = getSharedData();
    res.render('pages/dean/presence', {
        title: 'FaciTrack - Presence Logs',
        ...data,
        ...(await deanChrome(req.session.userId))
    });
});

// Settings
router.get('/settings', async (req, res) => {
    const data = getSharedData();
    res.render('pages/dean/settings', {
        title: 'FaciTrack - Settings',
        ...data,
        ...(await deanChrome(req.session.userId))
    });
});

// ── Make-Up Class Request routes (Dean) ──

// GET: Dean's review queue
// ── Make-Up Class Requests ──
// The dean only ever sees their own department; the controller enforces it.
router.get('/makeup/requests',          MakeupController.renderDeanQueue);
router.get('/makeup/document/:docId',   MakeupController.downloadDocument);

// Clearing the whole queue re-validates every request on the way through
router.post('/makeup/approve-all',      MakeupController.approveAll);

// Two URLs, one decision path, so approve and decline cannot drift apart
router.post('/makeup/:id/approve', (req, res) => {
    req.body.decision = 'approve';
    return MakeupController.decide(req, res);
});
router.post('/makeup/:id/decline', (req, res) => {
    req.body.decision = 'decline';
    req.body.declineReason = req.body.declineReason || req.body.reason;
    return MakeupController.decide(req, res);
});

module.exports = router;


// 3D Building Viewer
router.get('/building', async (req, res) => {
    const data = getSharedData();
    res.render('pages/dean/building', {
        title: 'FaciTrack - 3D Building Viewer',
        ...data,
        ...(await deanChrome(req.session.userId))
    });
});