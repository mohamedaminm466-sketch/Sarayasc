const express = require('express');
const { pool, transaction } = require('../db');
const {
  verifyToken,
  requireWorker
} = require('../middleware/auth');

const router = express.Router();

console.log('🔄 LOADING SHIFT ROUTES...');

// ============================================
// ENSURE RECETTE_ADJUSTMENTS COLUMN EXISTS
// ============================================

(async function ensureColumnExists() {
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'shifts'
          AND column_name = 'recette_adjustments'
        ) THEN
          ALTER TABLE shifts ADD COLUMN recette_adjustments JSONB DEFAULT '{}';
          RAISE NOTICE '✅ Added recette_adjustments column';
        END IF;
      END $$;
    `);
  } catch (err) {
    console.error('⚠️ Could not ensure recette_adjustments column:', err.message);
  }
})();

// Ensure additional columns exist
(async function ensureAdditionalColumns() {
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'chicha_kamia_used') THEN
          ALTER TABLE shifts ADD COLUMN chicha_kamia_used INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'eau05_used') THEN
          ALTER TABLE shifts ADD COLUMN eau05_used INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'chicha_kamia_adjustments') THEN
          ALTER TABLE shifts ADD COLUMN chicha_kamia_adjustments JSONB DEFAULT '[]';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'end_shift_stage') THEN
          ALTER TABLE shifts ADD COLUMN end_shift_stage VARCHAR(30) NOT NULL DEFAULT 'idle';
        END IF;
      END $$;
    `);
  } catch (err) {
    console.error('⚠️ Could not ensure additional columns:', err.message);
  }
})();

/*
============================================================
HELPERS
============================================================
*/

const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const int = value => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
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
    item?.display_name ||
    item?.name ||
    ''
  );

  return (
    name.includes('ramigames') ||
    name.includes('rami')
  );
};

const isCoffee = item => {
  const name = normalizeName(
    item?.display_name ||
    item?.name ||
    ''
  );

  return (
    name.includes('coffee') ||
    name.includes('cafe')
  );
};

const isWater = item => {
  const name = normalizeName(
    item?.display_name ||
    item?.name ||
    ''
  );

  return (
    name.includes('water') ||
    name.includes('eau')
  );
};

const isSoda = item => {
  const name = normalizeName(
    item?.display_name ||
    item?.name ||
    ''
  );

  return (
    name.includes('soda') ||
    name.includes('gazeuse') ||
    name.includes('boissongazeuse')
  );
};

const isCannette = item => {
  const name = normalizeName(
    item?.display_name ||
    item?.name ||
    ''
  );

  return (
    name.includes('cannette') ||
    name.includes('canette') ||
    name.includes('can') ||
    name.includes('boite')
  );
};

const isCoffeeBeans = item => {
  const name = normalizeName(
    item?.display_name ||
    item?.itemName ||
    item?.name ||
    ''
  );

  return (
    name.includes('coffeebeans') ||
    name.includes('coffeebean') ||
    name.includes('graincafe') ||
    name.includes('grainscafe') ||
    name.includes('cafengrain') ||
    name.includes('cafebeans')
  );
};

const isTombac = item => {
  const name = normalizeName(
    item?.display_name ||
    item?.itemName ||
    item?.name ||
    ''
  );

  return (
    name.includes('tombac') ||
    name.includes('tabacchicha') ||
    name.includes('chichatobacco')
  );
};

const toObject = value => {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }
    } catch (e) {
      // Keep the old safe fallback for invalid JSON.
    }
  }

  return {};
};

const toArray = value => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  // Backward compatibility with the old frontend format:
  // { productKey: { ...action } }
  if (value && typeof value === 'object') {
    return Object.values(value);
  }

  return [];
};

/*
============================================================
RAMI PAPER STOCK
============================================================
*/
let shiftSchemaReady = false;

const ensureAppSettings = async client => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await client.query(`INSERT INTO app_settings(key,value) VALUES ('chicha_price',7.00) ON CONFLICT(key) DO NOTHING`);
};

const getChichaPrice = async client => {
  // Source of truth: the Chicha price configured by the admin in Stock > Prix Chicha.
  await ensureAppSettings(client);
  const r = await client.query(`SELECT value FROM app_settings WHERE key='chicha_price'`);
  const price = num(r.rows[0]?.value);
  return price > 0 ? price : 0;
};

