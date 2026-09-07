const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Login with specific credentials
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    // Check if user exists
    let result = await pool.query(
      'SELECT id, username, password_hash, role, full_name FROM users WHERE username = $1',
      [username]
    );
    
    let user;
    let isNewUser = false;
    
    if (result.rows.length === 0) {
      // Create user if doesn't exist
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      const insertResult = await pool.query(
        `INSERT INTO users (username, password_hash, role, full_name, is_active) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, username, role, full_name`,
        [username, passwordHash, 'worker', username, true]
      );
      user = insertResult.rows[0];
      isNewUser = true;
    } else {
      user = result.rows[0];
      
      // Check password for ALL users using bcrypt (including admin)
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name || user.username
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Register new user (admin only)
router.post('/register', verifyToken, requireAdmin, async (req, res) => {
  const { username, password, role, fullName } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, full_name) 
       VALUES ($1, $2, $3, $4) RETURNING id, username, role, full_name`,
      [username, passwordHash, role || 'worker', fullName || username]
    );

    await pool.query(
      'INSERT INTO logs (user_id, username, action, description) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.username, 'user_created', `Created user ${username}`]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get current user info
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, full_name FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// List users (admin only)
router.get('/users', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, full_name, is_active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Update user (admin only)
router.put('/users/:id', verifyToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role, fullName, isActive, password } = req.body;

  try {
    let query = 'UPDATE users SET updated_at = CURRENT_TIMESTAMP';
    const params = [];
    let paramIndex = 1;

    if (role) {
      query += `, role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    if (fullName) {
      query += `, full_name = $${paramIndex}`;
      params.push(fullName);
      paramIndex++;
    }

    if (isActive !== undefined) {
      query += `, is_active = $${paramIndex}`;
      params.push(isActive);
      paramIndex++;
    }

    if (password) {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      query += `, password_hash = $${paramIndex}`;
      params.push(passwordHash);
      paramIndex++;
    }

    query += ` WHERE id = $${paramIndex} RETURNING id, username, role, full_name, is_active`;
    params.push(id);

    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Change own password (any authenticated user)
router.post('/change-password', verifyToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old password and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    // Get current user
    const userResult = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Verify old password
    const validPassword = await bcrypt.compare(oldPassword, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, req.user.id]
    );

    // Log the action
    await pool.query(
      `INSERT INTO logs (user_id, username, action, description) 
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, req.user.username, 'password_changed', `User ${user.username} changed their password`]
    );

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;