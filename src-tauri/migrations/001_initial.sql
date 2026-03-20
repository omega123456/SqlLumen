-- Initial schema for MySQL Client
-- Phase 1: Foundation

-- Settings table — key-value store for app configuration
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Connection groups — folders for organizing saved connections
CREATE TABLE IF NOT EXISTS connection_groups (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Connections — saved MySQL connection profiles
CREATE TABLE IF NOT EXISTS connections (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    host             TEXT NOT NULL DEFAULT 'localhost',
    port             INTEGER NOT NULL DEFAULT 3306,
    username         TEXT NOT NULL DEFAULT 'root',
    keychain_ref     TEXT,
    ssl_enabled      INTEGER NOT NULL DEFAULT 0,
    ssl_ca_path      TEXT,
    ssl_cert_path    TEXT,
    ssl_key_path     TEXT,
    color            TEXT,
    group_id         TEXT,
    read_only        INTEGER NOT NULL DEFAULT 0,
    default_database TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
