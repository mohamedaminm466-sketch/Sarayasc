-- Rami paper is a simple consumable managed directly by workers.
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS end_shift_stage VARCHAR(30) NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS rami_paper_opening INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rami_paper_added INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rami_paper_closing INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rami_paper_used INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rami_paper_stock (
  id INTEGER PRIMARY KEY DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 0,
  last_added_at TIMESTAMP NULL,
  last_added_by INTEGER NULL REFERENCES users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO rami_paper_stock (id, quantity)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
