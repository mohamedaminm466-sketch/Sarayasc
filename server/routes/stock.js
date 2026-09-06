const express = require('express');
const { pool, transaction } = require('../db');
const {
  verifyToken,
  requireAdmin,
  requireWorker
} = require('../middleware/auth');

console.log('📦 LOADING STOCK ROUTES...');

let stockSchemaReady=false;
const ensureStockSchema=async()=>{
 if(stockSchemaReady)return;
 await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS can_be_front BOOLEAN NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS can_be_warehouse BOOLEAN NOT NULL DEFAULT true`);
 await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (key VARCHAR(100) PRIMARY KEY,value NUMERIC(12,2) NOT NULL DEFAULT 0,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL)`);
 await pool.query(`INSERT INTO app_settings(key,value) VALUES ('chicha_price',7.00) ON CONFLICT(key) DO NOTHING`);
 stockSchemaReady=true;
};

const router = express.Router();

/*
============================================================
HELPERS
============================================================
*/

const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeName = value => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
};

const isRamiGames = item => {
  const name = normalizeName(
    item?.display_name || item?.name || ''
  );

  return (
    name.includes('ramigames') ||
    name.includes('rami')
  );
};

const isCoffee = item => {
  const name = normalizeName(
    item?.display_name || item?.name || ''
  );

  return (
    name.includes('coffee') ||
    name.includes('cafe') ||
    name.includes('café')
  );
};

const isWater = item => {
  const name = normalizeName(
    item?.display_name || item?.name || ''
  );

  return (
    name.includes('water') ||
    name.includes('eau')
  );
};

const isSoda = item => {
  const name = normalizeName(
    item?.display_name || item?.name || ''
  );

  return (
    name.includes('soda') ||
    name.includes('softdrink') ||
    name.includes('boissongazeuse') ||
    name.includes('boissonsgazeuses') ||
    name.includes('gazeuse') ||
    name.includes('gazouse')
  );
};


