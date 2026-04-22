-- Run in Supabase if DB still has chk_quot_description_length @ 500
-- (new installs: see schema.sql + security-hardening.sql)

ALTER TABLE quotation_items DROP CONSTRAINT IF EXISTS chk_quot_description_length;
ALTER TABLE quotation_items ADD CONSTRAINT chk_quot_description_length CHECK (char_length(raw_description) <= 2000);
