-- Connections without their own colour inherit their group's colour
ALTER TABLE connection_groups ADD COLUMN color TEXT;
