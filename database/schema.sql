-- database/schema.sql

CREATE DATABASE saraya_inventory;

\c saraya_inventory;

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'worker',
    full_name VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Items master table
CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    unit VARCHAR(20) DEFAULT 'unit',
    price DECIMAL(10,2),
    staff_price DECIMAL(10,2),
    is_fractional BOOLEAN DEFAULT false,
    is_tracked BOOLEAN DEFAULT true,
    can_be_front BOOLEAN NOT NULL DEFAULT true,
    can_be_warehouse BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stock movements (warehouse)
CREATE TABLE warehouse_stock (
    item_id INTEGER PRIMARY KEY REFERENCES items(id),
    quantity DECIMAL(10,2) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Front stock (at the counter)
CREATE TABLE front_stock (
    item_id INTEGER PRIMARY KEY REFERENCES items(id),
    quantity DECIMAL(10,2) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Shifts
CREATE TABLE shifts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'ended', 'cancelled'
    opening_front_stock JSONB, -- Snapshot of front stock at shift start
    closing_front_stock JSONB, -- Snapshot of front stock at shift end
    opening_warehouse_allocations JSONB, -- What was taken from warehouse
    cash_collected DECIMAL(10,2),
    rami_games_used INTEGER DEFAULT 0,
    staff_consumption JSONB, -- {coffee: 2, cappuccino: 1, soda: 3}
    final_recette DECIMAL(10,2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_shift_stage VARCHAR(30) NOT NULL DEFAULT 'idle',
    rami_paper_opening INTEGER NOT NULL DEFAULT 0,
    rami_paper_added INTEGER NOT NULL DEFAULT 0,
    rami_paper_closing INTEGER NOT NULL DEFAULT 0,
    rami_paper_used INTEGER NOT NULL DEFAULT 0,
    opening_warehouse_stock JSONB NOT NULL DEFAULT '{}'::jsonb,
    closing_warehouse_stock JSONB NOT NULL DEFAULT '{}'::jsonb,
    expenses_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    expenses_note TEXT NOT NULL DEFAULT '',
    manque_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    manque_note TEXT NOT NULL DEFAULT '',
    actual_cash_counted NUMERIC(12,2),
    final_shift_note TEXT NOT NULL DEFAULT '',
    staff_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
    recette_breakdown_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_finalized BOOLEAN NOT NULL DEFAULT false
);

-- Shift item additions (mid-shift)
CREATE TABLE shift_additions (
    id SERIAL PRIMARY KEY,
    shift_id INTEGER REFERENCES shifts(id),
    item_id INTEGER REFERENCES items(id),
    quantity DECIMAL(10,2) NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

-- Logs
CREATE TABLE logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    username VARCHAR(50),
    action VARCHAR(50),
    description TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default items
INSERT INTO items (name, display_name, unit, price, staff_price, is_fractional) VALUES
('Charbon', 'Charbon', 'bag', NULL, NULL, true),
('Tombac', 'Tombac', 'bag', NULL, NULL, true),
('Manga', 'Manga', 'bag', 10.00, 8.00, true),
('Rami Games', 'Rami Games', 'pack', 5.00, NULL, false),
('Water 0.5L', 'Water 0.5L', 'bottle', 1.50, NULL, false),
('Water 1.5L', 'Water 1.5L', 'bottle', 2.50, NULL, false),
('Boissons Gazeuses', 'Boissons Gazeuses', 'can', 2.00, 1.50, false),
('Canettes', 'Canettes', 'can', 2.00, NULL, false),
('Citron', 'Citron', 'piece', NULL, NULL, false),
('Coffee Beans', 'Coffee Beans', 'kg', 20.00, NULL, false),
('Cappuccino', 'Cappuccino', 'cup', 8.00, 3.00, false),
('Direct', 'Direct Sales', 'unit', 10.00, 7.00, false);

-- Initialize warehouse and front stock
INSERT INTO warehouse_stock (item_id, quantity)
SELECT id, 0 FROM items;

INSERT INTO front_stock (item_id, quantity)
SELECT id, 0 FROM items;

-- Rami paper stock is intentionally separate from normal warehouse/front stock.
CREATE TABLE IF NOT EXISTS rami_paper_stock (
    id INTEGER PRIMARY KEY DEFAULT 1,
    quantity INTEGER NOT NULL DEFAULT 0,
    last_added_at TIMESTAMP NULL,
    last_added_by INTEGER NULL REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO rami_paper_stock (id, quantity) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_settings (key VARCHAR(100) PRIMARY KEY, value NUMERIC(12,2) NOT NULL DEFAULT 0, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL);
INSERT INTO app_settings(key,value) VALUES ('chicha_price',7.00) ON CONFLICT(key) DO NOTHING;
