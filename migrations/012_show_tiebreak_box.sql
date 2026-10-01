-- Lets the admin hide the auto-generated "Desempate" box of the public Reglas tab. On by default.
ALTER TABLE tournaments ADD COLUMN show_tiebreak_box INTEGER NOT NULL DEFAULT 1;