const ensureShiftSchema = async client => {
  if (shiftSchemaReady) return;
  await client.query(`
    ALTER TABLE shifts
      ADD COLUMN IF NOT EXISTS end_shift_stage VARCHAR(30) NOT NULL DEFAULT 'idle',
      ADD COLUMN IF NOT EXISTS rami_paper_opening INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rami_paper_added INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rami_paper_closing INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rami_paper_used INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS opening_warehouse_stock JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS closing_warehouse_stock JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS expenses_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS expenses_note TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS manque_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS manque_note TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS actual_cash_counted NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS final_shift_note TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS staff_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS recette_breakdown_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN NOT NULL DEFAULT false
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS rami_paper_stock (
      id INTEGER PRIMARY KEY DEFAULT 1,
      quantity INTEGER NOT NULL DEFAULT 0,
      last_added_at TIMESTAMP NULL,
      last_added_by INTEGER NULL REFERENCES users(id),
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await ensureAppSettings(client);
  await client.query(`
    INSERT INTO rami_paper_stock (id, quantity)
    VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING
  `);
  shiftSchemaReady = true;
};

const getRamiPaperStock = async client => {
  await ensureShiftSchema(client);
  const result = await client.query(`
    SELECT rps.quantity, rps.last_added_at, rps.last_added_by,
           u.username AS last_added_by_username, rps.updated_at
    FROM rami_paper_stock rps
    LEFT JOIN users u ON u.id = rps.last_added_by
    WHERE rps.id = 1
  `);
  return result.rows[0] || { quantity: 0, last_added_at: null, last_added_by: null, last_added_by_username: null, updated_at: null };
};

/*
============================================================
GET WORKER STOCK
============================================================
*/

const getWorkerStock = async client => {

  const result =
    await client.query(`
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
        AND i.visible_to_workers = true

      ORDER BY i.id
    `);

  return result.rows.filter(
    item =>
      !isRamiGames(item)
  );
};

/*
============================================================
GET ALL ITEMS
============================================================
*/

const getAllItems = async client => {

  const result =
    await client.query(`
      SELECT
        id,
        name,
        display_name,
        unit,
        price,
        staff_price,
        is_fractional,
        can_be_front,
        can_be_warehouse
      FROM items
      WHERE is_tracked = true
    `);

  return result.rows.filter(
    item =>
      !isRamiGames(item)
  );
};

/*
============================================================
BUILD ADDITIONS
============================================================
*/

const getShiftAdditions = async (
  client,
  shiftId
) => {

  const result =
    await client.query(
      `
      SELECT
        sa.id,
        sa.shift_id,
        sa.item_id,
        sa.quantity,
        sa.notes,
        sa.added_at,

        i.name,
        i.display_name,
        i.unit

      FROM shift_additions sa

      JOIN items i
        ON i.id = sa.item_id

      WHERE sa.shift_id = $1

      ORDER BY sa.added_at
      `,
      [shiftId]
    );

  return result.rows;
};

/*
============================================================
CALCULATE STOCK CONSUMPTION
============================================================
*/

const calculateStockConsumption = async (
  client,
  shift
) => {

  const opening =
    toObject(
      shift.opening_front_stock
    );

  const closing =
    toObject(
      shift.closing_front_stock
    );

  const openingWarehouse =
    toObject(
      shift.opening_warehouse_stock
    );

  const closingWarehouse =
    toObject(
      shift.closing_warehouse_stock
    );

  const additionsRows =
    await getShiftAdditions(
      client,
      shift.id
    );

  const additions = {};

  for (
    const row
    of additionsRows
  ) {

    const note =
      String(
        row.notes || ''
      ).toLowerCase();

    if (
      note.includes(
        'initial allocation'
      )
    ) {
      continue;
    }

    const itemId =
      String(
        row.item_id
      );

    additions[itemId] =
      num(
        additions[itemId]
      ) +
      num(
        row.quantity
      );
  }

  const items =
    await getAllItems(
      client
    );

  const itemMap = {};

  for (
    const item
    of items
  ) {
    itemMap[
      String(item.id)
    ] = item;
  }

  const ids =
    new Set([
      ...items.map(
        item => String(item.id)
      ),
      ...Object.keys(opening),
      ...Object.keys(closing),
      ...Object.keys(additions),
      ...Object.keys(openingWarehouse),
      ...Object.keys(closingWarehouse)
    ]);

  const consumption = [];

  for (
    const itemId
    of ids
  ) {

    const item =
      itemMap[
        String(itemId)
      ];

    if (!item) {
      continue;
    }

    const isWarehouseOnly = item.can_be_front === false;

    const openingQty = isWarehouseOnly
      ? num(openingWarehouse[itemId])
      : num(opening[itemId]);

    const addedQty = isWarehouseOnly
      ? 0
      : num(additions[itemId]);

    const availableQty =
      openingQty +
      addedQty;

    const closingQty = isWarehouseOnly
      ? (Object.prototype.hasOwnProperty.call(closingWarehouse, itemId)
        ? num(closingWarehouse[itemId])
        : openingQty)
      : num(closing[itemId]);

    const consumedQty =
      Math.max(
        0,
        availableQty -
        closingQty
      );

    consumption.push({
      itemId: item.id,
      item_id: item.id,

      itemName:
        item.display_name ||
        item.name,

      item_name:
        item.display_name ||
        item.name,

      name:
        item.display_name ||
        item.name,

      unit:
        item.unit ||
        'units',

      openingQuantity:
        openingQty,

      opening_quantity:
        openingQty,

      addedQuantity:
        addedQty,

      added_quantity:
        addedQty,

      availableQuantity:
        availableQty,

      available_quantity:
        availableQty,

      closingQuantity:
        closingQty,

      closing_quantity:
        closingQty,

      consumedQuantity:
        consumedQty,

      consumed_quantity:
        consumedQty
    });
  }

  return {
    consumption,
    additions: additionsRows
  };
};

/*
============================================================
FIND CONSUMED ITEM
============================================================
*/

const findConsumedQuantity = (
  consumption,
  matcher
) => {

  const row =
    consumption.find(
      item =>
        matcher(item)
    );

  if (!row) {
    return 0;
  }

  return num(
    row.consumedQuantity
  );
};

/*
============================================================
CALCULATE STAFF DEDUCTIONS
============================================================
*/

const calculateStaffDeductions = (
  items,
  staffConsumption
) => {

  const result = {
    coffeeQty: 0,
    waterQty: 0,
    sodaQty: 0,
    cannetteQty: 0,

    coffee: 0,
    water: 0,
    soda: 0,
    cannette: 0
  };

  const data = toObject(staffConsumption);

  result.coffeeQty = int(data.coffee);
  result.waterQty = int(data.water);
  result.sodaQty = int(data.soda);
  result.cannetteQty = int(
    data.cannette ?? data.cannettes
  );

  const coffeeItem =
    items.find(item => isCoffee(item));

  const waterItem =
    items.find(item => isWater(item));

  const sodaItem =
    items.find(item => isSoda(item));

  const cannetteItem =
    items.find(item => isCannette(item));

  if (coffeeItem) {
    result.coffee =
      result.coffeeQty *
      num(coffeeItem.staff_price);
  }

  if (waterItem) {
    result.water =
      result.waterQty *
      num(waterItem.staff_price);
  }

  if (sodaItem) {
    result.soda =
      result.sodaQty *
      num(sodaItem.staff_price);
  }

  if (cannetteItem) {
    result.cannette =
      result.cannetteQty *
      num(cannetteItem.staff_price);
  }

  return result;
};

// ============================================================
// FIXED: NORMALIZE CORRECTION ACTIONS - PRESERVE remove_from_cash
// ============================================================
const normalizeCorrectionActions = value => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(action => action && action.accepted !== false)
    .map(action => {
      const amount = Math.abs(num(action.amount));
      
      // FIX: Preserve the direction from the frontend
      // If direction is 'remove_from_cash', keep it as 'remove_from_cash'
      // If direction is 'add_to_cash', keep it as 'add_to_cash'
      let direction = action.direction;
      
      // If direction is missing or invalid, determine from difference
      if (!direction || direction === 'none') {
        const diff = num(action.difference ?? action.diff);
        direction = diff > 0 ? 'add_to_cash' : diff < 0 ? 'remove_from_cash' : 'none';
      }

      return {
        id: String(action.id || action.key || ''),
        product: String(action.product || action.label || ''),
        difference: num(action.difference ?? action.diff),
        quantity: Math.max(0, num(action.quantity)),
        unitPrice: Math.max(0, num(action.unitPrice ?? action.price)),
        amount: amount,
        direction: direction,
        accepted: action.accepted !== false
      };
    });
};

/*
============================================================
BUILD RECETTE BREAKDOWN - FIXED CALCULATION
============================================================
*/

const buildRecetteBreakdown = ({
  cash,
  ramiGamesUsed,
  staff,
  financialData = {},
  correctionActions = [],
  ramiPrice = 1.5
}) => {

  const financial =
    toObject(financialData);

  const corrections =
    normalizeCorrectionActions(
      correctionActions
    );

  // Calculate each component
  const cashAmount = num(cash);
  const ramiAmount = int(ramiGamesUsed) * num(ramiPrice);
  
  const staffCoffee = num(staff.coffee);
  const staffWater = num(staff.water);
  const staffSoda = num(staff.soda);
  const staffCannette = num(staff.cannette || 0);
  const staffTotal = staffCoffee + staffWater + staffSoda + staffCannette;

  const expenses = Math.max(0, num(financial.expensesAmount ?? financial.expenseAmount ?? 0));
  const staffSalary = Math.max(0, num(financial.staffSalary ?? 0));

  // Calculate corrections net impact
  let correctionAdded = 0;
  let correctionRemoved = 0;
  
  for (const action of corrections) {
    const amount = num(action.amount);
    if (action.direction === 'add_to_cash' || action.direction === 'add') {
      correctionAdded += amount;
    } else if (action.direction === 'remove_from_cash' || action.direction === 'remove') {
      correctionRemoved += amount;
    }
  }
  
  const correctionNet = correctionAdded - correctionRemoved;

  // Calculate final recette
  // Recette = Cash + Rami - Staff - Expenses - Salary + Corrections
  const final = cashAmount + ramiAmount - staffTotal - expenses - staffSalary + correctionNet;

  return {

    cash: cashAmount,

    ramiQuantity: int(ramiGamesUsed),
    ramiPrice: num(ramiPrice),
    rami: ramiAmount,

    staffCoffeeQuantity: staff.coffeeQty || 0,
    staffCoffeePrice: (staff.coffeeQty || 0) > 0 ? staffCoffee / (staff.coffeeQty || 1) : 0,
    staffCoffee: staffCoffee,

    staffWaterQuantity: staff.waterQty || 0,
    staffWaterPrice: (staff.waterQty || 0) > 0 ? staffWater / (staff.waterQty || 1) : 0,
    staffWater: staffWater,

    staffSodaQuantity: staff.sodaQty || 0,
    staffSodaPrice: (staff.sodaQty || 0) > 0 ? staffSoda / (staff.sodaQty || 1) : 0,
    staffSoda: staffSoda,

    staffCannetteQuantity: staff.cannetteQty || 0,
    staffCannettePrice: (staff.cannetteQty || 0) > 0 ? staffCannette / (staff.cannetteQty || 1) : 0,
    staffCannette: staffCannette,

    staffTotal: staffTotal,

    expenses: expenses,
    expensesNote: String(financial.expensesNote || financial.expenseNote || ''),

    staffSalary: staffSalary,

    correctionAdded: correctionAdded,
    correctionRemoved: correctionRemoved,
    correctionNet: correctionNet,
    correctionActions: corrections,

    beforeDeductions: cashAmount + ramiAmount + correctionNet,

    final: final
  };
};

/*
============================================================
BUILD SHIFT METRICS - FIXED water mapping
============================================================
*/

const buildShiftMetrics = (
  consumption,
  input
) => {

  const data =
    toObject(input);

  const getConsumed = (matcher) => {
    const item = consumption.find(item => matcher(item));
    return item ? num(item.consumedQuantity) : 0;
  };

  const water05Sold =
    int(
      data.water05Sold ??
      data.eau05Vendu
    );

  const water1Sold =
    int(
      data.water1Sold ??
      data.eau1Vendu
    );

  const water15Sold =
    int(
      data.water15Sold ??
      data.eau15Vendu
    );

  const waterBolarSold =
    int(
      data.waterBolarSold ??
      data.eauBolarVendu
    );

  const kamia =
    int(data.kamia);

  const water05Total =
    water05Sold + kamia;

  const cannettesSold =
    int(
      data.cannettesSold ??
      data.canettesVendu ??
      data.cansSold
    );

  const chichaTotal =
    int(
      data.chichaTotal
    );

  const chichaPersonnel =
    Math.min(
      int(
        data.chichaPersonnel
      ),
      chichaTotal
    );

  const normalChicha =
    Math.max(
      0,
      chichaTotal -
      chichaPersonnel
    );

  const express =
    int(data.express);

  const cappuccino =
    int(
      data.cappuccino ??
      data.capucin
    );

  const americain =
    int(data.americain);

  const filter =
    int(data.filter);

  const direct =
    int(data.direct);

  const coffeeCount =
    express +
    cappuccino +
    americain +
    filter +
    direct;

  const sodaSold =
    int(
      data.sodaSold ??
      data.gazeusesVendu
    );

  // FIX: EXACT matching for water types
  // EAU 0.5 - match exact item name containing 0.5 or 05
  const water05Consumed = getConsumed(item => {
    const name = normalizeName(item.name || '');
    const display = normalizeName(item.itemName || '');
    const combined = name + ' ' + display;
    return (
      (combined.includes('eau0.5') || combined.includes('water0.5') ||
       combined.includes('eau05') || combined.includes('water05') ||
       combined.includes('0.5')) &&
      !combined.includes('1.5') && !combined.includes('15') &&
      !combined.includes('1l') && !combined.includes('1 l') &&
      !combined.includes('1.0')
    );
  });

  // EAU 1L - EXACT match for 1L water only
  const water1Consumed = getConsumed(item => {
    const name = normalizeName(item.name || '');
    const display = normalizeName(item.itemName || '');
    const combined = name + ' ' + display;
    const hasEau1 = combined.includes('eau1') && !combined.includes('eau15') && !combined.includes('eau1.5');
    const hasWater1 = combined.includes('water1') && !combined.includes('water15') && !combined.includes('water1.5');
    const has1L = (combined.includes('1l') || combined.includes('1 l')) && !combined.includes('1.5');
    return (hasEau1 || hasWater1 || has1L) &&
           !combined.includes('0.5') && !combined.includes('05');
  });

  // EAU 1.5L - match exact item name containing 1.5
  const water15Consumed = getConsumed(item => {
    const name = normalizeName(item.name || '');
    const display = normalizeName(item.itemName || '');
    const combined = name + ' ' + display;
    return (
      (combined.includes('eau1.5') || combined.includes('water1.5') ||
       combined.includes('eau15') || combined.includes('water15') ||
       combined.includes('1.5')) &&
      !combined.includes('1l') && !combined.includes('1 l') &&
      !combined.includes('0.5') && !combined.includes('05')
    );
  });

  const waterBolarConsumed = getConsumed(item => {
    const name = normalizeName(item.name || '');
    const display = normalizeName(item.itemName || '');
    const combined = name + ' ' + display;
    return (
      combined.includes('eaubolar') ||
      combined.includes('waterbolar') ||
      combined.includes('bolar')
    );
  });

  const sodaConsumed = getConsumed(item => {
    const name = normalizeName(item.name || '');
    const display = normalizeName(item.itemName || '');
    const combined = name + ' ' + display;
    return (
      combined.includes('soda') ||
      combined.includes('gazeuse')
    );
  });

  const cannettesConsumed = getConsumed(item => {
    const name = normalizeName(item.name || '');
    const display = normalizeName(item.itemName || '');
    const combined = name + ' ' + display;
    return (
      combined.includes('cannette') ||
      combined.includes('canette') ||
      combined.includes('can') ||
      combined.includes('boite')
    );
  });

  const coffeeBeansConsumed = getConsumed(item => isCoffeeBeans(item));
  const tombacConsumed = getConsumed(item => isTombac(item));

  // FIX: Calculate water05 difference for correction
  const water05Difference = water05Total - water05Consumed;

  return {
    water05Sold,
    water1Sold,
    water15Sold,
    waterBolarSold,
    kamia,
    water05Total,
    water05Consumed,
    water1Consumed,
    water15Consumed,
    waterBolarConsumed,
    cannettesSold,
    cannettesConsumed,
    sodaSold,
    sodaConsumed,
    totalWaterSold:
      water05Total +
      water1Sold +
      water15Sold +
      waterBolarSold,
    totalWaterConsumed:
      water05Consumed +
      water1Consumed +
      water15Consumed +
      waterBolarConsumed,
    chichaTotal,
    chichaPersonnel,
    normalChicha,
    express,
    cappuccino,
    americain,
    filter,
    direct,
    coffeeCount,
    coffeeBeansConsumed,
    tombacConsumed,
    tombacPerNormalChicha:
      normalChicha > 0
        ? tombacConsumed /
          normalChicha
        : 0,
    coffeeBeansPerCoffee:
      coffeeCount > 0
        ? coffeeBeansConsumed /
          coffeeCount
        : 0,
    water05Difference: water05Difference,
    water1Difference:
      water1Sold - water1Consumed,
    water15Difference:
      water15Sold - water15Consumed,
    waterBolarDifference:
      waterBolarSold - waterBolarConsumed,
    sodaDifference:
      sodaSold - sodaConsumed,
    cannettesDifference:
      cannettesSold - cannettesConsumed
  };
};

/*
============================================================
START SHIFT
============================================================
*/

router.post(
  '/start',
  verifyToken,
  requireWorker,
  async (req, res) => {

    try {

      const result =
        await transaction(
          async client => {
            await ensureShiftSchema(client);

            const active =
              await client.query(
                `
                SELECT id
                FROM shifts
                WHERE user_id = $1
                  AND status = 'active'
                LIMIT 1
                `,
                [req.user.id]
              );

            if (
              active.rows.length > 0
            ) {
              throw new Error(
                'You already have an active shift.'
              );
            }

            const frontResult =
              await client.query(`
                SELECT
                  item_id,
                  quantity
                FROM front_stock
              `);

            const openingFrontStock = {};

            for (
              const row
              of frontResult.rows
            ) {

              openingFrontStock[
                String(
                  row.item_id
                )
              ] =
                num(
                  row.quantity
                );
            }

            // Get warehouse stock at start
            const warehouseResultAtStart = await client.query(`
              SELECT item_id, quantity FROM warehouse_stock
            `);
            const openingWarehouseStock = {};
            for (const row of warehouseResultAtStart.rows) {
              openingWarehouseStock[String(row.item_id)] = num(row.quantity);
            }

            const requested =
              toObject(
                req.body
                  .initialFrontStock
              );

            const requestedRamiPaperOpening =
              req.body.ramiPaperOpening === undefined || req.body.ramiPaperOpening === ''
                ? null
                : Math.max(0, Math.trunc(num(req.body.ramiPaperOpening)));

            if (requestedRamiPaperOpening !== null) {
              await client.query(`
                UPDATE rami_paper_stock
                SET quantity=$1, updated_at=CURRENT_TIMESTAMP
                WHERE id=1
              `, [requestedRamiPaperOpening]);
            }

            const actualAllocations = {};

            for (
              const [
                itemId,
                rawQuantity
              ]
              of Object.entries(
                requested
              )
            ) {

              const quantity =
                num(
                  rawQuantity
                );

              if (
                quantity <= 0
              ) {
                continue;
              }

              const itemResult =
                await client.query(
                  `
                  SELECT
                    id,
                    name,
                    display_name,
                    visible_to_workers,
                    can_be_front
                  FROM items
                  WHERE id = $1
                    AND is_tracked = true
                  `,
                  [itemId]
                );

              if (
                itemResult.rows.length ===
                0
              ) {
                throw new Error(
                  `Item ${itemId} not found.`
                );
              }

              const item =
                itemResult.rows[0];

              if (
                !item.visible_to_workers
              ) {
                throw new Error(
                  `${item.display_name} is hidden from workers.`
                );
              }

              if (!item.can_be_front) {
                throw new Error(
                  `${item.display_name} cannot be stored in front.`
                );
              }

              const warehouseResult =
                await client.query(
                  `
                  SELECT quantity
                  FROM warehouse_stock
                  WHERE item_id = $1
                  FOR UPDATE
                  `,
                  [itemId]
                );

              const warehouseQty =
                warehouseResult.rows.length
                  ? num(
                      warehouseResult
                        .rows[0]
                        .quantity
                    )
                  : 0;

              if (
                quantity >
                warehouseQty
              ) {
                throw new Error(
                  `${item.display_name}: requested ${quantity}, but only ${warehouseQty} available in warehouse.`
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
                  quantity,
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
                  quantity
                ]
              );

              openingFrontStock[
                String(itemId)
              ] =
                num(
                  openingFrontStock[
                    String(itemId)
                  ]
                ) +
                quantity;

              actualAllocations[
                String(itemId)
              ] =
                quantity;
            }

            const ramiPaper = await getRamiPaperStock(client);
            const ramiPaperOpening = requestedRamiPaperOpening === null ? Math.max(0, Math.trunc(num(ramiPaper.quantity))) : requestedRamiPaperOpening;

            const shiftResult =
              await client.query(
                `
                INSERT INTO shifts (
                  user_id,
                  opening_front_stock,
                  opening_warehouse_allocations,
                  opening_warehouse_stock,
                  rami_paper_opening,
                  rami_paper_added,
                  rami_paper_closing,
                  rami_paper_used,
                  end_shift_stage,
                  status,
                  is_finalized
                )
                VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
                )
                RETURNING id, start_time, status,
                          rami_paper_opening, rami_paper_added,
                          rami_paper_closing, rami_paper_used, end_shift_stage
                `,
                [
                  req.user.id,
                  JSON.stringify(openingFrontStock),
                  JSON.stringify(actualAllocations),
                  JSON.stringify(openingWarehouseStock),
                  ramiPaperOpening,
                  0,
                  ramiPaperOpening,
                  0,
                  'idle',
                  'active',
                  false
                ]
              );

            const shift =
              shiftResult.rows[0];

            for (
              const [
                itemId,
                quantity
              ]
              of Object.entries(
                actualAllocations
              )
            ) {

              await client.query(
                `
                INSERT INTO shift_additions (
                  shift_id,
                  item_id,
                  quantity,
                  notes
                )
                VALUES (
                  $1,
                  $2,
                  $3,
                  $4
                )
                `,
                [
                  shift.id,
                  itemId,
                  quantity,
                  'Initial allocation when shift started'
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
                'shift_started',
                `Started shift ${shift.id}. Previous remaining front stock was carried over automatically.`
              ]
            );

            const stock =
              await getWorkerStock(
                client
              );

            return {

              shift: {
                ...shift,

                opening_front_stock:
                  openingFrontStock,

                openingFrontStock:
                  openingFrontStock,

                allocations:
                  actualAllocations
              },

              stock,
              items: stock
            };
          }
        );

      res.json(result);

    } catch (err) {

      console.error(
        '❌ Start shift error:',
        err
      );

      res.status(400).json({
        error:
          err.message ||
          'Failed to start shift'
      });
    }
  }
);

/*
============================================================
ACTIVE SHIFT
============================================================
*/

router.get(
  '/active',
  verifyToken,
  requireWorker,
  async (req, res) => {

    try {
      await ensureShiftSchema(pool);

      const result =
        await pool.query(
          `
          SELECT
            s.*,
            u.username,
            u.full_name AS user_full_name

          FROM shifts s

          JOIN users u
            ON s.user_id = u.id

          WHERE s.status = 'active'
            AND ($1::integer IS NULL OR s.user_id = $1)

          ORDER BY s.start_time DESC

          LIMIT 1
          `,
          [req.user.role === 'admin' ? null : req.user.id]
        );

      if (
        result.rows.length === 0
      ) {

        return res.json({
          active: false,
          shift: null,
          stock: [],
          items: [],
          isFinalized: false
        });
      }

      const shift =
        result.rows[0];

      const ramiPaper = await getRamiPaperStock(pool);

      const additions =
        await getShiftAdditions(
          pool,
          shift.id
        );

      const stock =
        await getWorkerStock(
          pool
        );

      const hasPreview = shift.closing_front_stock !== null && shift.closing_front_stock !== undefined && Object.keys(shift.closing_front_stock || {}).length > 0;
      const endShiftStage = shift.end_shift_stage || (hasPreview ? 'preview' : 'idle');

      res.json({

        active: true,

        shift: {
          ...shift,

          openingFrontStock:
            toObject(
              shift.opening_front_stock
            ),

          initialFrontStock:
            toObject(
              shift.opening_front_stock
            ),

          additions,
          openingWarehouseStock: toObject(shift.opening_warehouse_stock),
          opening_warehouse_stock: toObject(shift.opening_warehouse_stock),
          hasPreview,
          endShiftStage,
          end_shift_stage: endShiftStage,
          isFinalized: shift.is_finalized || false,
          ramiPaperOpening: num(shift.rami_paper_opening),
          ramiPaperAdded: num(shift.rami_paper_added),
          ramiPaperClosing: num(shift.rami_paper_closing),
          ramiPaperUsed: num(shift.rami_paper_used),
          ramiPaperStock: ramiPaper
        },

        stock,
        items: stock
      });

    } catch (err) {

      console.error(
        '❌ Active shift error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to get active shift'
      });
    }
  }
);


/*
============================================================
RAMI PAPER
============================================================
*/
router.get('/rami-paper', verifyToken, requireWorker, async (req, res) => {
  try { res.json(await getRamiPaperStock(pool)); }
  catch (err) { res.status(500).json({ error: err.message || 'Failed to get Rami paper stock' }); }
});

router.post('/rami-paper/open', verifyToken, requireWorker, async (req, res) => {
  const shiftId = req.body.shiftId;
  const quantity = Math.trunc(num(req.body.quantity));
  if (!shiftId || quantity < 0) return res.status(400).json({ error: 'Shift ID and a valid opening quantity are required.' });
  try {
    const result = await transaction(async client => {
      await ensureShiftSchema(client);
      const q = await client.query(`SELECT id,user_id,status,is_finalized FROM shifts WHERE id=$1 FOR UPDATE`, [shiftId]);
      if (!q.rows.length) throw new Error('Shift not found.');
      const shift=q.rows[0];
      if (shift.status!=='active'||shift.is_finalized) throw new Error('Shift is not active.');
      if (String(shift.user_id)!==String(req.user.id)&&req.user.role!=='admin') throw new Error('You can only set paper for your own shift.');
      await client.query(`UPDATE rami_paper_stock SET quantity=$1,updated_at=CURRENT_TIMESTAMP WHERE id=1`,[quantity]);
      await client.query(`UPDATE shifts SET rami_paper_opening=$1,rami_paper_closing=$1,rami_paper_added=0,rami_paper_used=0,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[quantity,shiftId]);
      return getRamiPaperStock(client);
    });
    res.json({success:true,...result});
  } catch(err){ res.status(400).json({error:err.message||'Failed to set opening Rami paper'}); }
});