/*
============================================================
DISCREPANCY SCHEMA
============================================================
*/
let discrepancySchemaReady = false;
const ensureDiscrepancySchema = async client => {
  if (discrepancySchemaReady) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS stock_discrepancies (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expected_quantity DECIMAL(10,2) NOT NULL,
      actual_quantity DECIMAL(10,2) NOT NULL,
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await client.query(`ALTER TABLE stock_discrepancies ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`);
  await client.query(`ALTER TABLE stock_discrepancies ADD COLUMN IF NOT EXISTS reviewed_by INTEGER`);
  await client.query(`ALTER TABLE stock_discrepancies ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending'`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_discrepancies_status ON stock_discrepancies(status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_discrepancies_item_id ON stock_discrepancies(item_id)`);
  discrepancySchemaReady = true;
};

/*
============================================================
GET STOCK
============================================================
*/

const getStockQuery = async (client, isAdmin = false) => {
  if (client === pool) await ensureStockSchema();
  let query = `
    SELECT
      i.id,
      i.name,
      i.display_name,
      i.unit,
      i.price,
      i.staff_price,
      i.is_fractional,
      i.is_tracked,
      i.visible_to_workers,
      i.default_shift_quantity,
      i.can_be_front,
      i.can_be_warehouse,

      COALESCE(ws.quantity, 0) AS warehouse_quantity,
      COALESCE(fs.quantity, 0) AS front_quantity

    FROM items i

    LEFT JOIN warehouse_stock ws
      ON i.id = ws.item_id

    LEFT JOIN front_stock fs
      ON i.id = fs.item_id

    WHERE i.is_tracked = true
  `;

  if (!isAdmin) {
    query += `
      AND i.visible_to_workers = true
    `;
  }

  query += `
    ORDER BY i.id
  `;

  const result = await client.query(query);

  return result.rows.filter(
    item => !isRamiGames(item)
  );
};

/*
============================================================
TEST
============================================================
*/

router.get('/test', (req, res) => {
  res.json({
    message: '✅ Stock routes are working!',
    timestamp: new Date().toISOString()
  });
});

/*
============================================================
GET ALL STOCK
============================================================
*/

router.get('/settings', verifyToken, requireAdmin, async (req,res)=>{ try{ await ensureStockSchema(); const r=await pool.query(`SELECT key,value FROM app_settings`); const out={}; r.rows.forEach(x=>out[x.key]=num(x.value)); res.json(out); }catch(e){res.status(500).json({error:e.message})} });
router.put('/settings/chicha-price', verifyToken, requireAdmin, async (req,res)=>{ try{ await ensureStockSchema(); const price=num(req.body.price); if(price<0) return res.status(400).json({error:'Price must be positive'}); await pool.query(`UPDATE app_settings SET value=$1,updated_at=CURRENT_TIMESTAMP,updated_by=$2 WHERE key='chicha_price'`,[price,req.user.id]); res.json({chicha_price:price}); }catch(e){res.status(500).json({error:e.message})} });

// Worker-safe endpoint: workers may read the Chicha price configured by the admin.
// This is intentionally GET-only; changing the price still requires admin rights.
router.get('/settings/chicha-price', verifyToken, async (req,res)=>{ try{ await ensureStockSchema(); const r=await pool.query(`SELECT value FROM app_settings WHERE key='chicha_price'`); res.json({chicha_price:num(r.rows[0]?.value)}); }catch(e){res.status(500).json({error:e.message})} });

router.get(
  '/',
  verifyToken,
  async (req, res) => {
    try {
      await ensureStockSchema();
      const isAdmin =
        req.user.role === 'admin';

      const stock =
        await getStockQuery(
          pool,
          isAdmin
        );

      res.json(stock);

    } catch (err) {
      console.error(
        'Get stock error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to get stock'
      });
    }
  }
);

/*
============================================================
GET STAFF PRICES
============================================================
*/

router.get(
  '/staff-prices',
  verifyToken,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          name,
          display_name,
          staff_price
        FROM items
        WHERE is_tracked = true
      `);

      let prices = {
        coffee: 0,
        water: 0,
        soda: 0
      };

      result.rows.forEach(item => {
        const name = item.name.toLowerCase();
        const display = item.display_name.toLowerCase();
        const price = parseFloat(item.staff_price) || 0;
        
        // Coffee
        if (name.includes('coffee') || name.includes('cafe') || 
            display.includes('coffee') || display.includes('cafe') ||
            display.includes('café')) {
          prices.coffee = price;
        }
        
        // Water
        if (name.includes('water') || name.includes('eau') || 
            display.includes('water') || display.includes('eau')) {
          prices.water = price;
        }
        
        // Soda
        if (name.includes('soda') || name.includes('gazeuse') || 
            display.includes('soda') || display.includes('gazeuse') ||
            name.includes('softdrink') || display.includes('softdrink')) {
          prices.soda = price;
        }
      });

      console.log('📊 Staff prices fetched:', prices);
      res.json(prices);
    } catch (err) {
      console.error('Get staff prices error:', err);
      res.status(500).json({
        error: 'Failed to get staff prices'
      });
    }
  }
);

/*
============================================================
ADD SUPPLIER STOCK
ADMIN ONLY
============================================================
*/

router.post(
  '/add-supplier',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    const { additions } =
      req.body;

    if (
      !Array.isArray(additions) ||
      additions.length === 0
    ) {
      return res.status(400).json({
        error:
          'Additions required'
      });
    }

    try {

      await transaction(
        async client => {

          for (
            const addition
            of additions
          ) {

            const itemId =
              addition.itemId;

            const quantity =
              num(
                addition.quantity
              );

            if (
              !itemId ||
              quantity <= 0
            ) {
              continue;
            }

            // Check if item can be in warehouse
            const itemCheck = await client.query(
              `SELECT can_be_warehouse FROM items WHERE id = $1`,
              [itemId]
            );

            if (itemCheck.rows.length > 0 && !itemCheck.rows[0].can_be_warehouse) {
              throw new Error(`Item ${itemId} cannot be stored in warehouse`);
            }

            await client.query(
              `
              INSERT INTO warehouse_stock (
                item_id,
                quantity
              )
              VALUES ($1, $2)

              ON CONFLICT (item_id)
              DO UPDATE SET
                quantity =
                  warehouse_stock.quantity
                  + EXCLUDED.quantity,

                updated_at =
                  CURRENT_TIMESTAMP
              `,
              [
                itemId,
                quantity
              ]
            );
          }

          await client.query(
            `
            INSERT INTO logs (
              user_id,
              username,
              action,
              description
            )
            VALUES ($1, $2, $3, $4)
            `,
            [
              req.user.id,
              req.user.username,
              'stock_added',
              `Added supplier stock: ${
                additions
                  .map(
                    a =>
                      `${a.itemId}:${a.quantity}`
                  )
                  .join(', ')
              }`
            ]
          );
        }
      );

      const stock =
        await getStockQuery(
          pool,
          true
        );

      res.json(stock);

    } catch (err) {

      console.error(
        'Add supplier stock error:',
        err
      );

      res.status(500).json({
        error:
          err.message ||
          'Failed to add stock'
      });
    }
  }
);

