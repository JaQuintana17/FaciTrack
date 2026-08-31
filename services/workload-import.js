/**
 * Reads a CSPC "Workload Schedule of Faculty" .docx and turns its weekly grid
 * into workload blocks.
 *
 * The form is a single Word table: column 0 is a time range, columns 1..7 are
 * the days. A class cell holds three lines — subject code, section, room — and
 * spans as many rows as it has hours, expressed as an OOXML *vertical merge*.
 * That merge is the only place the duration is recorded, so the table has to be
 * read structurally; flattening it to text (what the OCR importer does) loses it.
 */

const JSZip = require('jszip');

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_LOOKUP = {};
DAY_NAMES.forEach(d => {
    DAY_LOOKUP[d.toUpperCase()] = d;
    DAY_LOOKUP[d.slice(0, 3).toUpperCase()] = d;
});

// Half-hours from midnight, matching START_SLOT/END_SLOT in public/js/workload.js.
const GRID_START_SLOT = 14;  // 7:00 AM
const GRID_END_SLOT = 40;    // 8:00 PM

// Cells that belong to the form but are not teaching load. They are reported
// back rather than dropped, so the instructor can see nothing went missing.
const NON_TEACHING = /^(lunch|break|consultation|research|extension|vacant|free|designation|administrative)\b/i;

const SUBJECT_CODE = /^[A-Z]{2,6}\s*\d{2,4}[A-Z]?$/;

// The footer legend marks overload hours with a yellow fill.
const OVERLOAD_FILL = 'FFFF00';

/* ── OOXML reading ───────────────────────────────────────────────────────── */

function decodeEntities(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e) => {
        if (e === 'amp') return '&';
        if (e === 'lt') return '<';
        if (e === 'gt') return '>';
        if (e === 'quot') return '"';
        if (e === 'apos') return "'";
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    });
}

/**
 * Walk the tables in a document.xml. Written as a tag scanner rather than a
 * regex split because cells nest — a split on <w:tc> cannot tell an inner
 * table's cell from an outer one.
 */
function readTables(xml) {
    const TAG = /<(\/?)(w:tbl|w:tr|w:tc|w:tcPr|w:p|w:br|w:t|w:vMerge|w:shd|w:gridSpan)\b([^>]*?)(\/?)>/g;

    const tables = [];
    const stack = [];        // open tables, innermost last
    const openCells = [];    // enclosing cells, so a nested table restores the outer one
    let cell = null;
    let text = '';
    let tcPrDepth = 0;

    let m;
    while ((m = TAG.exec(xml)) !== null) {
        const [, closing, name, attrs, selfClose] = m;
        const isClose = closing === '/';
        const isSelf = selfClose === '/';

        if (name === 'w:tbl') {
            if (isClose) {
                const done = stack.pop();
                if (done) tables.push(done);
            } else if (!isSelf) {
                stack.push([]);
            }
            continue;
        }
        if (!stack.length) continue;
        const table = stack[stack.length - 1];

        switch (name) {
            case 'w:tr':
                if (!isClose && !isSelf) table.push([]);
                break;

            case 'w:tc':
                if (isClose) {
                    if (cell) cell.lines = splitLines(text);
                    cell = openCells.pop() || null;
                    text = '';
                } else if (!isSelf) {
                    openCells.push(cell);
                    cell = { merge: null, fill: null, lines: [], span: 1 };
                    text = '';
                    if (table.length) table[table.length - 1].push(cell);
                }
                break;

            case 'w:tcPr':
                if (isClose) tcPrDepth--;
                else if (!isSelf) tcPrDepth++;
                break;

            // vMerge and shd also appear in run and paragraph properties, so
            // they only count while we are inside the cell's own properties.
            case 'w:vMerge':
                if (cell && tcPrDepth > 0 && !isClose) {
                    cell.merge = /w:val="restart"/.test(attrs) ? 'restart' : 'continue';
                }
                break;

            case 'w:shd':
                if (cell && tcPrDepth > 0 && !isClose) {
                    const fill = /w:fill="([0-9A-Fa-f]{6})"/.exec(attrs);
                    if (fill) cell.fill = fill[1].toUpperCase();
                }
                break;

            case 'w:gridSpan':
                if (cell && tcPrDepth > 0 && !isClose) {
                    const n = /w:val="(\d+)"/.exec(attrs);
                    if (n) cell.span = Math.max(1, parseInt(n[1], 10));
                }
                break;

            case 'w:br':
                if (cell) text += '\n';
                break;

            case 'w:p':
                if (isClose && cell) text += '\n';
                break;

            case 'w:t':
                if (!isClose && !isSelf && cell) {
                    const end = xml.indexOf('</w:t>', TAG.lastIndex);
                    if (end !== -1) {
                        text += decodeEntities(xml.slice(TAG.lastIndex, end));
                        TAG.lastIndex = end + 6;
                    }
                }
                break;
        }
    }

    return tables;
}

