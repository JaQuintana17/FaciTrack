-- ============================================================
-- FaciTrack — schema for diagramming ONLY
--
-- Generated from the live database, so it includes every table the
-- migrations have added. Do NOT import this to create a database and do not
-- edit it by hand — facitrack_db.sql is the authoritative schema, and it
-- carries the explanatory comments this dump strips out.
--
-- One deliberate difference: users.public_id loses its DEFAULT (UUID()).
-- MySQL Workbench cannot parse an expression default and refuses the whole
-- file over it. A diagram does not show defaults, so dropping it costs the
-- picture nothing — but the real schema needs it, because Google sign-up
-- inserts a student without supplying public_id and relies on the database
-- to generate one.
--
-- Regenerate with:
--   mysqldump -u root --no-data --skip-add-drop-table --skip-comments facitrack
-- ============================================================

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `app_settings` (
  `setting_key` varchar(60) NOT NULL,
  `setting_value` varchar(255) NOT NULL,
  `updated_by` bigint(20) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`setting_key`),
  KEY `fk_app_settings_user` (`updated_by`),
  CONSTRAINT `fk_app_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `appointments` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `consultation_hour_id` int(11) NOT NULL,
  `student_id` bigint(20) NOT NULL,
  `instructor_id` bigint(20) NOT NULL,
  `section_group_name` varchar(50) NOT NULL,
  `course_subject` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `topic` varchar(255) NOT NULL,
  `mode` enum('Face-to-Face','Online') NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `status` enum('pending','confirmed','completed','cancelled','declined','rescheduled','expired') NOT NULL DEFAULT 'pending',
  `room_id` int(10) unsigned DEFAULT NULL,
  `rescheduled_to_id` bigint(20) DEFAULT NULL,
  `rescheduled_from_id` bigint(20) DEFAULT NULL,
  `decline_reason` text DEFAULT NULL,
  `student_number` varchar(50) NOT NULL,
  `reminder_sent` tinyint(1) NOT NULL DEFAULT 0,
  `meeting_link` varchar(255) DEFAULT NULL,
  `google_event_id` varchar(255) DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `completion_nudged_at` datetime DEFAULT NULL,
  `pending_nudged_at` datetime DEFAULT NULL,
  `dean_escalated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `student_id` (`student_id`),
  KEY `instructor_id` (`instructor_id`),
  KEY `consultation_hour_id` (`consultation_hour_id`),
  KEY `rescheduled_to_id` (`rescheduled_to_id`),
  KEY `rescheduled_from_id` (`rescheduled_from_id`),
  CONSTRAINT `appointments_ibfk_1` FOREIGN KEY (`consultation_hour_id`) REFERENCES `consultation_hours` (`id`),
  CONSTRAINT `appointments_ibfk_2` FOREIGN KEY (`rescheduled_to_id`) REFERENCES `appointments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `appointments_ibfk_3` FOREIGN KEY (`rescheduled_from_id`) REFERENCES `appointments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=56 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `audit_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) DEFAULT NULL,
  `role` varchar(20) DEFAULT NULL,
  `action` varchar(150) NOT NULL,
  `type` varchar(30) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_type` (`type`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3613 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ble_beacons` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `mac_address` char(17) NOT NULL,
  `instructor_id` bigint(20) DEFAULT NULL,
  `label` varchar(80) DEFAULT NULL,
  `ibeacon_major` smallint(5) unsigned DEFAULT NULL,
  `ibeacon_minor` smallint(5) unsigned DEFAULT NULL,
  `battery_pct` tinyint(3) unsigned DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_seen_at` datetime DEFAULT NULL,
  `last_room_id` int(10) unsigned DEFAULT NULL,
  `last_rssi` smallint(6) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_beacon_mac` (`mac_address`),
  UNIQUE KEY `uq_beacon_instructor` (`instructor_id`),
  KEY `fk_beacon_last_room` (`last_room_id`),
  CONSTRAINT `fk_beacon_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_beacon_last_room` FOREIGN KEY (`last_room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=18390 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ble_rssi_samples` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `beacon_id` int(10) unsigned NOT NULL,
  `room_id` int(10) unsigned DEFAULT NULL,
  `scanner_id` varchar(60) DEFAULT NULL,
  `rssi` smallint(6) NOT NULL COMMENT 'dBm, smoothed by the scanner',
  `sampled_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_samples_beacon_time` (`beacon_id`,`sampled_at`),
  KEY `idx_samples_room_time` (`room_id`,`sampled_at`),
  CONSTRAINT `fk_samples_beacon` FOREIGN KEY (`beacon_id`) REFERENCES `ble_beacons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_samples_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1084 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ble_scanners` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `scanner_id` varchar(60) NOT NULL,
  `room_id` int(10) unsigned DEFAULT NULL,
  `last_seen_at` datetime DEFAULT NULL,
  `last_uptime_sec` int(10) unsigned DEFAULT NULL,
  `last_beacon_count` smallint(5) unsigned DEFAULT NULL,
  `last_ip` varchar(45) DEFAULT NULL,
  `report_count` int(10) unsigned NOT NULL DEFAULT 0,
  `first_seen_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_scanner` (`scanner_id`),
  KEY `fk_scanner_room` (`room_id`),
  CONSTRAINT `fk_scanner_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3917 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `calendar_connections` (
  `id` char(36) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `provider` enum('google','apple','other') NOT NULL DEFAULT 'other',
  `display_name` varchar(120) NOT NULL,
  `feed_url` varbinary(1024) DEFAULT NULL,
  `feed_hint` varchar(80) DEFAULT NULL,
  `auto_sync` tinyint(1) NOT NULL DEFAULT 1,
  `blocking_rule` enum('always','never','ask') NOT NULL DEFAULT 'ask',
  `import_titles` tinyint(1) NOT NULL DEFAULT 1,
  `etag` varchar(255) DEFAULT NULL,
  `last_modified` varchar(255) DEFAULT NULL,
  `last_synced_at` datetime DEFAULT NULL,
  `last_status` enum('never','ok','error') NOT NULL DEFAULT 'never',
  `last_error` varchar(300) DEFAULT NULL,
  `event_count` int(10) unsigned NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cc_user` (`user_id`),
  KEY `idx_cc_due` (`auto_sync`,`last_synced_at`),
  CONSTRAINT `calendar_connections_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `consultation_hours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `instructor_id` bigint(20) NOT NULL,
  `recurrence_id` char(36) DEFAULT NULL,
  `day_of_the_week` enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
  `consultation_date` date NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `status` enum('Pending','Available','Booked','closed') DEFAULT 'Available',
  `is_booked` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_slot` (`instructor_id`,`consultation_date`,`start_time`),
  KEY `idx_recurrence_id` (`recurrence_id`),
  CONSTRAINT `consultation_hours_ibfk_1` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=74 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `departments` (
  `id` tinyint(3) unsigned NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) NOT NULL,
  `short_name` varchar(10) NOT NULL,
  `building` varchar(100) NOT NULL,
  `dean_id` bigint(20) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `dean_id` (`dean_id`),
  CONSTRAINT `departments_ibfk_1` FOREIGN KEY (`dean_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `display_devices` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `device_token` char(64) NOT NULL,
  `pairing_code` char(6) DEFAULT NULL,
  `code_expires_at` datetime DEFAULT NULL,
  `label` varchar(120) DEFAULT NULL,
  `department_id` tinyint(3) unsigned DEFAULT NULL,
  `status` enum('pending','approved','revoked') NOT NULL DEFAULT 'pending',
  `approved_by` bigint(20) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `last_seen_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_display_token` (`device_token`),
  UNIQUE KEY `uq_display_code` (`pairing_code`),
  KEY `idx_display_status` (`status`),
  KEY `fk_display_department` (`department_id`),
  KEY `fk_display_approver` (`approved_by`),
  CONSTRAINT `fk_display_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_display_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `external_events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `connection_id` char(36) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `uid` varchar(255) NOT NULL,
  `occurrence` varchar(32) NOT NULL,
  `summary` varchar(255) DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `event_date` date NOT NULL,
  `start_slot` tinyint(3) unsigned DEFAULT NULL,
  `end_slot` tinyint(3) unsigned DEFAULT NULL,
  `all_day` tinyint(1) NOT NULL DEFAULT 0,
  `transparent` tinyint(1) NOT NULL DEFAULT 0,
  `blocks` tinyint(1) NOT NULL DEFAULT 0,
  `decision` enum('auto','pending','user') NOT NULL DEFAULT 'auto',
  `last_seen_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ee_instance` (`connection_id`,`uid`,`occurrence`),
  KEY `idx_ee_when` (`user_id`,`event_date`),
  KEY `idx_ee_blocking` (`user_id`,`blocks`,`event_date`),
  KEY `idx_ee_pending` (`user_id`,`decision`),
  CONSTRAINT `external_events_ibfk_1` FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections` (`id`) ON DELETE CASCADE,
  CONSTRAINT `external_events_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=259 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `faculty_presence` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `instructor_id` bigint(20) NOT NULL,
  `room_id` int(10) unsigned DEFAULT NULL,
  `is_present` tinyint(1) NOT NULL DEFAULT 0,
  `last_rssi` smallint(6) DEFAULT NULL COMMENT 'dBm the owning room heard, for settling a contested tag',
  `detected_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_updated` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_presence_instructor` (`instructor_id`),
  KEY `fk_presence_room` (`room_id`),
  CONSTRAINT `fk_presence_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_presence_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1740 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `google_accounts` (
  `user_id` bigint(20) NOT NULL,
  `google_email` varchar(255) NOT NULL,
  `refresh_token` text NOT NULL,
  `access_token` text DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `scope` text DEFAULT NULL,
  `last_error` varchar(255) DEFAULT NULL,
  `connected_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_google_account_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `instructor_events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `instructor_id` bigint(20) NOT NULL,
  `kind` enum('event','task') NOT NULL DEFAULT 'event',
  `title` varchar(200) NOT NULL,
  `notes` varchar(500) DEFAULT NULL,
  `event_date` date NOT NULL,
  `start_slot` tinyint(3) unsigned DEFAULT NULL,
  `end_slot` tinyint(3) unsigned DEFAULT NULL,
  `all_day` tinyint(1) NOT NULL DEFAULT 0,
  `blocks` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inst_event_day` (`instructor_id`,`event_date`),
  KEY `idx_inst_event_blocking` (`instructor_id`,`blocks`,`event_date`),
  CONSTRAINT `fk_inst_event_user` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `instructor_settings` (
  `user_id` bigint(20) NOT NULL,
  `notify_new_requests` tinyint(1) NOT NULL DEFAULT 1,
  `notify_cancellations` tinyint(1) NOT NULL DEFAULT 1,
  `notify_reminders` tinyint(1) NOT NULL DEFAULT 1,
  `notify_ble_absence` tinyint(1) NOT NULL DEFAULT 0,
  `notify_announcements` tinyint(1) NOT NULL DEFAULT 1,
  `repeat_weekly` tinyint(1) NOT NULL DEFAULT 1,
  `repeat_weeks` tinyint(3) unsigned NOT NULL DEFAULT 4,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `instructor_settings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `instructor_unavailability` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `instructor_id` bigint(20) NOT NULL,
  `unavail_date` date NOT NULL,
  `reason` varchar(300) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unavail` (`instructor_id`,`unavail_date`),
  CONSTRAINT `fk_unavail_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `makeup_request_documents` (
  `id` char(36) NOT NULL,
  `request_id` char(36) NOT NULL,
  `kind` enum('support','polling') NOT NULL DEFAULT 'support',
  `file_path` varchar(255) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `mime_type` varchar(120) NOT NULL,
  `size_bytes` int(10) unsigned NOT NULL DEFAULT 0,
  `uploaded_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_mrd_request` (`request_id`,`kind`),
  CONSTRAINT `makeup_request_documents_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `makeup_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `makeup_request_schedules` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `request_id` char(36) NOT NULL,
  `workload_block_id` bigint(20) unsigned DEFAULT NULL,
  `subject_code` varchar(30) NOT NULL,
  `subject_name` varchar(150) NOT NULL,
  `section_name` varchar(80) NOT NULL,
  `class_type` varchar(40) DEFAULT NULL,
  `delivery_mode` enum('in-campus','online') NOT NULL DEFAULT 'in-campus',
  `class_date` date NOT NULL,
  `day_of_week` enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
  `start_slot` tinyint(3) unsigned NOT NULL,
  `end_slot` tinyint(3) unsigned NOT NULL,
  `room_id` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `workload_block_id` (`workload_block_id`),
  KEY `idx_mrs_request` (`request_id`),
  KEY `idx_mrs_when` (`class_date`,`start_slot`),
  KEY `idx_mrs_room` (`room_id`,`class_date`),
  CONSTRAINT `makeup_request_schedules_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `makeup_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `makeup_request_schedules_ibfk_2` FOREIGN KEY (`workload_block_id`) REFERENCES `workload_blocks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `makeup_request_schedules_ibfk_3` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL,
  CONSTRAINT `CONSTRAINT_1` CHECK (`end_slot` > `start_slot`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `makeup_requests` (
  `id` char(36) NOT NULL,
  `instructor_id` bigint(20) NOT NULL,
  `department_id` tinyint(3) unsigned DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `status` enum('pending','approved','declined','withdrawn') NOT NULL DEFAULT 'pending',
  `decided_by` bigint(20) DEFAULT NULL,
  `dean_statement` varchar(500) DEFAULT NULL,
  `decline_reason` varchar(500) DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `submitted_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `decided_by` (`decided_by`),
  KEY `idx_mr_queue` (`department_id`,`status`,`submitted_at`),
  KEY `idx_mr_instructor` (`instructor_id`,`status`),
  CONSTRAINT `makeup_requests_ibfk_1` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `makeup_requests_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`),
  CONSTRAINT `makeup_requests_ibfk_3` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notifications` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `type` enum('new-request','cancellation','unavailability','reminder','makeup','alert','approved','declined','rescheduled','expired') NOT NULL,
  `message` varchar(255) NOT NULL,
  `related_appointment_id` bigint(20) DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `related_appointment_id` (`related_appointment_id`),
  KEY `idx_user_unread` (`user_id`,`is_read`),
  KEY `idx_user_created` (`user_id`,`created_at`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notifications_ibfk_2` FOREIGN KEY (`related_appointment_id`) REFERENCES `appointments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=189 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `otp_codes` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `code_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `attempts` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `consumed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_otp_active` (`user_id`,`consumed_at`,`expires_at`),
  CONSTRAINT `otp_codes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=81 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `presence_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `instructor_id` bigint(20) NOT NULL,
  `room_id` int(10) unsigned DEFAULT NULL,
  `event` enum('entered','exited','moved') NOT NULL,
  `rssi` smallint(6) DEFAULT NULL,
  `scanner_id` varchar(60) DEFAULT NULL,
  `occurred_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_plog_room` (`room_id`),
  KEY `idx_plog_instructor_time` (`instructor_id`,`occurred_at`),
  KEY `idx_plog_time` (`occurred_at`),
  CONSTRAINT `fk_plog_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plog_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=149 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `push_subscriptions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `endpoint` varchar(500) NOT NULL,
  `p256dh` varchar(255) NOT NULL,
  `auth` varchar(255) NOT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_push_endpoint` (`endpoint`),
  KEY `idx_push_user` (`user_id`),
  CONSTRAINT `push_subscriptions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rooms` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `room_number` varchar(100) NOT NULL,
  `floor_number` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `department_id` tinyint(3) unsigned NOT NULL,
  `room_type` enum('Laboratory','Faculty Office','Consultation Room','Lecture','Faculty Lounge') DEFAULT 'Lecture',
  `assigned_faculty` bigint(20) DEFAULT NULL,
  `is_ble_scanner_installed` tinyint(1) DEFAULT 0,
  `rssi_threshold` smallint(6) DEFAULT NULL COMMENT 'dBm; NULL = use app_settings.presence_rssi_threshold',
  `status` enum('Active','Inactive') DEFAULT 'Active',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `capacity` tinyint(3) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `department_id` (`department_id`),
  KEY `assigned_faculty` (`assigned_faculty`),
  KEY `idx_room_floor` (`department_id`,`floor_number`),
  CONSTRAINT `rooms_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`),
  CONSTRAINT `rooms_ibfk_2` FOREIGN KEY (`assigned_faculty`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `slot_reservations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slot_id` int(11) NOT NULL,
  `student_id` bigint(20) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_slot` (`slot_id`),
  KEY `student_id` (`student_id`),
  CONSTRAINT `slot_reservations_ibfk_1` FOREIGN KEY (`slot_id`) REFERENCES `consultation_hours` (`id`) ON DELETE CASCADE,
  CONSTRAINT `slot_reservations_ibfk_2` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `student_settings` (
  `user_id` bigint(20) NOT NULL,
  `directory_own_dept` tinyint(1) NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_student_settings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `first_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) NOT NULL,
  `hashed_password` varchar(255) DEFAULT NULL,
  `role` enum('Student','Instructor','Dean','Admin') DEFAULT 'Student',
  `last_login` timestamp NULL DEFAULT NULL,
  `profile_picture` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `email` varchar(100) NOT NULL,
  `employment_type` enum('Job Order','Permanent','Co-Terminus','Casual','COS','Temporary') DEFAULT NULL,
  `public_id` char(36) NOT NULL,
  `institutional_id` varchar(50) DEFAULT NULL,
  `status` enum('Active','Inactive') DEFAULT NULL,
  `department_id` tinyint(3) unsigned DEFAULT NULL,
  `position` varchar(100) DEFAULT NULL,
  `base_room_id` int(10) unsigned DEFAULT NULL,
  `availability_status` enum('available','dnd','travel','leave','meeting') DEFAULT NULL,
  `default_meeting_link` varchar(255) DEFAULT NULL,
  `calendar_feed_token` char(43) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `idx_users_feed_token` (`calendar_feed_token`),
  KEY `department_id` (`department_id`),
  KEY `base_room_id` (`base_room_id`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`),
  CONSTRAINT `users_ibfk_2` FOREIGN KEY (`base_room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=90 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `workload_blocks` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `instructor_id` bigint(20) NOT NULL,
  `subject_id` bigint(20) unsigned NOT NULL,
  `day_of_week` enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
  `start_slot` tinyint(3) unsigned NOT NULL,
  `end_slot` tinyint(3) unsigned NOT NULL,
  `section_name` varchar(80) DEFAULT NULL,
  `class_type` varchar(40) DEFAULT NULL,
  `color_hex` varchar(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `room_id` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wb_slot` (`instructor_id`,`day_of_week`,`start_slot`),
  KEY `fk_wb_subject` (`subject_id`),
  KEY `room_id` (`room_id`),
  CONSTRAINT `fk_wb_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wb_subject` FOREIGN KEY (`subject_id`) REFERENCES `workload_subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workload_blocks_ibfk_1` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`),
  CONSTRAINT `CONSTRAINT_1` CHECK (`end_slot` > `start_slot`)
) ENGINE=InnoDB AUTO_INCREMENT=237 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `workload_subjects` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `instructor_id` bigint(20) NOT NULL,
  `subject_code` varchar(30) NOT NULL,
  `subject_name` varchar(150) NOT NULL,
  `color_hex` varchar(20) DEFAULT NULL,
  `units` decimal(4,1) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ws` (`instructor_id`,`subject_code`),
  CONSTRAINT `fk_ws_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=109 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