router.post('/rami-paper/add', verifyToken, requireWorker, async (req, res) => {
  const shiftId = req.body.shiftId;
  const quantity = Math.trunc(num(req.body.quantity));
  if (!shiftId || quantity <= 0) return res.status(400).json({ error: 'Shift ID and a positive quantity are required.' });
  try {
    const result = await transaction(async client => {
      await ensureShiftSchema(client);
      const q = await client.query(`SELECT id,user_id,status,is_finalized FROM shifts WHERE id=$1 FOR UPDATE`, [shiftId]);
      if (!q.rows.length) throw new Error('Shift not found.');
      const shift = q.rows[0];
      if (shift.status !== 'active' || shift.is_finalized) throw new Error('Shift is not active.');
      if (String(shift.user_id) !== String(req.user.id) && req.user.role !== 'admin') throw new Error('You can only add paper to your own shift.');
      await client.query(`UPDATE rami_paper_stock SET quantity=quantity+$1,last_added_at=CURRENT_TIMESTAMP,last_added_by=$2,updated_at=CURRENT_TIMESTAMP WHERE id=1`, [quantity, req.user.id]);
      await client.query(`UPDATE shifts SET rami_paper_added=COALESCE(rami_paper_added,0)+$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [quantity, shiftId]);
      await client.query(`INSERT INTO logs(user_id,username,action,description) VALUES($1,$2,$3,$4)`, [req.user.id,req.user.username,'rami_paper_added',`Added ${quantity} Rami paper(s) to shift ${shiftId}.`]);
      return getRamiPaperStock(client);
    });
    res.json({ success:true, ...result });
  } catch (err) { res.status(400).json({ error: err.message || 'Failed to add Rami paper' }); }
});

router.post('/rami-paper/close', verifyToken, requireWorker, async (req, res) => {
  const shiftId = req.body.shiftId;
  const closing = Math.trunc(num(req.body.closingQuantity));
  if (!shiftId || closing < 0) return res.status(400).json({ error:'Shift ID and a valid closing quantity are required.' });
  try {
    const result = await transaction(async client => {
      await ensureShiftSchema(client);
      const q = await client.query(`SELECT id,user_id,status,is_finalized,COALESCE(rami_paper_opening,0) rami_paper_opening,COALESCE(rami_paper_added,0) rami_paper_added FROM shifts WHERE id=$1 FOR UPDATE`, [shiftId]);
      if (!q.rows.length) throw new Error('Shift not found.');
      const shift=q.rows[0];
      if (shift.status!=='active'||shift.is_finalized) throw new Error('Shift is not active.');
      if (String(shift.user_id)!==String(req.user.id)&&req.user.role!=='admin') throw new Error('You can only close your own shift.');
      const available=Math.trunc(num(shift.rami_paper_opening)+num(shift.rami_paper_added));
      if (closing>available) throw new Error(`Closing Rami paper (${closing}) is greater than available (${available}).`);
      const used=available-closing;
      await client.query(`UPDATE rami_paper_stock SET quantity=$1,updated_at=CURRENT_TIMESTAMP WHERE id=1`,[closing]);
      await client.query(`UPDATE shifts SET rami_paper_closing=$1,rami_paper_used=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[closing,used,shiftId]);
      return { opening:num(shift.rami_paper_opening), added:num(shift.rami_paper_added), closing, used, stock:await getRamiPaperStock(client) };
    });
    res.json({success:true,...result});
  } catch(err){ res.status(400).json({error:err.message||'Failed to close Rami paper'}); }
});

