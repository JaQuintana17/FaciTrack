-- ============================================================
-- FaciTrack — Bootstrap Seed Data
-- Run AFTER facitrack_db.sql
--
-- Contains the minimum rows needed for a usable system:
-- one department, its default Faculty Lounge, and one admin.
-- ============================================================

USE facitrack;

INSERT INTO departments (full_name, short_name, building)
VALUES ('College of Computer Studies', 'CCS', 'Academic Building IV');

-- Every department gets a Faculty Lounge as the default base office
INSERT INTO rooms (room_number, floor_number, department_id, room_type, status)
SELECT 'Faculty Lounge', 1, id, 'Faculty Lounge', 'Active'
FROM departments;

-- Default administrator account
INSERT INTO users (first_name, last_name, email, role, status, department_id, hashed_password)
SELECT
    'James',
    'Quintana',
    'jaquintana@my.cspc.edu.ph',
    'Admin',
    'Active',
    id,
    '$2b$10$gxUHJOcik0/da9aRmzQSNerL3E6k4J3AMoyFboQt/i87Pqm5znp.6'
FROM departments
WHERE short_name = 'CCS';