/*
============================================================
MANUAL CORRECTION
ADMIN ONLY
============================================================
*/

router.post(
  '/correct',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    const { corrections } =
      req.body;

    if (
      !Array.isArray(corrections) ||
      corrections.length === 0
    ) {
      return res.status(400).json({
        error:
          'Corrections required'
      });
    }

    try {

      await transaction(
        async client => {

          for (
            const correction
            of corrections
          ) {

            const itemId =
              correction.itemId;

            const quantity =
              num(
                correction.quantity
              );

            const type =
              correction.type ||
              'warehouse';

            if (
              type !== 'warehouse' &&
              type !== 'front'
            ) {
              throw new Error(
                `Invalid stock type: ${type}. Must be 'warehouse' or 'front'`
              );
            }

            if (
              !itemId ||
              quantity === 0
            ) {
              continue;
            }

            const tableName =
              type === 'front'
                ? 'front_stock'
                : 'warehouse_stock';

            const itemCheck =
              await client.query(
                `
                SELECT id, can_be_front, can_be_warehouse
                FROM items
                WHERE id = $1
                  AND is_tracked = true
                `,
                [itemId]
              );

            if (
              itemCheck.rows.length === 0
            ) {
              throw new Error(
                `Item ${itemId} not found or not tracked.`
              );
            }

            // Check if item can be in this location
            if (type === 'front' && !itemCheck.rows[0].can_be_front) {
              throw new Error(`Item ${itemId} cannot be stored in front`);
            }
            if (type === 'warehouse' && !itemCheck.rows[0].can_be_warehouse) {
              throw new Error(`Item ${itemId} cannot be stored in warehouse`);
            }

            const current =
              await client.query(
                `
                SELECT quantity
                FROM ${tableName}
                WHERE item_id = $1
                FOR UPDATE
                `,
                [itemId]
              );

            const currentQty =
              current.rows.length > 0
                ? num(
                    current.rows[0]
                      .quantity
                  )
                : 0;

            const newQty =
              currentQty + quantity;

            if (newQty < 0) {
              throw new Error(
                `Insufficient ${type} stock for item ${itemId}. Current: ${currentQty}, Adjustment: ${quantity}`
              );
            }

            await client.query(
              `
              INSERT INTO ${tableName} (
                item_id,
                quantity
              )
              VALUES ($1, $2)

              ON CONFLICT (item_id)
              DO UPDATE SET
                quantity =
                  EXCLUDED.quantity,

                updated_at =
                  CURRENT_TIMESTAMP
              `,
              [
                itemId,
                newQty
              ]
            );

            const itemResult =
              await client.query(
                `
                SELECT display_name
                FROM items
                WHERE id = $1
                `,
                [itemId]
              );

            const itemName =
              itemResult.rows.length > 0
                ? itemResult.rows[0]
                    .display_name
                : `Item ${itemId}`;

            await client.query(
              `
              INSERT INTO logs (
                user_id,
                username,
                action,
                description
              )
              VALUES ($1, $2, $3, $4)
              `,
              [
                req.user.id,
                req.user.username,
                'stock_correction',
                `Manual correction: ${itemName} (${type}) adjusted by ${quantity} (${currentQty} → ${newQty})`
              ]
            );
          }
        }
      );

      const stock =
        await getStockQuery(
          pool,
          true
        );

      res.json(stock);

    } catch (err) {

      console.error(
        'Stock correction error:',
        err
      );

      res.status(500).json({
        error:
          err.message ||
          'Failed to correct stock'
      });
    }
  }
);