/*
============================================================
ADD STOCK DURING SHIFT
============================================================
*/

router.post(
  '/:id/add-stock',
  verifyToken,
  requireWorker,
  async (req, res) => {

    const shiftId =
      req.params.id;

    const {
      allocations
    } = req.body;

    if (
      !Array.isArray(
        allocations
      ) ||
      allocations.length === 0
    ) {
      return res.status(400).json({
        error:
          'Please add at least one item.'
      });
    }

    try {

      const result =
        await transaction(
          async client => {

            const shiftResult =
              await client.query(
                `
                SELECT
                  id,
                  user_id,
                  status,
                  is_finalized
                FROM shifts
                WHERE id = $1
                FOR UPDATE
                `,
                [shiftId]
              );

            if (
              shiftResult.rows.length ===
              0
            ) {
              throw new Error(
                'Shift not found.'
              );
            }

            const shift =
              shiftResult.rows[0];

            if (
              shift.status !==
              'active'
            ) {
              throw new Error(
                'Shift is not active.'
              );
            }

            if (shift.is_finalized) {
              throw new Error(
                'Shift is already finalized. Cannot add more stock.'
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
                'You can only add stock to your own shift.'
              );
            }

            const allocated = [];

            for (
              const allocation
              of allocations
            ) {

              const itemId =
                allocation.itemId;

              const quantity =
                num(
                  allocation.quantity
                );

              if (
                quantity <= 0
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
                  `Item ${itemId} is not available.`
                );
              }

              if (!itemResult.rows[0].can_be_front) {
                throw new Error(
                  `${itemResult.rows[0].display_name} cannot be stored in front.`
                );
              }

              const warehouseResult =
                await client.query(
                  `
                  SELECT quantity
                  FROM warehouse_stock
                  WHERE item_id = $1
                  FOR UPDATE
                  `,
                  [itemId]
                );

              const warehouseQty =
                warehouseResult.rows.length
                  ? num(
                      warehouseResult
                        .rows[0]
                        .quantity
                    )
                  : 0;

              if (
                quantity >
                warehouseQty
              ) {
                throw new Error(
                  `${itemResult.rows[0].display_name}: only ${warehouseQty} available in warehouse.`
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
                  quantity,
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
                  quantity
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
                VALUES (
                  $1,
                  $2,
                  $3,
                  'Added mid-shift'
                )
                `,
                [
                  shiftId,
                  itemId,
                  quantity
                ]
              );

              allocated.push({
                itemId,
                quantity
              });
            }

            return allocated;
          }
        );

      const stock =
        await getWorkerStock(
          pool
        );

      res.json({
        allocations: result,
        stock,
        items: stock
      });

    } catch (err) {

      console.error(
        '❌ Add stock error:',
        err
      );

      res.status(400).json({
        error:
          err.message ||
          'Failed to add stock'
      });
    }
  }
);

/*
============================================================
PREVIEW SHIFT
============================================================
*/

router.post(
  '/:id/preview',
  verifyToken,
  requireWorker,
  async (req, res) => {

    const shiftId =
      req.params.id;

    try {

      const result =
        await transaction(
          async client => {
            await ensureShiftSchema(client);

            const shiftResult =
              await client.query(
                `
                SELECT
                  s.*,
                  u.username

                FROM shifts s

                JOIN users u
                  ON s.user_id = u.id

                WHERE s.id = $1
                  AND s.status = 'active'

                FOR UPDATE
                `,
                [shiftId]
              );

            if (
              shiftResult.rows.length ===
              0
            ) {
              throw new Error(
                'Active shift not found.'
              );
            }

            const shift =
              shiftResult.rows[0];

            if (shift.is_finalized) {
              throw new Error(
                'Shift is already finalized. Cannot preview.'
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
                'You can only preview your own shift.'
              );
            }

            const closingFrontStock =
              toObject(
                req.body
                  .closingFrontStock
              );

            const cashCollected =
              num(
                req.body
                  .cashCollected
              );

            const ramiGamesUsed =
              int(
                req.body
                  .ramiGamesUsed
              );

            const staffConsumption =
              toObject(
                req.body
                  .staffConsumption
              );

            const workerMessage =
              String(
                req.body
                  .workerMessage ||
                req.body.notes ||
                ''
              );

            const shiftMetricsInput =
              toObject(
                req.body
                  .shiftMetrics
              );

            const financialData =
              toObject(
                req.body
                  .financialData
              );

            const correctionActions =
              toArray(
                req.body.correctionActions ??
                req.body.recetteAdjustments ??
                []
              );

            const chichaKamiaAdjustments =
              toObject(
                req.body.chichaKamiaAdjustments ??
                req.body.chichaKamiaData?.adjustments ??
                {}
              );

            const expensesAmount = num(financialData.expensesAmount);
            const expensesNote = String(financialData.expensesNote || '');
            const staffSalary = num(financialData.staffSalary);

            const currentResult =
              await client.query(`
                SELECT
                  item_id,
                  quantity
                FROM front_stock
                FOR UPDATE
              `);

            const currentFront = {};

            for (
              const row
              of currentResult.rows
            ) {

              currentFront[
                String(
                  row.item_id
                )
              ] =
                num(
                  row.quantity
                );
            }

            const additionsRows =
              await getShiftAdditions(
                client,
                shiftId
              );

            const midShiftAdditions =
              {};

            for (
              const row
              of additionsRows
            ) {

              const note =
                String(
                  row.notes || ''
                ).toLowerCase();

              if (
                note.includes(
                  'initial allocation'
                )
              ) {
                continue;
              }

              const itemId =
                String(
                  row.item_id
                );

              midShiftAdditions[
                itemId
              ] =
                num(
                  midShiftAdditions[
                    itemId
                  ]
                ) +
                num(
                  row.quantity
                );
            }

            const opening =
              toObject(
                shift.opening_front_stock
              );

            const openingWarehouse = toObject(shift.opening_warehouse_stock);
            const currentWarehouseResult = await client.query(`
              SELECT item_id, quantity FROM warehouse_stock FOR UPDATE
            `);
            const currentWarehouse = {};
            for (const row of currentWarehouseResult.rows) {
              currentWarehouse[String(row.item_id)] = num(row.quantity);
            }
            const closingWarehouseStock = toObject(req.body.closingWarehouseStock);
            for (const item of await getAllItems(client)) {
              const id = String(item.id);
              if (!item.can_be_front) {
                const value = closingWarehouseStock[id] !== undefined ? num(closingWarehouseStock[id]) : currentWarehouse[id] ?? 0;
                closingWarehouseStock[id] = Math.max(0, value);
              }
            }

            for (
              const [
                itemId,
                rawQuantity
              ]
              of Object.entries(
                closingFrontStock
              )
            ) {

              const closingQty =
                num(rawQuantity);

              if (
                closingQty < 0
              ) {
                throw new Error(
                  `Closing quantity cannot be negative for item ${itemId}.`
                );
              }

              const available =
                num(
                  opening[itemId]
                ) +
                num(
                  midShiftAdditions[
                    itemId
                  ]
                );

              if (
                closingQty >
                available
              ) {
                throw new Error(
                  `Closing stock for item ${itemId} (${closingQty}) is greater than available shift stock (${available}).`
                );
              }
            }

            const allItemIds =
              new Set([
                ...Object.keys(
                  opening
                ),
                ...Object.keys(
                  midShiftAdditions
                ),
                ...Object.keys(
                  closingFrontStock
                )
              ]);

            for (const itemId of allItemIds) {
              if (closingFrontStock[itemId] === undefined) {
                // Omitted means "unchanged", not zero.
                closingFrontStock[itemId] = num(currentFront[itemId]);
              }
            }

            const warehouseConsumption = [];
            const allWarehouseIds = new Set([
              ...Object.keys(openingWarehouse),
              ...Object.keys(closingWarehouseStock)
            ]);
            for (const itemId of allWarehouseIds) {
              const item = (await getAllItems(client)).find(x => String(x.id) === String(itemId));
              if (!item || item.can_be_front) continue;
              const openingQty = num(openingWarehouse[itemId]);
              const closingQty = num(closingWarehouseStock[itemId]);
              const consumedQty = Math.max(0, openingQty - closingQty);
              warehouseConsumption.push({
                itemId: item.id,
                item_id: item.id,
                itemName: item.display_name || item.name,
                item_name: item.display_name || item.name,
                name: item.display_name || item.name,
                unit: item.unit || 'units',
                openingQuantity: openingQty,
                opening_quantity: openingQty,
                addedQuantity: 0,
                added_quantity: 0,
                availableQuantity: openingQty,
                available_quantity: openingQty,
                closingQuantity: closingQty,
                closing_quantity: closingQty,
                consumedQuantity: consumedQty,
                consumed_quantity: consumedQty
              });
            }

            const items =
              await getAllItems(
                client
              );

            const itemMap = {};

            for (
              const item
              of items
            ) {
              itemMap[
                String(item.id)
              ] = item;
            }

            const stockConsumption = [];

            for (
              const itemId
              of allItemIds
            ) {

              const item =
                itemMap[
                  String(itemId)
                ];

              if (!item) {
                continue;
              }

              const openingQty =
                num(
                  opening[itemId]
                );

              const addedQty =
                num(
                  midShiftAdditions[
                    itemId
                  ]
                );

              const availableQty =
                openingQty +
                addedQty;

              const closingQty =
                num(
                  closingFrontStock[
                    itemId
                  ]
                );

              const consumedQty =
                Math.max(
                  0,
                  availableQty -
                  closingQty
                );

              stockConsumption.push({
                itemId: item.id,
                item_id: item.id,

                itemName:
                  item.display_name ||
                  item.name,

                item_name:
                  item.display_name ||
                  item.name,

                name:
                  item.display_name ||
                  item.name,

                unit:
                  item.unit ||
                  'units',

                openingQuantity:
                  openingQty,

                opening_quantity:
                  openingQty,

                addedQuantity:
                  addedQty,

                added_quantity:
                  addedQty,

                availableQuantity:
                  availableQty,

                available_quantity:
                  availableQty,

                closingQuantity:
                  closingQty,

                closing_quantity:
                  closingQty,

                consumedQuantity:
                  consumedQty,

                consumed_quantity:
                  consumedQty
              });
            }

            // Merge with warehouse consumption
            stockConsumption.push(...warehouseConsumption);

            const chichaTotal = int(shiftMetricsInput.chichaTotal || 0);
            const kamia = int(shiftMetricsInput.kamia || 0);
            const chichaKamiaDifference = chichaTotal - kamia;
            
            // FIX: Get water consumption with exact matching
            const water05Consumed = stockConsumption.find(item =>
              normalizeName(item.name).includes('eau05') ||
              normalizeName(item.name).includes('water05') ||
              (normalizeName(item.name).includes('0.5') && !normalizeName(item.name).includes('1.5'))
            )?.consumedQuantity || 0;

            const water1Consumed = stockConsumption.find(item => {
              const name = normalizeName(item.name || '');
              return (name.includes('eau1') && !name.includes('eau15') && !name.includes('eau1.5')) ||
                     (name.includes('water1') && !name.includes('water15') && !name.includes('water1.5')) ||
                     ((name.includes('1l') || name.includes('1 l')) && !name.includes('1.5'));
            })?.consumedQuantity || 0;

            const water15Consumed = stockConsumption.find(item =>
              normalizeName(item.name).includes('eau15') ||
              normalizeName(item.name).includes('water15') ||
              normalizeName(item.name).includes('1.5')
            )?.consumedQuantity || 0;

            const waterBolarConsumed = stockConsumption.find(item =>
              normalizeName(item.name).includes('eaubolar') ||
              normalizeName(item.name).includes('waterbolar') ||
              normalizeName(item.name).includes('bolar')
            )?.consumedQuantity || 0;

            const chichaKamiaData = {
              chichaTotal: chichaTotal,
              kamia: kamia,
              difference: chichaKamiaDifference,
              adjustments: chichaKamiaAdjustments,
              water05Consumed: water05Consumed,
              eau05Used: int(shiftMetricsInput.eau05Used || 0),
              selectedAdjustments: chichaKamiaAdjustments
            };

            await client.query(
              `
              UPDATE shifts
              SET
                closing_front_stock = $1,
                closing_warehouse_stock = $2,
                cash_collected = $3,
                rami_games_used = $4,
                staff_consumption = $5,
                notes = $6,
                water_05_sold = $7,
                water_1_sold = $8,
                water_15_sold = $9,
                water_bolar_sold = $10,
                kamia = $11,
                water_05_consumed = $12,
                water_1_consumed = $13,
                water_15_consumed = $14,
                water_bolar_consumed = $15,
                soda_sold = $16,
                soda_consumed = $17,
                cannettes_sold = $18,
                cannettes_consumed = $19,
                chicha_total = $20,
                chicha_personnel = $21,
                chicha_normal = $22,
                coffee_express = $23,
                coffee_cappuccino = $24,
                coffee_americain = $25,
                coffee_filter = $26,
                coffee_direct = $27,
                coffee_total = $28,
                coffee_beans_used = $29,
                tombac_used = $30,
                expenses_amount = $31,
                expenses_note = $32,
                staff_salary = $33,
                correction_actions = $34,
                actual_cash_counted = $35,
                final_shift_note = $36,
                chicha_kamia_used = $37,
                eau05_used = $38,
                chicha_kamia_adjustments = $39,
                end_shift_stage = $40,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = $41
              `,
              [
                JSON.stringify(closingFrontStock),
                JSON.stringify(closingWarehouseStock),
                cashCollected,
                ramiGamesUsed,
                JSON.stringify(staffConsumption),
                workerMessage,
                shiftMetricsInput.water05Sold || 0,
                shiftMetricsInput.water1Sold || 0,
                shiftMetricsInput.water15Sold || 0,
                shiftMetricsInput.waterBolarSold || 0,
                shiftMetricsInput.kamia || 0,
                water05Consumed,
                water1Consumed,
                water15Consumed,
                waterBolarConsumed,
                shiftMetricsInput.sodaSold || 0,
                stockConsumption.find(item => normalizeName(item.name).includes('soda') || normalizeName(item.name).includes('gazeuse'))?.consumedQuantity || 0,
                shiftMetricsInput.cannettesSold || 0,
                stockConsumption.find(item => normalizeName(item.name).includes('cannette') || normalizeName(item.name).includes('canette'))?.consumedQuantity || 0,
                chichaTotal,
                int(shiftMetricsInput.chichaPersonnel || 0),
                Math.max(0, chichaTotal - int(shiftMetricsInput.chichaPersonnel || 0)),
                int(shiftMetricsInput.express || 0),
                int(shiftMetricsInput.cappuccino || 0),
                int(shiftMetricsInput.americain || 0),
                int(shiftMetricsInput.filter || 0),
                int(shiftMetricsInput.direct || 0),
                (int(shiftMetricsInput.express || 0) + int(shiftMetricsInput.cappuccino || 0) + int(shiftMetricsInput.americain || 0) + int(shiftMetricsInput.filter || 0) + int(shiftMetricsInput.direct || 0)),
                stockConsumption.find(item => isCoffeeBeans(item))?.consumedQuantity || 0,
                stockConsumption.find(item => isTombac(item))?.consumedQuantity || 0,
                expensesAmount,
                expensesNote,
                staffSalary,
                JSON.stringify(correctionActions),
                num(req.body.actualCashCounted || 0),
                String(req.body.finalShiftNote || ''),
                chichaTotal - kamia,
                int(shiftMetricsInput.eau05Used || 0),
                JSON.stringify(chichaKamiaAdjustments),
                String(req.body.endShiftStage || 'preview'),
                shiftId
              ]
            );

            await client.query(`UPDATE shifts SET closing_warehouse_stock=$1 WHERE id=$2`, [JSON.stringify(closingWarehouseStock), shiftId]);

            const staff =
              calculateStaffDeductions(
                items,
                staffConsumption
              );

            const shiftMetrics =
              buildShiftMetrics(
                stockConsumption,
                shiftMetricsInput
              );

            shiftMetrics.chichaKamiaDifference = chichaKamiaDifference;
            shiftMetrics.eau05Used = int(shiftMetricsInput.eau05Used || 0);
            shiftMetrics.chichaKamiaAdjustments = chichaKamiaAdjustments;
            shiftMetrics.water05Consumed = water05Consumed;
            shiftMetrics.water05Sold = int(shiftMetricsInput.water05Sold || 0);
            shiftMetrics.water1Consumed = water1Consumed;
            shiftMetrics.water15Consumed = water15Consumed;
            shiftMetrics.waterBolarConsumed = waterBolarConsumed;

            const recetteBreakdown =
              buildRecetteBreakdown({
                cash: cashCollected,
                ramiGamesUsed,
                staff,
                financialData,
                correctionActions
              });

            // Resolve Chicha price server-side so workers receive the admin-configured value.
            const chichaPrice = await getChichaPrice(client);
            recetteBreakdown.chichaPrice = chichaPrice;

            const finalRecette = recetteBreakdown.final;
            const expectedCashFinal =
              num(recetteBreakdown.cash) +
              num(recetteBreakdown.correctionNet) -
              num(recetteBreakdown.expenses) -
              num(recetteBreakdown.staffSalary);

            return {
              shiftId,
              recette: finalRecette,
              finalRecette,
              recetteBreakdown,
              recette_breakdown: recetteBreakdown,
              stockConsumption,
              stock_consumption: stockConsumption,
              consumedItems: stockConsumption,
              consumed_items: stockConsumption,
              shiftMetrics,
              shift_metrics: shiftMetrics,
              financialData: { expensesAmount, expensesNote, expenseAmount: expensesAmount, expenseNote: expensesNote, staffSalary, manqueAmount: num(req.body.actualCashCounted || 0) ? Math.max(0, expectedCashFinal - num(req.body.actualCashCounted)) : 0, manqueNote: '' },
              financial_data: { expensesAmount, expensesNote, staffSalary },
              workerMessage,
              worker_message: workerMessage,
              correctionActions,
              correction_actions: correctionActions,
              actualCashCounted: num(req.body.actualCashCounted || 0),
              finalShiftNote: String(req.body.finalShiftNote || ''),
              chichaKamiaData: chichaKamiaData,
              isPreview: true
            };
          }
        );

      res.json(result);

    } catch (err) {

      console.error(
        '❌ Preview shift error:',
        err
      );

      res.status(400).json({
        error:
          err.message ||
          'Failed to preview shift'
      });
    }
  }
);

/*
============================================================
END SHIFT PROGRESS (SAVE CASH COUNTING)
============================================================
*/

router.post('/:id/end-progress', verifyToken, requireWorker, async (req, res) => {
  const shiftId = req.params.id;
  try {
    const current = await pool.query(`SELECT * FROM shifts WHERE id=$1 AND status='active' AND is_finalized=false AND user_id=$2`, [shiftId, req.user.id]);
    if (!current.rows.length) return res.status(404).json({error:'Active shift not found or not owned by you.'});
    const shift=current.rows[0];
    let rb={};
    try { rb=typeof shift.recette_breakdown_data==='string' ? JSON.parse(shift.recette_breakdown_data||'{}') : (shift.recette_breakdown_data||{}); } catch(e) { rb={}; }
    const expectedCash =
      num(rb.cash) +
      num(rb.correctionNet) -
      num(rb.expenses) -
      num(rb.staffSalary);

    const actual=req.body.actualCashCounted==='' || req.body.actualCashCounted==null ? null : num(req.body.actualCashCounted);
    const manque=actual==null ? 0 : Math.max(0, expectedCash-actual);
    const manqueNote=req.body.manqueNote || (actual==null ? '' : (manque>0 ? `Manque calculé automatiquement: ${manque.toFixed(2)} DT` : 'Aucun manque.'));
    const result=await pool.query(`UPDATE shifts SET actual_cash_counted=$1, final_shift_note=$2, manque_amount=$3, manque_note=$4, end_shift_stage='recording', updated_at=CURRENT_TIMESTAMP WHERE id=$5 RETURNING id,actual_cash_counted,final_shift_note,manque_amount,manque_note,end_shift_stage`, [actual,String(req.body.finalShiftNote||''),manque,manqueNote,shiftId]);
    res.json({success:true,endShiftStage:'recording',end_shift_stage:'recording',actualCashCounted:result.rows[0].actual_cash_counted,finalShiftNote:result.rows[0].final_shift_note||'',manqueAmount:num(result.rows[0].manque_amount),manqueNote:result.rows[0].manque_note||''});
  } catch(err){ console.error('End progress error:',err); res.status(400).json({error:err.message||'Failed to save end-shift progress'}); }
});

/*
============================================================
END SHIFT
============================================================
*/

router.post(
  '/:id/end',
  verifyToken,
  requireWorker,
  async (req, res) => {

    const shiftId =
      req.params.id;

    try {

      const result =
        await transaction(
          async client => {
            await ensureShiftSchema(client);

            const shiftResult =
              await client.query(
                `
                SELECT
                  s.*,
                  u.username

                FROM shifts s

                JOIN users u
                  ON s.user_id = u.id

                WHERE s.id = $1
                  AND s.status = 'active'

                FOR UPDATE
                `,
                [shiftId]
              );

            if (
              shiftResult.rows.length ===
              0
            ) {
              throw new Error(
                'Active shift not found.'
              );
            }

            const shift =
              shiftResult.rows[0];

            if (shift.is_finalized) {
              throw new Error(
                'Shift is already finalized. Cannot end again.'
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
                'You can only end your own shift.'
              );
            }

            const closingFrontStock =
              toObject(
                req.body
                  .closingFrontStock
              );

            const currentFrontResult = await client.query(`
              SELECT item_id, quantity FROM front_stock
            `);
            for (const row of currentFrontResult.rows) {
              const key = String(row.item_id);
              if (closingFrontStock[key] === undefined) {
                closingFrontStock[key] = num(row.quantity);
              }
            }

            const persistedClosingWarehouseStock =
              toObject(shift.closing_warehouse_stock);

            const requestedClosingWarehouseStock =
              toObject(req.body.closingWarehouseStock);

            const closingWarehouseStock =
              Object.keys(requestedClosingWarehouseStock).length > 0
                ? requestedClosingWarehouseStock
                : persistedClosingWarehouseStock;

            const currentWarehouseResult = await client.query(`
              SELECT item_id, quantity FROM warehouse_stock
            `);
            for (const row of currentWarehouseResult.rows) {
              const key = String(row.item_id);
              if (closingWarehouseStock[key] === undefined) {
                const item = (await getAllItems(client)).find(x => String(x.id) === key);
                if (item && !item.can_be_front) {
                  closingWarehouseStock[key] =
                    persistedClosingWarehouseStock[key] !== undefined
                      ? num(persistedClosingWarehouseStock[key])
                      : num(row.quantity);
                }
              }
            }

            const cashCollected =
              num(
                req.body
                  .cashCollected
              );

            const ramiGamesUsed =
              int(
                req.body
                  .ramiGamesUsed
              );

            const ramiPaperOpening = Math.max(0, Math.trunc(num(shift.rami_paper_opening)));
            const ramiPaperAdded = Math.max(0, Math.trunc(num(shift.rami_paper_added)));
            const ramiPaperClosing = req.body.ramiPaperClosing === undefined
              ? Math.max(0, Math.trunc(num(shift.rami_paper_closing)))
              : Math.max(0, Math.trunc(num(req.body.ramiPaperClosing)));
            const ramiPaperUsed = Math.max(0, ramiPaperOpening + ramiPaperAdded - ramiPaperClosing);

            const staffConsumption =
              toObject(
                req.body
                  .staffConsumption
              );

            const workerMessage =
              String(
                req.body
                  .workerMessage ||
                req.body.notes ||
                ''
              );

            const shiftMetricsInput =
              toObject(
                req.body
                  .shiftMetrics
              );

            const financialData =
              toObject(
                req.body
                  .financialData
              );

            const correctionActions =
              toArray(
                req.body.correctionActions ??
                req.body.recetteAdjustments ??
                []
              );

            const chichaKamiaAdjustments =
              toObject(
                req.body.chichaKamiaAdjustments ??
                req.body.chichaKamiaData?.adjustments ??
                {}
              );

            const expensesAmount = num(financialData.expensesAmount);
            const expensesNote = String(financialData.expensesNote || '');
            const staffSalary = num(financialData.staffSalary);

            const currentResult =
              await client.query(`
                SELECT
                  item_id,
                  quantity
                FROM front_stock
                FOR UPDATE
              `);

            const currentFront = {};

            for (
              const row
              of currentResult.rows
            ) {

              currentFront[
                String(
                  row.item_id
                )
              ] =
                num(
                  row.quantity
                );
            }

            const additionsRows =
              await getShiftAdditions(
                client,
                shiftId
              );

            const midShiftAdditions =
              {};

            for (
              const row
              of additionsRows
            ) {

              const note =
                String(
                  row.notes || ''
                ).toLowerCase();

              if (
                note.includes(
                  'initial allocation'
                )
              ) {
                continue;
              }

              const itemId =
                String(
                  row.item_id
                );

              midShiftAdditions[
                itemId
              ] =
                num(
                  midShiftAdditions[
                    itemId
                  ]
                ) +
                num(
                  row.quantity
                );
            }

            const opening =
              toObject(
                shift.opening_front_stock
              );

            for (
              const [
                itemId,
                rawQuantity
              ]
              of Object.entries(
                closingFrontStock
              )
            ) {

              const closingQty =
                num(rawQuantity);

              if (
                closingQty < 0
              ) {
                throw new Error(
                  `Closing quantity cannot be negative for item ${itemId}.`
                );
              }

              const available =
                num(
                  opening[itemId]
                ) +
                num(
                  midShiftAdditions[
                    itemId
                  ]
                );

              if (
                closingQty >
                available
              ) {
                throw new Error(
                  `Closing stock for item ${itemId} (${closingQty}) is greater than available shift stock (${available}).`
                );
              }
            }

            const allItemIds =
              new Set([
                ...Object.keys(
                  opening
                ),
                ...Object.keys(
                  midShiftAdditions
                ),
                ...Object.keys(
                  closingFrontStock
                )
              ]);

            for (
              const itemId
              of allItemIds
            ) {

              if (closingFrontStock[itemId] === undefined) {
                closingFrontStock[itemId] = num(currentFront[itemId]);
              }
            }

            const items =
              await getAllItems(
                client
              );

            const itemMap = {};

            for (
              const item
              of items
            ) {
              itemMap[
                String(item.id)
              ] = item;
            }

            const stockConsumption = [];

            for (
              const itemId
              of allItemIds
            ) {

              const item =
                itemMap[
                  String(itemId)
                ];

              if (!item) {
                continue;
              }

              const openingQty =
                num(
                  opening[itemId]
                );

              const addedQty =
                num(
                  midShiftAdditions[
                    itemId
                  ]
                );

              const availableQty =
                openingQty +
                addedQty;

              const closingQty =
                num(
                  closingFrontStock[
                    itemId
                  ]
                );

              const consumedQty =
                Math.max(
                  0,
                  availableQty -
                  closingQty
                );

              stockConsumption.push({
                itemId: item.id,
                item_id: item.id,

                itemName:
                  item.display_name ||
                  item.name,

                item_name:
                  item.display_name ||
                  item.name,

                name:
                  item.display_name ||
                  item.name,

                unit:
                  item.unit ||
                  'units',

                openingQuantity:
                  openingQty,

                opening_quantity:
                  openingQty,

                addedQuantity:
                  addedQty,

                added_quantity:
                  addedQty,

                availableQuantity:
                  availableQty,

                available_quantity:
                  availableQty,

                closingQuantity:
                  closingQty,

                closing_quantity:
                  closingQty,

                consumedQuantity:
                  consumedQty,

                consumed_quantity:
                  consumedQty
              });
            }

            const openingWarehouse = toObject(shift.opening_warehouse_stock);
            const warehouseConsumption = [];
            const allWarehouseIds = new Set([...Object.keys(openingWarehouse), ...Object.keys(closingWarehouseStock)]);
            for (const itemId of allWarehouseIds) {
              const item = items.find(x => String(x.id) === String(itemId));
              if (!item || item.can_be_front) continue;
              const openingQty = num(openingWarehouse[itemId]);
              const closingQty = num(closingWarehouseStock[itemId]);
              const consumedQty = Math.max(0, openingQty - closingQty);
              warehouseConsumption.push({
                itemId: item.id,
                item_id: item.id,
                itemName: item.display_name || item.name,
                item_name: item.display_name || item.name,
                name: item.display_name || item.name,
                unit: item.unit || 'units',
                openingQuantity: openingQty,
                opening_quantity: openingQty,
                addedQuantity: 0,
                added_quantity: 0,
                availableQuantity: openingQty,
                available_quantity: openingQty,
                closingQuantity: closingQty,
                closing_quantity: closingQty,
                consumedQuantity: consumedQty,
                consumed_quantity: consumedQty
              });
            }

            // Merge warehouse consumption
            stockConsumption.push(...warehouseConsumption);

            for (
              const [
                itemId,
                quantity
              ]
              of Object.entries(
                closingFrontStock
              )
            ) {

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
                    EXCLUDED.quantity,

                  updated_at =
                    CURRENT_TIMESTAMP
                `,
                [
                  itemId,
                  num(quantity)
                ]
              );
            }

            for (const [itemId, quantity] of Object.entries(closingWarehouseStock)) {
              const item = items.find(x => String(x.id) === String(itemId));
              if (item && !item.can_be_front) {
                await client.query(
                  `
                  INSERT INTO warehouse_stock (
                    item_id,
                    quantity
                  )
                  VALUES ($1, $2)
                  ON CONFLICT (item_id)
                  DO UPDATE SET
                    quantity = EXCLUDED.quantity,
                    updated_at = CURRENT_TIMESTAMP
                  `,
                  [itemId, num(quantity)]
                );
              }
            }

            const staff =
              calculateStaffDeductions(
                items,
                staffConsumption
              );

            const chichaTotal = int(shiftMetricsInput.chichaTotal || 0);
            const kamia = int(shiftMetricsInput.kamia || 0);
            const chichaKamiaDifference = chichaTotal - kamia;
            
            // FIX: Get water consumption with exact matching
            const water05Consumed = stockConsumption.find(item =>
              normalizeName(item.name).includes('eau05') ||
              normalizeName(item.name).includes('water05') ||
              (normalizeName(item.name).includes('0.5') && !normalizeName(item.name).includes('1.5'))
            )?.consumedQuantity || 0;

            const water1Consumed = stockConsumption.find(item => {
              const name = normalizeName(item.name || '');
              return (name.includes('eau1') && !name.includes('eau15') && !name.includes('eau1.5')) ||
                     (name.includes('water1') && !name.includes('water15') && !name.includes('water1.5')) ||
                     ((name.includes('1l') || name.includes('1 l')) && !name.includes('1.5'));
            })?.consumedQuantity || 0;

            const water15Consumed = stockConsumption.find(item =>
              normalizeName(item.name).includes('eau15') ||
              normalizeName(item.name).includes('water15') ||
              normalizeName(item.name).includes('1.5')
            )?.consumedQuantity || 0;

            const waterBolarConsumed = stockConsumption.find(item =>
              normalizeName(item.name).includes('eaubolar') ||
              normalizeName(item.name).includes('waterbolar') ||
              normalizeName(item.name).includes('bolar')
            )?.consumedQuantity || 0;

            const shiftMetrics =
              buildShiftMetrics(
                stockConsumption,
                shiftMetricsInput
              );

            const recetteBreakdown =
              buildRecetteBreakdown({
                cash: cashCollected,
                ramiGamesUsed,
                staff,
                financialData,
                correctionActions
              });

            // Resolve Chicha price server-side so workers receive the admin-configured value.
            const chichaPrice = await getChichaPrice(client);
            recetteBreakdown.chichaPrice = chichaPrice;

            const finalRecette = recetteBreakdown.final;
            const actualCashFinal = req.body.actualCashCounted === '' || req.body.actualCashCounted == null ? null : num(req.body.actualCashCounted);
            // Expected cash = Cash - Staff - Expenses - Salary + Corrections
            const expectedCashFinal =
              num(recetteBreakdown.cash) +
              num(recetteBreakdown.correctionNet) -
              num(recetteBreakdown.expenses) -
              num(recetteBreakdown.staffSalary);
            const finalManque = actualCashFinal == null ? 0 : Math.max(0, expectedCashFinal - actualCashFinal);
            const finalManqueNote = req.body.financialData?.manqueNote || (actualCashFinal == null ? '' : (finalManque > 0 ? `Manque calculé automatiquement: ${finalManque.toFixed(2)} DT` : 'Aucun manque.'));

            await client.query(`
              UPDATE rami_paper_stock
              SET quantity=$1, updated_at=CURRENT_TIMESTAMP
              WHERE id=1
            `, [ramiPaperClosing]);

            await client.query(
              `
              UPDATE shifts
              SET
                end_time = CURRENT_TIMESTAMP,
                status = 'ended',
                closing_front_stock = $1,
                cash_collected = $2,
                rami_games_used = $3,
                staff_consumption = $4,
                final_recette = $5,
                notes = $6,
                water_05_sold = $7,
                water_1_sold = $8,
                water_15_sold = $9,
                water_bolar_sold = $10,
                kamia = $11,
                water_05_consumed = $12,
                water_1_consumed = $13,
                water_15_consumed = $14,
                water_bolar_consumed = $15,
                soda_sold = $16,
                soda_consumed = $17,
                cannettes_sold = $18,
                cannettes_consumed = $19,
                chicha_total = $20,
                chicha_personnel = $21,
                chicha_normal = $22,
                coffee_express = $23,
                coffee_cappuccino = $24,
                coffee_americain = $25,
                coffee_filter = $26,
                coffee_direct = $27,
                coffee_total = $28,
                coffee_beans_used = $29,
                tombac_used = $30,
                expenses_amount = $31,
                expenses_note = $32,
                staff_salary = $33,
                correction_actions = $34,
                actual_cash_counted = $35,
                final_shift_note = $36,
                recette_breakdown_data = $37,
                is_finalized = $38,
                end_shift_stage = 'finalized',
                chicha_kamia_used = $39,
                eau05_used = $40,
                chicha_kamia_adjustments = $41,
                manque_amount = $42,
                manque_note = $43,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = $44
              `,
              [
                JSON.stringify(closingFrontStock),
                cashCollected,
                ramiGamesUsed,
                JSON.stringify(staffConsumption),
                finalRecette,
                workerMessage,
                shiftMetrics.water05Sold || 0,
                shiftMetrics.water1Sold || 0,
                shiftMetrics.water15Sold || 0,
                shiftMetrics.waterBolarSold || 0,
                shiftMetrics.kamia || 0,
                water05Consumed,
                water1Consumed,
                water15Consumed,
                waterBolarConsumed,
                shiftMetrics.sodaSold || 0,
                stockConsumption.find(item => normalizeName(item.name).includes('soda') || normalizeName(item.name).includes('gazeuse'))?.consumedQuantity || 0,
                shiftMetrics.cannettesSold || 0,
                stockConsumption.find(item => normalizeName(item.name).includes('cannette') || normalizeName(item.name).includes('canette'))?.consumedQuantity || 0,
                chichaTotal,
                int(shiftMetricsInput.chichaPersonnel || 0),
                Math.max(0, chichaTotal - int(shiftMetricsInput.chichaPersonnel || 0)),
                int(shiftMetricsInput.express || 0),
                int(shiftMetricsInput.cappuccino || 0),
                int(shiftMetricsInput.americain || 0),
                int(shiftMetricsInput.filter || 0),
                int(shiftMetricsInput.direct || 0),
                (int(shiftMetricsInput.express || 0) + int(shiftMetricsInput.cappuccino || 0) + int(shiftMetricsInput.americain || 0) + int(shiftMetricsInput.filter || 0) + int(shiftMetricsInput.direct || 0)),
                stockConsumption.find(item => isCoffeeBeans(item))?.consumedQuantity || 0,
                stockConsumption.find(item => isTombac(item))?.consumedQuantity || 0,
                expensesAmount,
                expensesNote,
                staffSalary,
                JSON.stringify(correctionActions),
                num(req.body.actualCashCounted || 0),
                String(req.body.finalShiftNote || ''),
                JSON.stringify(recetteBreakdown),
                true,
                chichaTotal - kamia,
                int(shiftMetricsInput.eau05Used || 0),
                JSON.stringify(chichaKamiaAdjustments),
                finalManque,
                finalManqueNote,
                shiftId
              ]
            );

            await client.query(`UPDATE shifts SET closing_warehouse_stock=$1 WHERE id=$2`, [JSON.stringify(closingWarehouseStock), shiftId]);

            await client.query(`
              UPDATE shifts
              SET rami_paper_opening=$1,
                  rami_paper_added=$2,
                  rami_paper_closing=$3,
                  rami_paper_used=$4
              WHERE id=$5
            `, [ramiPaperOpening, ramiPaperAdded, ramiPaperClosing, ramiPaperUsed, shiftId]);

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
                'shift_ended',
                `Finalized shift ${shiftId}. Final recette: ${finalRecette.toFixed(2)} DT.`
              ]
            );

            const allConsumption = [...stockConsumption, ...warehouseConsumption];

            const chichaKamiaData = {
              chichaTotal: chichaTotal,
              kamia: kamia,
              difference: chichaKamiaDifference,
              adjustments: chichaKamiaAdjustments,
              water05Consumed: water05Consumed,
              eau05Used: int(shiftMetricsInput.eau05Used || 0),
              selectedAdjustments: chichaKamiaAdjustments
            };

            return {

              shiftId,

              recette:
                finalRecette,

              finalRecette,

              recetteBreakdown,

              recette_breakdown:
                recetteBreakdown,

              stockConsumption: allConsumption,
              closingWarehouseStock,
              closing_warehouse_stock: closingWarehouseStock,

              stock_consumption:
                allConsumption,

              consumedItems:
                allConsumption,

              consumed_items:
                allConsumption,

              shiftMetrics,

              shift_metrics:
                shiftMetrics,

              financialData: { expensesAmount, expensesNote, expenseAmount: expensesAmount, expenseNote: expensesNote, staffSalary, manqueAmount: num(req.body.actualCashCounted || 0) ? Math.max(0, finalRecette - num(req.body.actualCashCounted)) : 0, manqueNote: finalManqueNote || '' },
              financial_data: { expensesAmount, expensesNote, staffSalary, manqueNote: finalManqueNote || '' },

              workerMessage,

              worker_message:
                workerMessage,

              correctionActions,
              correction_actions: correctionActions,

              actualCashCounted: num(req.body.actualCashCounted || 0),
              finalShiftNote: String(req.body.finalShiftNote || ''),

              chichaKamiaData: chichaKamiaData,

              isFinalized: true
            };
          }
        );

      res.json(result);

    } catch (err) {

      console.error(
        '❌ End shift error:',
        err
      );

      res.status(400).json({
        error:
          err.message ||
          'Failed to end shift'
      });
    }
  }
);

