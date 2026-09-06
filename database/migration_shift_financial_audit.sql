-- Saraya Inventory: financial audit and worker correction history
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS financial_data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS correction_actions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS recette_breakdown_data JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_shifts_financial_data ON shifts USING GIN (financial_data);
CREATE INDEX IF NOT EXISTS idx_shifts_correction_actions ON shifts USING GIN (correction_actions);