/*
============================================================
STOCK DISCREPANCIES
============================================================
*/

router.post(
  '/discrepancy',
  verifyToken,
  requireWorker,
  async (req, res) => {
    const { itemId, expectedQuantity, actualQuantity, notes } = req.body;

    if (!itemId || expectedQuantity === undefined || actualQuantity === undefined) {
      return res.status(400).json({
        error: 'Item ID, expected quantity, and actual quantity are required.'
      });
    }

    try {
      await ensureDiscrepancySchema(pool);
      const result = await pool.query(
        `
        INSERT INTO stock_discrepancies (
          item_id,
          reported_by,
          expected_quantity,
          actual_quantity,
          notes,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING *
        `,
        [itemId, req.user.id, expectedQuantity, actualQuantity, notes || '']
      );

      await pool.query(
        `
        INSERT INTO logs (user_id, username, action, description)
        VALUES ($1, $2, $3, $4)
        `,
        [
          req.user.id,
          req.user.username,
          'discrepancy_reported',
          `Reported stock discrepancy for item ${itemId}: expected ${expectedQuantity}, actual ${actualQuantity}`
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Discrepancy report error:', err);
      res.status(500).json({
        error: err.message || 'Failed to report discrepancy'
      });
    }
  }
);

router.get(
  '/discrepancies',
  verifyToken,
  requireAdmin,
  async (req, res) => {
    try {
      await ensureDiscrepancySchema(pool);
      const result = await pool.query(
        `
        SELECT 
          sd.*,
          i.display_name AS item_name,
          u.username AS reported_by_name
        FROM stock_discrepancies sd
        JOIN items i ON sd.item_id = i.id
        JOIN users u ON sd.reported_by = u.id
        ORDER BY sd.created_at DESC
        `
      );
      res.json(result.rows);
    } catch (err) {
      console.error('Get discrepancies error:', err);
      res.status(500).json({
        error: 'Failed to get discrepancies'
      });
    }
  }
);

router.put(
  '/discrepancies/:id/resolve',
  verifyToken,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    try {
      await ensureDiscrepancySchema(pool);

      const result = await transaction(async client => {
        const discrepancyResult = await client.query(`
          SELECT sd.*, i.display_name AS item_name
          FROM stock_discrepancies sd
          JOIN items i ON i.id = sd.item_id
          WHERE sd.id = $1
          FOR UPDATE
        `, [id]);

        if (!discrepancyResult.rows.length) {
          throw new Error('Discrepancy not found.');
        }

        const d = discrepancyResult.rows[0];

        if (d.status === 'resolved') {
          return d;
        }

        // "Resolve" means accepting the worker's physical count.
        // The system quantity is corrected to the actual quantity counted.
        await client.query(`
          INSERT INTO warehouse_stock(item_id, quantity)
          VALUES($1, $2)
          ON CONFLICT(item_id)
          DO UPDATE SET quantity=EXCLUDED.quantity, updated_at=CURRENT_TIMESTAMP
        `, [d.item_id, num(d.actual_quantity)]);

        const updated = await client.query(`
          UPDATE stock_discrepancies
          SET status='resolved',
              reviewed_at=CURRENT_TIMESTAMP,
              reviewed_by=$1
          WHERE id=$2
          RETURNING *
        `, [req.user.id, id]);

        await client.query(`
          INSERT INTO logs(user_id, username, action, description)
          VALUES($1,$2,$3,$4)
        `, [
          req.user.id,
          req.user.username,
          'discrepancy_resolved',
          `Resolved discrepancy ${id} for ${d.item_name}: system ${d.expected_quantity} -> actual ${d.actual_quantity}. Warehouse stock corrected.`
        ]);

        return updated.rows[0];
      });

      res.json(result);
    } catch (err) {
      console.error('Resolve discrepancy error:', err);
      res.status(500).json({
        error: err.message || 'Failed to resolve discrepancy'
      });
    }
  }
);

/*
============================================================
UPDATE STAFF PRICE FOR ONE ITEM
ADMIN ONLY
============================================================
*/

router.put(
  '/items/:id/staff-price',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    const itemId =
      req.params.id;

    const staffPrice =
      num(
        req.body.staff_price
      );

    if (staffPrice < 0) {
      return res.status(400).json({
        error:
          'Staff price cannot be negative.'
      });
    }

    try {

      const result =
        await pool.query(
          `
          UPDATE items
          SET staff_price = $1
          WHERE id = $2
          RETURNING *
          `,
          [
            staffPrice,
            itemId
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          error:
            'Item not found'
        });
      }

      const item =
        result.rows[0];

      await pool.query(
        `
        INSERT INTO logs (
          user_id,
          username,
          action,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          req.user.id,
          req.user.username,
          'staff_price_updated',
          `Updated staff price for ${
            item.display_name ||
            item.name
          } to ${staffPrice.toFixed(2)} DT`
        ]
      );

      res.json(item);

    } catch (err) {

      console.error(
        'Staff price update error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to update staff price'
      });
    }
  }
);

/*
============================================================
UPDATE STAFF PRICES BY CATEGORY
ADMIN ONLY
============================================================
*/

router.put(
  '/staff-prices',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    const {
      coffee,
      water,
      soda
    } = req.body;

    try {

      const prices = {
        coffee:
          coffee !== undefined
            ? num(coffee)
            : null,

        water:
          water !== undefined
            ? num(water)
            : null,

        soda:
          soda !== undefined
            ? num(soda)
            : null
      };

      for (
        const [category, price]
        of Object.entries(prices)
      ) {

        if (
          price === null ||
          price < 0
        ) {
          continue;
        }

        let matcher = '';

        if (category === 'coffee') {
          matcher = `
            (
              LOWER(name) LIKE '%coffee%'
              OR LOWER(name) LIKE '%cafe%'
              OR LOWER(display_name) LIKE '%coffee%'
              OR LOWER(display_name) LIKE '%cafe%'
            )
          `;
        }

        if (category === 'water') {
          matcher = `
            (
              LOWER(name) LIKE '%water%'
              OR LOWER(name) LIKE '%eau%'
              OR LOWER(display_name) LIKE '%water%'
              OR LOWER(display_name) LIKE '%eau%'
            )
          `;
        }

        if (category === 'soda') {
          matcher = `
            (
              LOWER(name) LIKE '%soda%'
              OR LOWER(name) LIKE '%gazeuse%'
              OR LOWER(display_name) LIKE '%soda%'
              OR LOWER(display_name) LIKE '%gazeuse%'
            )
          `;
        }

        if (!matcher) {
          continue;
        }

        await pool.query(
          `
          UPDATE items
          SET staff_price = $1
          WHERE is_tracked = true
            AND ${matcher}
          `,
          [price]
        );
      }

      await pool.query(
        `
        INSERT INTO logs (
          user_id,
          username,
          action,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          req.user.id,
          req.user.username,
          'staff_prices_updated',
          `Updated staff prices: coffee=${prices.coffee}, water=${prices.water}, soda=${prices.soda}`
        ]
      );

      const stock =
        await getStockQuery(
          pool,
          true
        );

      res.json({
        success: true,
        stock
      });

    } catch (err) {

      console.error(
        'Category staff price error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to update staff prices'
      });
    }
  }
);