// ============================================================
// GET SINGLE SHIFT (ADMIN DETAILED VIEW)
// ============================================================

router.get(
  '/:id',
  verifyToken,
  async (req, res) => {

    const id =
      req.params.id;

    if (
      id === 'active'
    ) {
      return res.status(404).json({
        error:
          'Use /api/shifts/active'
      });
    }

    try {
      await ensureShiftSchema(pool);

      const result =
        await pool.query(
          `
          SELECT
            s.*,
            u.username,
            u.full_name AS user_full_name

          FROM shifts s

          JOIN users u
            ON s.user_id = u.id

          WHERE s.id = $1
          `,
          [id]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          error:
            'Shift not found'
        });
      }

      const shift =
        result.rows[0];

      const ramiPaper = await getRamiPaperStock(pool);

      const items =
        await getAllItems(
          pool
        );

      const additionsRows =
        await getShiftAdditions(
          pool,
          shift.id
        );

      const opening =
        toObject(
          shift.opening_front_stock
        );

      const closing =
        toObject(
          shift.closing_front_stock
        );

      const openingWarehouse = toObject(shift.opening_warehouse_stock);
      const closingWarehouse = toObject(shift.closing_warehouse_stock);

      const additions = {};

      for (
        const row
        of additionsRows
      ) {

        const note =
          String(
            row.notes || ''
          ).toLowerCase();

        if (
          note.includes(
            'initial allocation'
          )
        ) {
          continue;
        }

        const itemId =
          String(
            row.item_id
          );

        additions[itemId] =
          num(
            additions[itemId]
          ) +
          num(
            row.quantity
          );
      }

      const itemMap = {};
      for (
        const item
        of items
      ) {
        itemMap[
          String(item.id)
        ] = item;
      }

      const allIds =
        new Set([
          ...items.map(
            item => String(item.id)
          ),
          ...Object.keys(opening),
          ...Object.keys(closing),
          ...Object.keys(additions),
          ...Object.keys(openingWarehouse),
          ...Object.keys(closingWarehouse)
        ]);

      const stockConsumption = [];

      for (
        const itemId
        of allIds
      ) {

        const item =
          itemMap[
            String(itemId)
          ];

        if (!item) {
          continue;
        }

        const isWarehouseOnly = item.can_be_front === false;

        const openingQty = isWarehouseOnly
          ? num(openingWarehouse[itemId])
          : num(opening[itemId]);

        const addedQty = isWarehouseOnly
          ? 0
          : num(additions[itemId]);

        const availableQty =
          openingQty +
          addedQty;

        const closingQty = isWarehouseOnly
          ? (Object.prototype.hasOwnProperty.call(closingWarehouse, itemId)
            ? num(closingWarehouse[itemId])
            : openingQty)
          : num(closing[itemId]);

        const consumedQty =
          Math.max(
            0,
            availableQty -
            closingQty
          );

        stockConsumption.push({
          itemId: item.id,
          item_id: item.id,

          itemName:
            item.display_name ||
            item.name,

          item_name:
            item.display_name ||
            item.name,

          name:
            item.display_name ||
            item.name,

          unit:
            item.unit ||
            'units',

          openingQuantity:
            openingQty,

          opening_quantity:
            openingQty,

          addedQuantity:
            addedQty,

          added_quantity:
            addedQty,

          availableQuantity:
            availableQty,

          available_quantity:
            availableQty,

          closingQuantity:
            closingQty,

          closing_quantity:
            closingQty,

          consumedQuantity:
            consumedQty,

          consumed_quantity:
            consumedQty
        });
      }

      stockConsumption.sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''));

      const storedMetrics = {
        water05Sold: num(shift.water_05_sold),
        water1Sold: num(shift.water_1_sold),
        water15Sold: num(shift.water_15_sold),
        waterBolarSold: num(shift.water_bolar_sold),
        kamia: num(shift.kamia),
        water05Consumed: num(shift.water_05_consumed),
        water1Consumed: num(shift.water_1_consumed),
        water15Consumed: num(shift.water_15_consumed),
        waterBolarConsumed: num(shift.water_bolar_consumed),
        sodaSold: num(shift.soda_sold),
        sodaConsumed: num(shift.soda_consumed),
        cannettesSold: num(shift.cannettes_sold),
        cannettesConsumed: num(shift.cannettes_consumed),
        chichaTotal: num(shift.chicha_total),
        chichaPersonnel: num(shift.chicha_personnel),
        normalChicha: num(shift.chicha_normal),
        express: num(shift.coffee_express),
        cappuccino: num(shift.coffee_cappuccino),
        americain: num(shift.coffee_americain),
        filter: num(shift.coffee_filter),
        direct: num(shift.coffee_direct),
        coffeeCount: num(shift.coffee_total),
        coffeeBeansConsumed: num(shift.coffee_beans_used),
        tombacConsumed: num(shift.tombac_used),
        chichaKamiaUsed: num(shift.chicha_kamia_used),
        eau05Used: num(shift.eau05_used),
        chichaKamiaAdjustments: shift.chicha_kamia_adjustments || {}
      };

      const water05Total = storedMetrics.water05Sold + storedMetrics.kamia;
      const water05Difference = water05Total - storedMetrics.water05Consumed;
      const water1Difference = storedMetrics.water1Sold - storedMetrics.water1Consumed;
      const water15Difference = storedMetrics.water15Sold - storedMetrics.water15Consumed;
      const waterBolarDifference = storedMetrics.waterBolarSold - storedMetrics.waterBolarConsumed;
      const sodaDifference = storedMetrics.sodaSold - storedMetrics.sodaConsumed;
      const cannettesDifference = storedMetrics.cannettesSold - storedMetrics.cannettesConsumed;

      const chichaKamiaDifference = storedMetrics.chichaTotal - storedMetrics.kamia;

      const staff =
        calculateStaffDeductions(
          items,
          shift.staff_consumption
        );

      let correctionActions = [];
      try {
        correctionActions = typeof shift.correction_actions === 'string'
          ? JSON.parse(shift.correction_actions || '[]')
          : shift.correction_actions || [];
      } catch (e) {
        correctionActions = [];
      }

      let recetteBreakdown = {};
      try {
        recetteBreakdown = typeof shift.recette_breakdown_data === 'string'
          ? JSON.parse(shift.recette_breakdown_data || '{}')
          : shift.recette_breakdown_data || {};
      } catch (e) {
        recetteBreakdown = {};
      }

      if (!Array.isArray(correctionActions)) {
        correctionActions = [];
      }

      // Older shifts may have worker decisions in recette_adjustments.
      if (
        correctionActions.length === 0 &&
        shift.recette_adjustments
      ) {
        correctionActions = toArray(
          shift.recette_adjustments
        );
      }

      const response = {
        ...shift,

        workerMessage: shift.notes || '',
        worker_message: shift.notes || '',

        stockConsumption: stockConsumption,
        stock_consumption: stockConsumption,
        consumedItems: stockConsumption,
        consumed_items: stockConsumption,
        additions: additionsRows,

        ramiPaper: {
          opening: num(shift.rami_paper_opening),
          added: num(shift.rami_paper_added),
          closing: num(shift.rami_paper_closing),
          used: num(shift.rami_paper_used),
          currentStock: num(ramiPaper.quantity),
          lastAddedAt: ramiPaper.last_added_at,
          lastAddedBy: ramiPaper.last_added_by,
          lastAddedByUsername: ramiPaper.last_added_by_username
        },

        shiftMetrics: {
          ...storedMetrics,
          water05Total,
          water05Difference,
          water1Difference,
          water15Difference,
          waterBolarDifference,
          sodaDifference,
          cannettesDifference,
          chichaKamiaDifference,
          chichaKamiaAdjustments: storedMetrics.chichaKamiaAdjustments || {}
        },

        shift_metrics: {
          ...storedMetrics,
          water05Total,
          water05Difference,
          water1Difference,
          water15Difference,
          waterBolarDifference,
          sodaDifference,
          cannettesDifference,
          chichaKamiaDifference,
          chichaKamiaAdjustments: storedMetrics.chichaKamiaAdjustments || {}
        },

        recetteBreakdown,
        recette_breakdown: recetteBreakdown,

        financialData: {
          cashCollected: shift.cash_collected || 0,
          ramiGamesUsed: shift.rami_games_used || 0,
          ramiRevenue: (shift.rami_games_used || 0) * 1.5,
          expensesAmount: shift.expenses_amount || 0,
          expensesNote: shift.expenses_note || '',
          expenseAmount: shift.expenses_amount || 0,
          expenseNote: shift.expenses_note || '',
          manqueAmount: shift.manque_amount || 0,
          manqueNote: shift.manque_note || '',
          staffSalary: shift.staff_salary || 0,
          correctionActions: correctionActions,
          finalRecette: shift.final_recette || 0,
          actualCashCounted: shift.actual_cash_counted || 0,
          finalShiftNote: shift.final_shift_note || ''
        },

        financial_data: {
          cashCollected: shift.cash_collected || 0,
          ramiGamesUsed: shift.rami_games_used || 0,
          ramiRevenue: (shift.rami_games_used || 0) * 1.5,
          expensesAmount: shift.expenses_amount || 0,
          expensesNote: shift.expenses_note || '',
          expenseAmount: shift.expenses_amount || 0,
          expenseNote: shift.expenses_note || '',
          manqueAmount: shift.manque_amount || 0,
          manqueNote: shift.manque_note || '',
          staffSalary: shift.staff_salary || 0,
          correctionActions: correctionActions,
          finalRecette: shift.final_recette || 0,
          actualCashCounted: shift.actual_cash_counted || 0,
          finalShiftNote: shift.final_shift_note || ''
        },

        staffDetails: {
          coffeeQty: staff.coffeeQty || 0,
          coffeeAmount: staff.coffee || 0,
          waterQty: staff.waterQty || 0,
          waterAmount: staff.water || 0,
          sodaQty: staff.sodaQty || 0,
          sodaAmount: staff.soda || 0,
          cannetteQty: staff.cannetteQty || 0,
          cannetteAmount: staff.cannette || 0,
          staffTotal: staff.coffee + staff.water + staff.soda + (staff.cannette || 0)
        },

        correctionActions: correctionActions,
        correction_actions: correctionActions,

        chichaKamiaData: {
          chichaTotal: storedMetrics.chichaTotal,
          kamia: storedMetrics.kamia,
          difference: chichaKamiaDifference,
          adjustments: storedMetrics.chichaKamiaAdjustments || {},
          eau05Used: storedMetrics.eau05Used || 0,
          water05Consumed: storedMetrics.water05Consumed || 0
        },

        isFinalized: shift.is_finalized || false
      };

      res.json(response);

    } catch (err) {

      console.error(
        '❌ Get shift error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to get shift'
      });
    }
  }
);

