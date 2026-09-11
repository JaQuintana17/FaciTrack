const path = require('path');
const RoomModel = require('../models/RoomModel');
const { parseWorkloadDocx } = require('../services/workload-import');
const { parseWorkloadPdf } = require('../services/workload-import-pdf');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

/**
 * Reduce a building to the short code the workload form uses.
 * "Academic Building IV" and "AB4" both come out as AB4, so the form's prefix
 * can be compared against departments.building without either side changing.
 */
function buildingCode(name) {
    const cleaned = String(name || '').replace(/[^A-Za-z0-9\s]/g, ' ').trim();
    if (!cleaned) return null;

    const words = cleaned.split(/\s+/);
    const last = words[words.length - 1].toUpperCase();

    let number = '';
    if (/^\d+$/.test(last)) { number = String(Number(last)); words.pop(); }
    else if (ROMAN[last]) { number = String(ROMAN[last]); words.pop(); }

    if (!words.length) return null;
    // A multi-word name abbreviates to its initials; a single token is already a code.
    const letters = words.length > 1 ? words.map(w => w[0]).join('') : words[0];
    return (letters + number).toUpperCase();
}

/**
 * Break a room name into the parts worth comparing. "TR002", "Room 002" and
 * "IT LAB 2" all carry a name and a number, and the number is often the only
 * half the two systems agree on.
 */
function roomKey(name) {
    const flat = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const split = /^([A-Z]*?)0*(\d+)$/.exec(flat);
    return { flat, alpha: split ? split[1] : flat, number: split ? split[2] : null };
}

/**
 * Pair each room on the form with a room in the system.
 *
 * Only an unambiguous match is applied on the instructor's behalf. Anything
 * inferred is *suggested* — the preview preselects it and the instructor
 * confirms before it is written.
 */
function matchRooms(formRooms, rooms) {
    const index = rooms.map(r => ({
        ...r,
        key: roomKey(r.room_number),
        building: buildingCode(r.building),
    }));

    const knownBuildings = new Set(index.map(r => r.building).filter(Boolean));

    return formRooms.map(form => {
        const building = buildingCode(form.building);
        const key = roomKey(form.name);

        // A room in a building the system does not know about is genuinely not
        // here — guessing at a same-numbered room in another building would be
        // worse than saying so.
        if (building && !knownBuildings.has(building)) {
            return describe(form, building, null, 'unknown-building');
        }

        const candidates = building ? index.filter(r => r.building === building) : index;

        // Same name, ignoring spacing and leading zeros
        let match = candidates.find(r => r.key.flat === key.flat)
            || candidates.find(r => key.number && r.key.number === key.number && r.key.alpha === key.alpha);
        if (match) return describe(form, building, match, 'exact');

        // One name contains the other — "MAC" against "MAC Lab"
        match = key.flat && candidates.find(r => r.key.flat.includes(key.flat) || key.flat.includes(r.key.flat));
        if (match) return describe(form, building, match, 'suggested');

        // Same room number, and the room is the kind of room the form implies.
        // "TR002" is a lecture room, so it lands on Room 002 rather than IT LAB 2.
        if (key.number) {
            const wanted = form.type === 'Laboratory' ? 'Laboratory' : 'Lecture';
            match = candidates.find(r => r.key.number === key.number && r.room_type === wanted)
                || candidates.find(r => r.key.number === key.number);
            if (match) return describe(form, building, match, 'suggested');
        }

        return describe(form, building, null, 'none');
    });
}

function describe(form, building, match, confidence) {
    return {
        label: form.label,
        building,
        roomName: form.name,
        confidence,
        roomId: match ? match.room_id : null,
        roomNumber: match ? match.room_number : null,
        roomType: match ? match.room_type : null,
    };
}

const WorkloadImportController = {

    /**
     * Read an uploaded workload form and describe what it would import.
     *
     * Nothing is written here: the instructor reviews the preview, maps any
     * unrecognised rooms, and confirms — then the page's existing save path
     * persists it, so imported blocks go through the same validation as blocks
     * drawn by hand.
     */
    async preview(req, res) {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file was uploaded.' });
        }

        // Same form either way — the two readers differ only in how they recover
        // the cells, and both hand back the identical preview shape.
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        const isDocx = req.file.mimetype === DOCX_MIME || ext === '.docx';
        const isPdf = req.file.mimetype === PDF_MIME || ext === '.pdf';

        if (!isDocx && !isPdf) {
            return res.status(415).json({
                success: false,
                error: 'Only Word (.docx) or PDF workload forms can be imported.',
            });
        }

        let parsed;
        try {
            parsed = isPdf
                ? await parseWorkloadPdf(req.file.buffer)
                : await parseWorkloadDocx(req.file.buffer);
        } catch (err) {
            // Everything thrown by the parser is written for the instructor to read.
            return res.status(422).json({ success: false, error: err.message });
        }

        try {
            // The building lives on the department, not the room — the form
            // names rooms building-first, so it has to come along.
            const rooms = await RoomModel.getRooms({
                fields: 'r.id AS room_id, r.room_number, r.room_type, d.building',
                filters: { status: 'Active' },
                orderBy: 'room_number',
            });

            const roomMatches = matchRooms(parsed.roomLabels, rooms);
            const byLabel = new Map(roomMatches.map(r => [r.label, r]));

            const blocks = parsed.blocks.map(b => {
                const room = byLabel.get(b.roomLabel);
                return {
                    ...b,
                    // Only exact matches are pre-applied; suggestions wait for the
                    // instructor to accept them in the preview.
                    roomId: room && room.confidence === 'exact' ? room.roomId : null,
                    // A block with no subject name of its own is saved under its
                    // code — the form does not carry full subject names.
                    subjectName: b.subjectCode,
                };
            });

            res.json({
                success: true,
                fileName: req.file.originalname,
                semester: parsed.semester,
                blocks,
                rooms: roomMatches,
                skipped: parsed.skipped,
                warnings: parsed.warnings,
            });
        } catch (err) {
            console.error('[WorkloadImport.preview]', err);
            res.status(500).json({ success: false, error: 'Could not read the schedule. Please try again.' });
        }
    },
};

module.exports = WorkloadImportController;