/*
============================================================
ALLOCATE STOCK
WORKER
============================================================
*/

router.post(
  '/allocate',
  verifyToken,
  requireWorker,
  async (req, res) => {

    const {
      allocations,
      shiftId
    } = req.body;

    if (
      !Array.isArray(allocations) ||
      allocations.length === 0
    ) {
      return res.status(400).json({
        error:
          'Allocations required'
      });
    }

    if (!shiftId) {
      return res.status(400).json({
        error:
          'Shift ID required'
      });
    }

    try {

      const allocated =
        await transaction(
          async client => {

            const shiftCheck =
              await client.query(
                `
                SELECT
                  id,
                  user_id,
                  status
                FROM shifts
                WHERE id = $1
                FOR UPDATE
                `,
                [shiftId]
              );

            if (
              shiftCheck.rows.length === 0
            ) {
              throw new Error(
                'Shift not found'
              );
            }

            const shift =
              shiftCheck.rows[0];

            if (
              shift.status !==
              'active'
            ) {
              throw new Error(
                'Shift is not active'
              );
            }

            if (
              String(
                shift.user_id
              ) !==
              String(req.user.id) &&
              req.user.role !==
                'admin'
            ) {
              throw new Error(
                'You can only allocate stock to your own shift'
              );
            }

            const result = [];

            for (
              const allocation
              of allocations
            ) {

              const itemId =
                allocation.itemId;

              const requested =
                num(
                  allocation.quantity
                );

              if (
                !itemId ||
                requested <= 0
              ) {
                continue;
              }

              const itemResult =
                await client.query(
                  `
                  SELECT *
                  FROM items
                  WHERE id = $1
                    AND is_tracked = true
                    AND visible_to_workers = true
                  `,
                  [itemId]
                );

              if (
                itemResult.rows.length ===
                0
              ) {
                throw new Error(
                  `Item ${itemId} is not available to workers.`
                );
              }

              // Check if item can be in front
              if (!itemResult.rows[0].can_be_front) {
                throw new Error(
                  `${itemResult.rows[0].display_name} cannot be stored in front.`
                );
              }

              const warehouse =
                await client.query(
                  `
                  SELECT quantity
                  FROM warehouse_stock
                  WHERE item_id = $1
                  FOR UPDATE
                  `,
                  [itemId]
                );

              const available =
                warehouse.rows.length
                  ? num(
                      warehouse.rows[0]
                        .quantity
                    )
                  : 0;

              if (
                requested >
                available
              ) {
                throw new Error(
                  `${itemResult.rows[0].display_name}: only ${available} available in warehouse.`
                );
              }

              await client.query(
                `
                UPDATE warehouse_stock
                SET
                  quantity =
                    quantity - $1,
                  updated_at =
                    CURRENT_TIMESTAMP
                WHERE item_id = $2
                `,
                [
                  requested,
                  itemId
                ]
              );

              await client.query(
                `
                INSERT INTO front_stock (
                  item_id,
                  quantity
                )
                VALUES ($1, $2)

                ON CONFLICT (item_id)
                DO UPDATE SET
                  quantity =
                    front_stock.quantity
                    + EXCLUDED.quantity,

                  updated_at =
                    CURRENT_TIMESTAMP
                `,
                [
                  itemId,
                  requested
                ]
              );

              await client.query(
                `
                INSERT INTO shift_additions (
                  shift_id,
                  item_id,
                  quantity,
                  notes
                )
                VALUES ($1, $2, $3, $4)
                `,
                [
                  shiftId,
                  itemId,
                  requested,
                  'Added mid-shift'
                ]
              );

              result.push({
                itemId,
                quantity: requested
              });
            }

            return result;
          }
        );

      const stock =
        await getStockQuery(
          pool,
          false
        );

      res.json({
        allocations: allocated,
        stock
      });

    } catch (err) {

      console.error(
        'Allocation error:',
        err
      );

      res.status(400).json({
        error:
          err.message ||
          'Failed to allocate stock'
      });
    }
  }
);