/*
============================================================
GET ALL SHIFTS
============================================================
*/

router.get(
  '/',
  verifyToken,
  async (req, res) => {

    const {
      status,
      userId,
      from,
      to,
      limit
    } = req.query;

    try {

      let query = `
        SELECT
          s.*,
          u.username,
          u.full_name AS user_full_name

        FROM shifts s

        JOIN users u
          ON s.user_id = u.id

        WHERE 1 = 1
      `;

      const params = [];
      let index = 1;

      if (status) {

        query +=
          ` AND s.status = $${index}`;

        params.push(
          status
        );

        index++;
      }

      if (userId) {

        query +=
          ` AND s.user_id = $${index}`;

        params.push(
          userId
        );

        index++;
      }

      if (from) {

        query +=
          ` AND s.start_time >= $${index}`;

        params.push(
          from
        );

        index++;
      }

      if (to) {

        query +=
          ` AND s.start_time <= $${index}`;

        params.push(
          to
        );

        index++;
      }

      query +=
        ` ORDER BY s.start_time DESC`;

      if (limit) {

        const parsedLimit =
          parseInt(
            limit,
            10
          );

        if (
          Number.isInteger(
            parsedLimit
          ) &&
          parsedLimit > 0
        ) {

          query +=
            ` LIMIT $${index}`;

          params.push(
            parsedLimit
          );
        }
      }

      const result =
        await pool.query(
          query,
          params
        );

      const items =
        await getAllItems(
          pool
        );

      const shifts = [];

      for (
        const shift
        of result.rows
      ) {

        const details =
          await calculateStockConsumption(
            pool,
            shift
          );

        const staff =
          calculateStaffDeductions(
            items,
            shift.staff_consumption
          );

        let correctionActions = [];
        try {
          correctionActions = typeof shift.correction_actions === 'string'
            ? JSON.parse(shift.correction_actions || '[]')
            : shift.correction_actions || [];
        } catch (e) {
          correctionActions = [];
        }

        let recetteBreakdown = {};
        try {
          recetteBreakdown = typeof shift.recette_breakdown_data === 'string'
            ? JSON.parse(shift.recette_breakdown_data || '{}')
            : shift.recette_breakdown_data || {};
        } catch (e) {
          recetteBreakdown = {};
        }

        if (
          correctionActions.length === 0 &&
          shift.recette_adjustments
        ) {
          correctionActions = toArray(
            shift.recette_adjustments
          );
        }

        const shiftMetrics = {
          water05Sold: shift.water_05_sold || 0,
          water1Sold: shift.water_1_sold || 0,
          water15Sold: shift.water_15_sold || 0,
          waterBolarSold: shift.water_bolar_sold || 0,
          kamia: shift.kamia || 0,
          water05Consumed: shift.water_05_consumed || 0,
          water1Consumed: shift.water_1_consumed || 0,
          water15Consumed: shift.water_15_consumed || 0,
          waterBolarConsumed: shift.water_bolar_consumed || 0,
          water05Total: (shift.water_05_sold || 0) + (shift.kamia || 0),
          sodaSold: shift.soda_sold || 0,
          sodaConsumed: shift.soda_consumed || 0,
          cannettesSold: shift.cannettes_sold || 0,
          cannettesConsumed: shift.cannettes_consumed || 0,
          chichaTotal: shift.chicha_total || 0,
          chichaPersonnel: shift.chicha_personnel || 0,
          normalChicha: shift.chicha_normal || 0,
          express: shift.coffee_express || 0,
          cappuccino: shift.coffee_cappuccino || 0,
          americain: shift.coffee_americain || 0,
          filter: shift.coffee_filter || 0,
          direct: shift.coffee_direct || 0,
          coffeeCount: shift.coffee_total || 0,
          coffeeBeansConsumed: shift.coffee_beans_used || 0,
          tombacConsumed: shift.tombac_used || 0,
          water05Difference: ((shift.water_05_sold || 0) + (shift.kamia || 0)) - (shift.water_05_consumed || 0),
          water1Difference: (shift.water_1_sold || 0) - (shift.water_1_consumed || 0),
          water15Difference: (shift.water_15_sold || 0) - (shift.water_15_consumed || 0),
          waterBolarDifference: (shift.water_bolar_sold || 0) - (shift.water_bolar_consumed || 0),
          sodaDifference: (shift.soda_sold || 0) - (shift.soda_consumed || 0),
          cannettesDifference: (shift.cannettes_sold || 0) - (shift.cannettes_consumed || 0),
          chichaKamiaDifference: (shift.chicha_total || 0) - (shift.kamia || 0),
          eau05Used: shift.eau05_used || 0,
          chichaKamiaAdjustments: shift.chicha_kamia_adjustments || {}
        };

        shifts.push({

          ...shift,

          workerMessage:
            shift.notes || '',

          worker_message:
            shift.notes || '',

          stockConsumption:
            details.consumption,

          stock_consumption:
            details.consumption,

          consumedItems:
            details.consumption,

          consumed_items:
            details.consumption,

          additions:
            details.additions,

          shiftMetrics,

          shift_metrics:
            shiftMetrics,

          recetteBreakdown,

          recette_breakdown:
            recetteBreakdown,

          correctionActions,
          correction_actions: correctionActions,

          rami_games_revenue:
            int(
              shift.rami_games_used
            ) *
            1.5,

          isFinalized: shift.is_finalized || false,

          financialSummary: {
            cashCollected: shift.cash_collected || 0,
            ramiRevenue: (shift.rami_games_used || 0) * 1.5,
            expenses: shift.expenses_amount || 0,
            staffSalary: shift.staff_salary || 0,
            finalRecette: shift.final_recette || 0,
            actualCashCounted: shift.actual_cash_counted || 0,
            finalShiftNote: shift.final_shift_note || ''
          }
        });
      }

      res.json(
        shifts
      );

    } catch (err) {

      console.error(
        '❌ Get shifts error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to get shifts'
      });
    }
  }
);

console.log(
  '✅ SHIFT ROUTES LOADED SUCCESSFULLY!'
);

module.exports = router;