function splitLines(text) {
    return text.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Every paragraph of a part, used for the header metadata. */
function readParagraphs(xml) {
    return xml.split(/<w:p[ >]/).slice(1)
        .map(p => [...p.split('</w:p>')[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
            .map(t => decodeEntities(t[1])).join('').trim())
        .filter(Boolean);
}

/* ── Grid interpretation ─────────────────────────────────────────────────── */

/**
 * Expand gridSpan and resolve vertical merges into a rectangular matrix where
 * every cell knows how many rows it owns.
 */
function normalizeTable(rows) {
    const width = Math.max(...rows.map(r => r.reduce((n, c) => n + c.span, 0)));
    const matrix = rows.map(row => {
        const out = new Array(width).fill(null);
        let col = 0;
        row.forEach(c => {
            for (let i = 0; i < c.span && col < width; i++, col++) out[col] = c;
        });
        return out;
    });

    // A 'continue' cell is the tail of the 'restart' above it in the same column.
    const owners = [];
    for (let r = 0; r < matrix.length; r++) {
        owners.push(new Array(width).fill(null));
        for (let c = 0; c < width; c++) {
            const cell = matrix[r][c];
            if (!cell) continue;
            if (cell.merge === 'continue' && r > 0 && owners[r - 1][c]) {
                const owner = owners[r - 1][c];
                owner.rowSpan++;
                owners[r][c] = owner;
            } else if (cell.lines.length || cell.merge === 'restart') {
                owners[r][c] = { cell, row: r, col: c, rowSpan: 1 };
            }
        }
    }

    // Keep only the first appearance of each owner — that is where its block starts.
    const blocks = [];
    const seen = new Set();
    owners.forEach(row => row.forEach(o => {
        if (o && !seen.has(o)) { seen.add(o); blocks.push(o); }
    }));

    return { matrix, width, blocks };
}

/**
 * The form writes times in 12-hour form with no AM/PM ("1:00 – 2:00"), so the
 * only thing that disambiguates them is that the column runs forward. Each row
 * takes the earliest reading that is still later than the row above it.
 */
function readTimeColumn(matrix) {
    // Half-hour index for a 12-hour reading, choosing AM or PM — whichever
    // lands first after `after`.
    function resolve(h, m, after) {
        const base = (h % 12) * 2 + (m >= 30 ? 1 : 0);
        return base > after ? base : base + 24;
    }

    const slots = [];
    let previous = -1;

    matrix.forEach((row, r) => {
        const cell = row[0];
        const raw = cell ? cell.lines.join(' ') : '';
        const times = [...raw.matchAll(/(\d{1,2})\s*[:.]\s*(\d{2})/g)]
            .map(t => [parseInt(t[1], 10), parseInt(t[2], 10)]);

        if (!times.length) { slots[r] = null; return; }

        const start = resolve(times[0][0], times[0][1], previous);
        const end = times[1] ? resolve(times[1][0], times[1][1], start) : start + 2;
        slots[r] = { start, end };
        previous = start;
    });

    return slots;
}

/**
 * Which grid column is which weekday, and which row said so — everything from
 * the heading row upwards is chrome, not schedule.
 */
function readDayColumns(matrix) {
    const columns = {};
    let headerRow = -1;

    for (let r = 0; r < Math.min(3, matrix.length); r++) {
        matrix[r].forEach((cell, c) => {
            if (!cell || c === 0) return;
            const day = DAY_LOOKUP[cell.lines.join(' ').trim().toUpperCase()];
            if (day && columns[c] === undefined) { columns[c] = day; headerRow = r; }
        });
        if (Object.keys(columns).length >= 5) break;
    }

    return { columns, headerRow };
}

/**
 * A room on the form is written building-first — "AB4-TR002" is room TR002 in
 * Academic Building 4. The building is held on the department, not the room, so
 * the two halves are kept apart for the matcher to resolve separately.
 */
const ROOM_WITH_BUILDING = /^([A-Za-z]{1,4}\s*(?:\d{1,2}|[IVXivx]{1,4}))\s*[-–—]\s*(.+)$/;

function splitRoomLabel(label) {
    const parts = ROOM_WITH_BUILDING.exec(label.trim());
    if (!parts) return { building: null, name: label.trim() };
    return { building: parts[1].replace(/\s+/g, ''), name: parts[2].trim() };
}

/**
 * Pull subject / section / room out of a class cell.
 * Rooms sometimes carry the class type ("MAC Laboratory"); everything after the
 * first two lines is treated as the room, so a wrapped room name survives.
 */
function readClassCell(lines) {
    const code = lines[0].replace(/\s+/g, ' ').trim();
    if (!SUBJECT_CODE.test(code.toUpperCase())) return null;

    const section = (lines[1] || '').trim();
    let room = lines.slice(2).join(' ').trim();
    let type = 'Lecture';

    const trailing = /^(.*?)[\s,-]*\b(laborator(?:y|ies)|lab)\b\.?$/i.exec(room);
    if (trailing && trailing[1].trim()) {
        room = trailing[1].trim();
        type = 'Laboratory';
    } else if (/lab/i.test(room)) {
        type = 'Laboratory';
    }

    const { building, name } = splitRoomLabel(room);
    return { subjectCode: code, section, roomLabel: room, roomBuilding: building, roomName: name, type };
}

/** "First Semester, SY 2026-2027" lives in the page header, not the body. */
async function readSemester(zip) {
    const header = zip.file(/^word\/header\d*\.xml$/)[0];
    if (!header) return null;
    const paragraphs = readParagraphs(await header.async('string'));
    return paragraphs.find(p => /semester/i.test(p)) || null;
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

/**
 * @param {Buffer} buffer the uploaded .docx
 * @returns {Promise<{semester, blocks, skipped, roomLabels, warnings}>}
 */
async function parseWorkloadDocx(buffer) {
    let zip;
    try {
        zip = await JSZip.loadAsync(buffer);
    } catch {
        throw new Error('That file could not be opened as a Word document.');
    }

    const documentXml = zip.file('word/document.xml');
    if (!documentXml) throw new Error('That file is not a Word (.docx) document.');

    const tables = readTables(await documentXml.async('string'));
    if (!tables.length) throw new Error('No schedule table was found in this document.');

    // Score by how many weekday headings a table has, so a signature block or
    // the legend table is never mistaken for the grid.
    let best = null;
    for (const rows of tables) {
        if (rows.length < 2) continue;
        const normalized = normalizeTable(rows);
        const { columns, headerRow } = readDayColumns(normalized.matrix);
        const score = Object.keys(columns).length;
        if (score >= 3 && (!best || score > best.score)) {
            best = { ...normalized, dayColumns: columns, headerRow, score };
        }
    }
    if (!best) {
        throw new Error('No weekly schedule grid was found — the table needs a row of weekday headings.');
    }

    const times = readTimeColumn(best.matrix);
    const warnings = [];
    const found = [];
    const skipped = [];
    const roomLabels = new Map();

    for (const owner of best.blocks) {
        const day = best.dayColumns[owner.col];
        if (!day) continue;                       // the time column, or an unlabelled one
        if (owner.row <= best.headerRow) continue; // the weekday heading itself

        const lines = owner.cell.lines;
        if (!lines.length) continue;

        const span = times[owner.row];
        if (!span) {
            warnings.push(`Skipped a ${day} entry — its row has no readable time.`);
            continue;
        }

        const lastRow = Math.min(owner.row + owner.rowSpan - 1, times.length - 1);
        const startSlot = span.start;
        const endSlot = (times[lastRow] || span).end;
        const label = lines.join(' · ');

        if (endSlot <= startSlot) {
            warnings.push(`Skipped "${label}" on ${day} — its time range reads backwards.`);
            continue;
        }
        if (startSlot < GRID_START_SLOT || endSlot > GRID_END_SLOT) {
            skipped.push({ day, startSlot, endSlot, label, reason: 'Outside the 7:00 AM – 8:00 PM grid' });
            continue;
        }

        const parsed = lines.length >= 2 ? readClassCell(lines) : null;
        if (!parsed) {
            skipped.push({
                day, startSlot, endSlot, label,
                reason: NON_TEACHING.test(lines[0]) ? 'Not a teaching block' : 'No subject code recognised',
            });
            continue;
        }

        if (parsed.roomLabel && !roomLabels.has(parsed.roomLabel)) {
            roomLabels.set(parsed.roomLabel, {
                label: parsed.roomLabel,
                building: parsed.roomBuilding,
                name: parsed.roomName,
                type: parsed.type,        // what the form implies this room is
            });
        }
        found.push({
            day, startSlot, endSlot,
            subjectCode: parsed.subjectCode,
            section: parsed.section,
            roomLabel: parsed.roomLabel,
            type: parsed.type,
            overload: owner.cell.fill === OVERLOAD_FILL,
        });
    }

    if (!found.length) {
        throw new Error('No class blocks were recognised. Each class cell needs three lines: subject code, section, then room.');
    }

    // The grid holds one block per day and start slot, so overlapping entries
    // cannot both survive. The earlier one wins and the other is reported.
    const blocks = [];
    for (const b of found.sort((a, z) => a.startSlot - z.startSlot)) {
        const clash = blocks.find(k => k.day === b.day && b.startSlot < k.endSlot && k.startSlot < b.endSlot);
        if (clash) {
            warnings.push(`${b.subjectCode} overlaps ${clash.subjectCode} on ${b.day} and was left out.`);
            continue;
        }
        blocks.push(b);
    }

    return {
        semester: await readSemester(zip),
        blocks,
        skipped,
        roomLabels: [...roomLabels.values()].sort((a, z) => a.label.localeCompare(z.label)),
        warnings,
    };
}

module.exports = { parseWorkloadDocx, GRID_START_SLOT, GRID_END_SLOT };
