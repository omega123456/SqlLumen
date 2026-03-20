-- Add sort_order and timeout configuration columns to connections table
-- Phase 2.1: Connection Data Layer

ALTER TABLE connections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN connect_timeout_secs INTEGER DEFAULT 10;
ALTER TABLE connections ADD COLUMN keepalive_interval_secs INTEGER DEFAULT 60;
