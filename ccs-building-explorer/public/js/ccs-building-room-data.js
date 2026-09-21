/**
 * ccs-building-room-data.js
 * --------------------------
 * Central data store for all CCS Building rooms, faculty assignments,
 * and availability status. Keep all room info here — never hardcode
 * it inside scene or interaction files.
 *
 * objectName must match the mesh name used in ccs-building-loader.js.
 *
 * Floors:
 *   Ground Floor  → rooms 100-series  (floor index 0)
 *   Second Floor  → rooms 200-series  (floor index 1)
 *   Third Floor   → rooms 300-series  (floor index 2)
 *   Fourth Floor  → rooms 400-series  (floor index 3)
 *
 * Status values: "Available" | "Occupied" | "On Leave" | "Unavailable"
 */

export const ROOM_DATA = [
  // ── GROUND FLOOR ─────────────────────────────────────────────────────
  {
    room       : 'CCS101',
    faculty    : 'Prof. Juan Dela Cruz',
    floor      : 'Ground Floor',
    floorIndex : 0,
    status     : 'Available',
    objectName : 'Room_CCS101',
    description: 'Programming Fundamentals Laboratory',
  },
  {
    room       : 'CCS102',
    faculty    : 'Prof. Ana Reyes',
    floor      : 'Ground Floor',
    floorIndex : 0,
    status     : 'Occupied',
    objectName : 'Room_CCS102',
    description: 'Data Structures & Algorithms Room',
  },
  {
    room       : 'CCS103',
    faculty    : 'Prof. Roberto Lim',
    floor      : 'Ground Floor',
    floorIndex : 0,
    status     : 'Available',
    objectName : 'Room_CCS103',
    description: 'Computer Organization Room',
  },
  {
    room       : 'LAB1',
    faculty    : 'Prof. Carla Mendoza',
    floor      : 'Ground Floor',
    floorIndex : 0,
    status     : 'Occupied',
    objectName : 'Room_LAB1',
    description: 'Computer Laboratory 1',
  },
  {
    room       : 'LAB2',
    faculty    : 'Prof. Dennis Santos',
    floor      : 'Ground Floor',
    floorIndex : 0,
    status     : 'Available',
    objectName : 'Room_LAB2',
    description: 'Computer Laboratory 2',
  },
  {
    room       : 'CCS_OFFICE',
    faculty    : 'Dean Maria Flores',
    floor      : 'Ground Floor',
    floorIndex : 0,
    status     : 'Available',
    objectName : 'Room_CCS_OFFICE',
    description: 'CCS Dean\'s Office',
  },

  // ── SECOND FLOOR ──────────────────────────────────────────────────────
  {
    room       : 'CCS201',
    faculty    : 'Prof. Maria Santos',
    floor      : 'Second Floor',
    floorIndex : 1,
    status     : 'Available',
    objectName : 'Room_CCS201',
    description: 'Web Development Room',
  },
  {
    room       : 'CCS202',
    faculty    : 'Prof. Jose Garcia',
    floor      : 'Second Floor',
    floorIndex : 1,
    status     : 'On Leave',
    objectName : 'Room_CCS202',
    description: 'Database Management Room',
  },
  {
    room       : 'CCS203',
    faculty    : 'Prof. Luz Ramos',
    floor      : 'Second Floor',
    floorIndex : 1,
    status     : 'Available',
    objectName : 'Room_CCS203',
    description: 'Software Engineering Room',
  },
  {
    room       : 'CCS204',
    faculty    : 'Prof. Emmanuel Torres',
    floor      : 'Second Floor',
    floorIndex : 1,
    status     : 'Occupied',
    objectName : 'Room_CCS204',
    description: 'Network Administration Room',
  },
  {
    room       : 'LAB3',
    faculty    : 'Prof. Sheila Castillo',
    floor      : 'Second Floor',
    floorIndex : 1,
    status     : 'Available',
    objectName : 'Room_LAB3',
    description: 'Computer Laboratory 3',
  },

  // ── THIRD FLOOR ───────────────────────────────────────────────────────
  {
    room       : 'CCS301',
    faculty    : 'Prof. Ricardo Cruz',
    floor      : 'Third Floor',
    floorIndex : 2,
    status     : 'Available',
    objectName : 'Room_CCS301',
    description: 'Operating Systems Room',
  },
  {
    room       : 'CCS302',
    faculty    : 'Prof. Nora Villanueva',
    floor      : 'Third Floor',
    floorIndex : 2,
    status     : 'Occupied',
    objectName : 'Room_CCS302',
    description: 'Artificial Intelligence Room',
  },
  {
    room       : 'CCS303',
    faculty    : 'Prof. Arnel Dizon',
    floor      : 'Third Floor',
    floorIndex : 2,
    status     : 'Unavailable',
    objectName : 'Room_CCS303',
    description: 'Mobile Development Room',
  },
  {
    room       : 'LAB4',
    faculty    : 'Prof. Gemma Ocampo',
    floor      : 'Third Floor',
    floorIndex : 2,
    status     : 'Available',
    objectName : 'Room_LAB4',
    description: 'Computer Laboratory 4',
  },

  // ── FOURTH FLOOR ──────────────────────────────────────────────────────
  {
    room       : 'CCS401',
    faculty    : 'Prof. Victor Bautista',
    floor      : 'Fourth Floor',
    floorIndex : 3,
    status     : 'Available',
    objectName : 'Room_CCS401',
    description: 'Capstone Research Room',
  },
  {
    room       : 'CCS402',
    faculty    : 'Prof. Irene Pascual',
    floor      : 'Fourth Floor',
    floorIndex : 3,
    status     : 'Occupied',
    objectName : 'Room_CCS402',
    description: 'Thesis Writing Room',
  },
  {
    room       : 'LAB5',
    faculty    : 'Prof. Felix Aquino',
    floor      : 'Fourth Floor',
    floorIndex : 3,
    status     : 'Available',
    objectName : 'Room_LAB5',
    description: 'Computer Laboratory 5 (Capstone Lab)',
  },
];

/**
 * Lookup a room record by its room code (case-insensitive).
 * @param {string} roomCode  e.g. "CCS201", "lab1"
 * @returns {object|null}
 */
export function getRoomByCode(roomCode) {
  const key = roomCode.trim().toUpperCase();
  return ROOM_DATA.find(r => r.room.toUpperCase() === key) || null;
}

/**
 * Lookup a room record by its Three.js mesh object name.
 * @param {string} objectName  e.g. "Room_CCS201"
 * @returns {object|null}
 */
export function getRoomByObjectName(objectName) {
  return ROOM_DATA.find(r => r.objectName === objectName) || null;
}

/**
 * Return all rooms for a given floor index (0-3).
 * @param {number} floorIndex
 * @returns {object[]}
 */
export function getRoomsByFloor(floorIndex) {
  return ROOM_DATA.filter(r => r.floorIndex === floorIndex);
}

/**
 * Status colour map — maps status string → CSS/hex colour used across UI and 3D scene.
 */
export const STATUS_COLORS = {
  'Available'  : '#1ABC9C',
  'Occupied'   : '#E74C3C',
  'On Leave'   : '#F39C12',
  'Unavailable': '#7F8C8D',
};

export const FLOOR_NAMES = [
  'Ground Floor',
  'Second Floor',
  'Third Floor',
  'Fourth Floor',
];