/*
============================================================
ADD NEW ITEM
ADMIN
============================================================
*/

router.post(
  '/items',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    await ensureStockSchema();
    const {
      name,
      display_name,
      unit,
      price,
      staff_price,
      is_fractional,
      is_tracked,
      default_shift_quantity,
      can_be_front,
      can_be_warehouse
    } = req.body;

    if (
      !name ||
      !display_name
    ) {
      return res.status(400).json({
        error:
          'Name and display name are required'
      });
    }

    try {

      const existing =
        await pool.query(
          `
          SELECT id
          FROM items
          WHERE name = $1
          `,
          [name]
        );

      if (
        existing.rows.length > 0
      ) {
        return res.status(400).json({
          error:
            'Item already exists'
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO items (
            name,
            display_name,
            unit,
            price,
            staff_price,
            is_fractional,
            is_tracked,
            visible_to_workers,
            default_shift_quantity,
            can_be_front,
            can_be_warehouse
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            true,
            $8,
            $9,
            $10
          )
          RETURNING *
          `,
          [
            name,
            display_name,
            unit || 'unit',
            num(price),
            num(staff_price),
            Boolean(
              is_fractional
            ),
            is_tracked !== false,
            num(
              default_shift_quantity
            ),
            can_be_front !== false,
            can_be_warehouse !== false
          ]
        );

      const item =
        result.rows[0];

      // Only create warehouse stock if item can be in warehouse
      if (item.can_be_warehouse) {
        await pool.query(
          `
          INSERT INTO warehouse_stock (
            item_id,
            quantity
          )
          VALUES ($1, 0)
          ON CONFLICT DO NOTHING
          `,
          [item.id]
        );
      }

      // Only create front stock if item can be in front
      if (item.can_be_front) {
        await pool.query(
          `
          INSERT INTO front_stock (
            item_id,
            quantity
          )
          VALUES ($1, 0)
          ON CONFLICT DO NOTHING
          `,
          [item.id]
        );
      }

      await pool.query(
        `
        INSERT INTO logs (
          user_id,
          username,
          action,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          req.user.id,
          req.user.username,
          'item_created',
          `Created new item: ${display_name} (Front: ${item.can_be_front}, Warehouse: ${item.can_be_warehouse})`
        ]
      );

      res.status(201).json(item);

    } catch (err) {

      console.error(
        'Add item error:',
        err
      );

      res.status(500).json({
        error:
          err.message ||
          'Failed to add item'
      });
    }
  }
);

/*
============================================================
DELETE ITEM
ADMIN ONLY
============================================================
*/

router.delete(
  '/items/:id',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    const itemId = req.params.id;

    try {
      // Check if item exists
      const itemCheck = await pool.query(
        `
        SELECT id, display_name, is_tracked
        FROM items
        WHERE id = $1
        `,
        [itemId]
      );

      if (itemCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Item not found'
        });
      }

      const item = itemCheck.rows[0];

      // Don't allow deletion if item is tracked (has stock)
      if (item.is_tracked) {
        // Check if there's any stock
        const stockCheck = await pool.query(
          `
          SELECT 
            COALESCE((SELECT quantity FROM warehouse_stock WHERE item_id = $1), 0) +
            COALESCE((SELECT quantity FROM front_stock WHERE item_id = $1), 0) as total
          `,
          [itemId]
        );

        if (stockCheck.rows[0].total > 0) {
          return res.status(400).json({
            error: `Cannot delete "${item.display_name}" because it has stock. Please remove all stock first.`
          });
        }
      }

      // Delete from stock tables first
      await pool.query(
        `DELETE FROM warehouse_stock WHERE item_id = $1`,
        [itemId]
      );
      await pool.query(
        `DELETE FROM front_stock WHERE item_id = $1`,
        [itemId]
      );

      // Delete the item
      await pool.query(
        `
        DELETE FROM items
        WHERE id = $1
        `,
        [itemId]
      );

      await pool.query(
        `
        INSERT INTO logs (
          user_id,
          username,
          action,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          req.user.id,
          req.user.username,
          'item_deleted',
          `Deleted item: ${item.display_name}`
        ]
      );

      res.json({
        success: true,
        message: `Item "${item.display_name}" deleted successfully.`
      });

    } catch (err) {

      console.error(
        'Delete item error:',
        err
      );

      res.status(500).json({
        error:
          err.message ||
          'Failed to delete item'
      });
    }
  }
);

/*
============================================================
GET ITEMS
ADMIN
============================================================
*/

router.get(
  '/items',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await pool.query(`
          SELECT
            i.id,
            i.name,
            i.display_name,
            i.unit,
            i.price,
            i.staff_price,
            i.is_fractional,
            i.visible_to_workers,
            i.default_shift_quantity,
            i.can_be_front,
            i.can_be_warehouse,

            COALESCE(
              ws.quantity,
              0
            ) AS warehouse_quantity,

            COALESCE(
              fs.quantity,
              0
            ) AS front_quantity

          FROM items i

          LEFT JOIN warehouse_stock ws
            ON i.id = ws.item_id

          LEFT JOIN front_stock fs
            ON i.id = fs.item_id

          WHERE i.is_tracked = true

          ORDER BY i.id
        `);

      res.json(
        result.rows.filter(
          item =>
            !isRamiGames(item)
        )
      );

    } catch (err) {

      console.error(
        'Get items error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to get items'
      });
    }
  }
);

/*
============================================================
VISIBILITY
ADMIN
============================================================
*/

router.put(
  '/items/:id/visibility',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    const {
      visible_to_workers
    } = req.body;

    try {

      const result =
        await pool.query(
          `
          UPDATE items
          SET visible_to_workers = $1
          WHERE id = $2
          RETURNING *
          `,
          [
            Boolean(
              visible_to_workers
            ),
            req.params.id
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          error:
            'Item not found'
        });
      }

      await pool.query(
        `
        INSERT INTO logs (
          user_id,
          username,
          action,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          req.user.id,
          req.user.username,
          'item_visibility',
          `Set visibility for ${
            result.rows[0]
              .display_name
          } to ${
            visible_to_workers
              ? 'visible'
              : 'hidden'
          }`
        ]
      );

      res.json(
        result.rows[0]
      );

    } catch (err) {

      console.error(
        'Visibility error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to update visibility'
      });
    }
  }
);

