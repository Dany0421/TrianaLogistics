-- Run once in Supabase SQL Editor if DB already had chk_bom_description_length @ 500
-- (schema.sql and security-hardening.sql now use 2000 for new installs)

ALTER TABLE bom_items DROP CONSTRAINT IF EXISTS chk_bom_description_length;
ALTER TABLE bom_items ADD CONSTRAINT chk_bom_description_length CHECK (char_length(description) <= 2000);
