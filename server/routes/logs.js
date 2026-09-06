const express = require('express');
const { pool } = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get logs (with filters)
router.get('/', verifyToken, async (req, res) => {
  const { limit, offset, userId, action, from, to } = req.query;

  try {
    let query = `
      SELECT 
        l.id, l.username, l.action, l.description, l.timestamp,
        u.full_name as user_full_name
      FROM logs l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND l.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (action) {
      query += ` AND l.action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    if (from) {
      query += ` AND l.timestamp >= $${paramIndex}`;
      params.push(from);
      paramIndex++;
    }

    if (to) {
      query += ` AND l.timestamp <= $${paramIndex}`;
      params.push(to);
      paramIndex++;
    }

    query += ` ORDER BY l.timestamp DESC`;

    if (limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(parseInt(limit));
      paramIndex++;
    }

    if (offset) {
      query += ` OFFSET $${paramIndex}`;
      params.push(parseInt(offset));
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get logs error:', err);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

// Get log count (for pagination)
router.get('/count', verifyToken, requireAdmin, async (req, res) => {
  const { userId, action, from, to } = req.query;

  try {
    let query = 'SELECT COUNT(*) as count FROM logs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (action) {
      query += ` AND action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    if (from) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(from);
      paramIndex++;
    }

    if (to) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(to);
    }

    const result = await pool.query(query, params);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error('Get log count error:', err);
    res.status(500).json({ error: 'Failed to get log count' });
  }
});

// Get distinct action types
router.get('/actions', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT action FROM logs ORDER BY action'
    );
    res.json(result.rows.map(row => row.action));
  } catch (err) {
    console.error('Get actions error:', err);
    res.status(500).json({ error: 'Failed to get actions' });
  }
});

module.exports = router;