/*
============================================================
UPDATE SELLING PRICE
ADMIN ONLY
============================================================
*/
router.put(
  '/items/:id/price',
  verifyToken,
  requireAdmin,
  async (req, res) => {
    try {
      const price = num(req.body.price);
      if (price < 0) return res.status(400).json({ error: 'Price cannot be negative.' });
      const result = await pool.query(
        `UPDATE items SET price = $1 WHERE id = $2 RETURNING *`,
        [price, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Item not found' });
      await pool.query(
        `INSERT INTO logs (user_id, username, action, description) VALUES ($1,$2,$3,$4)`,
        [req.user.id, req.user.username, 'item_price_updated', `Updated selling price for ${result.rows[0].display_name || result.rows[0].name} to ${price.toFixed(2)} DT`]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Price update error:', err);
      res.status(500).json({ error: 'Failed to update price' });
    }
  }
);

/*
============================================================
DEFAULT SHIFT QUANTITY
============================================================
*/

router.put(
  '/items/:id/default-quantity',
  verifyToken,
  requireAdmin,
  async (req, res) => {

    try {

      const quantity =
        Math.max(
          0,
          num(
            req.body
              .default_shift_quantity
          )
        );

      const result =
        await pool.query(
          `
          UPDATE items
          SET default_shift_quantity = $1
          WHERE id = $2
          RETURNING *
          `,
          [
            quantity,
            req.params.id
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          error:
            'Item not found'
        });
      }

      res.json(
        result.rows[0]
      );

    } catch (err) {

      console.error(
        'Default quantity error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to update default quantity'
      });
    }
  }
);

/*
============================================================
GET SINGLE ITEM
MUST BE LAST
============================================================
*/

router.get(
  '/:itemId',
  verifyToken,
  async (req, res) => {

    const {
      itemId
    } = req.params;

    if (
      itemId === 'items'
    ) {
      return res.status(404).json({
        error:
          'Use /api/stock/items'
      });
    }

    try {

      const result =
        await pool.query(
          `
          SELECT
            i.id,
            i.name,
            i.display_name,
            i.unit,
            i.price,
            i.staff_price,
            i.is_fractional,
            i.visible_to_workers,
            i.default_shift_quantity,
            i.can_be_front,
            i.can_be_warehouse,

            COALESCE(
              ws.quantity,
              0
            ) AS warehouse_quantity,

            COALESCE(
              fs.quantity,
              0
            ) AS front_quantity

          FROM items i

          LEFT JOIN warehouse_stock ws
            ON i.id = ws.item_id

          LEFT JOIN front_stock fs
            ON i.id = fs.item_id

          WHERE i.id = $1
        `,
          [itemId]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          error:
            'Item not found'
        });
      }

      res.json(
        result.rows[0]
      );

    } catch (err) {

      console.error(
        'Get item error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to get item stock'
      });
    }
  }
);

console.log(
  '✅ Stock routes loaded successfully!'
);

module.exports = router;