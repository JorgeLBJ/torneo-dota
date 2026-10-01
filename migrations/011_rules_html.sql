-- The rulebook becomes rich text. rules_html holds the sanitized HTML; NULL means "not edited with the editor yet",
-- and the old rules_text (## headings and - lists) is converted on the fly, so nothing already written is lost.
ALTER TABLE tournaments ADD COLUMN rules_html TEXT;
