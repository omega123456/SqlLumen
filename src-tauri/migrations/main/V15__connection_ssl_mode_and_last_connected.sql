ALTER TABLE connections ADD COLUMN last_connected_at TEXT;

ALTER TABLE connections ADD COLUMN ssl_mode TEXT NOT NULL DEFAULT 'disabled'
    CHECK (ssl_mode IN ('disabled', 'preferred', 'required', 'verify_ca', 'verify_identity'));

UPDATE connections
   SET ssl_mode = CASE
        WHEN ssl_enabled = 0 THEN 'disabled'
        WHEN TRIM(COALESCE(ssl_ca_path, '')) != '' THEN 'verify_ca'
        ELSE 'required'
   END;

ALTER TABLE connections DROP COLUMN ssl_enabled;
