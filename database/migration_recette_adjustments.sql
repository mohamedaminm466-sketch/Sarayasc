-- ============================================
-- MIGRATION: recette_adjustments column
-- ============================================

-- Add the column
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS recette_adjustments JSONB;

-- Update null values
UPDATE shifts SET recette_adjustments = '{}' WHERE recette_adjustments IS NULL;

-- Set default and not null
ALTER TABLE shifts ALTER COLUMN recette_adjustments SET DEFAULT '{}';
ALTER TABLE shifts ALTER COLUMN recette_adjustments SET NOT NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_shifts_recette_adjustments ON shifts USING gin (recette_adjustments);