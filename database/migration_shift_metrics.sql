-- ============================================================
-- SARAYA INVENTORY
-- SHIFT METRICS MIGRATION
-- ============================================================

-- Prices that the admin can modify
-- staff_price is already present in items,
-- so we only need to make sure the requested items exist.

-- ------------------------------------------------------------
-- Add visibility column if the existing database was created
-- from an older version of schema.sql
-- ------------------------------------------------------------

ALTER TABLE items
ADD COLUMN IF NOT EXISTS visible_to_workers BOOLEAN DEFAULT true;

-- ------------------------------------------------------------
-- Add default shift quantity if missing
-- ------------------------------------------------------------

ALTER TABLE items
ADD COLUMN IF NOT EXISTS default_shift_quantity DECIMAL(10,2) DEFAULT 0;

-- ------------------------------------------------------------
-- SHIFT METRICS
--
-- Worker enters at end of shift:
--
-- Water:
--   Water 0.5L
--   Water 1L
--   Water 1.5L
--   Water Bolar
--
-- Chicha:
--   Total chicha
--   Personnel chicha
--
-- Coffee:
--   Express
--   Cappuccino
--   Americain
--   Filter
--   Direct
--
-- Coffee beans consumed
-- Tombac consumed
-- ------------------------------------------------------------

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS water_05_used INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS water_1_used INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS water_15_used INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS water_bolar_used INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS chicha_total INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS chicha_personnel INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS chicha_normal INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS coffee_express INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS coffee_cappuccino INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS coffee_americain INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS coffee_filter INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS coffee_direct INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS coffee_total INTEGER DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS coffee_beans_used DECIMAL(10,3) DEFAULT 0;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS tombac_used DECIMAL(10,3) DEFAULT 0;

-- ------------------------------------------------------------
-- Make sure existing rows don't contain NULL metrics
-- ------------------------------------------------------------

UPDATE shifts
SET
    water_05_used = COALESCE(water_05_used, 0),
    water_1_used = COALESCE(water_1_used, 0),
    water_15_used = COALESCE(water_15_used, 0),
    water_bolar_used = COALESCE(water_bolar_used, 0),

    chicha_total = COALESCE(chicha_total, 0),
    chicha_personnel = COALESCE(chicha_personnel, 0),
    chicha_normal = COALESCE(chicha_normal, 0),

    coffee_express = COALESCE(coffee_express, 0),
    coffee_cappuccino = COALESCE(coffee_cappuccino, 0),
    coffee_americain = COALESCE(coffee_americain, 0),
    coffee_filter = COALESCE(coffee_filter, 0),
    coffee_direct = COALESCE(coffee_direct, 0),
    coffee_total = COALESCE(coffee_total, 0),

    coffee_beans_used = COALESCE(coffee_beans_used, 0),
    tombac_used = COALESCE(tombac_used, 0);

-- ------------------------------------------------------------
-- Calculate existing chicha normal values
-- ------------------------------------------------------------

UPDATE shifts
SET chicha_normal =
    GREATEST(
        0,
        COALESCE(chicha_total, 0) -
        COALESCE(chicha_personnel, 0)
    );

-- ------------------------------------------------------------
-- Calculate existing coffee totals
-- ------------------------------------------------------------

UPDATE shifts
SET coffee_total =
    COALESCE(coffee_express, 0) +
    COALESCE(coffee_cappuccino, 0) +
    COALESCE(coffee_americain, 0) +
    COALESCE(coffee_filter, 0) +
    COALESCE(coffee_direct, 0);

-- ------------------------------------------------------------
-- Create indexes
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_shifts_status
ON shifts(status);

CREATE INDEX IF NOT EXISTS idx_shifts_start_time
ON shifts(start_time);

CREATE INDEX IF NOT EXISTS idx_shifts_user_id
ON shifts(user_id);

-- ============================================================
-- DONE
-- ============================================================

SELECT
    'Shift metrics migration completed successfully.' AS message;