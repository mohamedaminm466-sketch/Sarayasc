import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import api from '../api'

const AdminPanel = () => {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'worker',
    fullName: ''
  })
  const [message, setMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      const response = await api.get('/auth/users')
      setUsers(response.data)
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    setMessage({ type: '', text: '' })

    if (!formData.username || !formData.password) {
      setMessage({ type: 'error', text: 'Username and password are required' })
      return
    }

    try {
      await api.post('/auth/register', formData)
      setShowCreateForm(false)
      setFormData({ username: '', password: '', role: 'worker', fullName: '' })
      setMessage({ type: 'success', text: 'User created successfully!' })
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
      fetchUsers()
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to create user' })
    }
  }

  const handleUpdateUser = async (e) => {
    e.preventDefault()
    setMessage({ type: '', text: '' })

    try {
      await api.put(`/auth/users/${editUser.id}`, formData)
      setEditUser(null)
      setFormData({ username: '', password: '', role: 'worker', fullName: '' })
      setMessage({ type: 'success', text: 'User updated successfully!' })
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
      fetchUsers()
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to update user' })
    }
  }

  const handleToggleUserStatus = async (userId, currentStatus) => {
    try {
      await api.put(`/auth/users/${userId}`, { isActive: !currentStatus })
      fetchUsers()
    } catch (error) {
      console.error('Failed to toggle user status:', error)
    }
  }

  const startEdit = (user) => {
    setEditUser(user)
    setFormData({
      username: user.username,
      role: user.role,
      fullName: user.full_name || '',
      password: ''
    })
  }

  const cancelEdit = () => {
    setEditUser(null)
    setFormData({ username: '', password: '', role: 'worker', fullName: '' })
  }

  if (loading) {
    return <div className="loading-screen">Loading admin panel...</div>
  }

  return (
    <div className="admin-panel">
      <div className="page-header">
        <h1>Admin Panel</h1>
        <div className="header-actions">
          <button onClick={() => setShowCreateForm(!showCreateForm)} className="btn btn-primary">
            👤 Create User
          </button>
        </div>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      {showCreateForm && (
        <div className="form-card">
          <h3>Create New User</h3>
          <form onSubmit={handleCreateUser}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              >
                <option value="worker">Worker</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Create User</button>
              <button type="button" onClick={() => setShowCreateForm(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {editUser && (
        <div className="form-card">
          <h3>Edit User: {editUser.username}</h3>
          <form onSubmit={handleUpdateUser}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>New Password (leave blank to keep current)</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              >
                <option value="worker">Worker</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Update User</button>
              <button type="button" onClick={cancelEdit} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="users-table-container">
        <h2>Manage Users</h2>
        <table className="users-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Full Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '20px' }}>
                  No users found
                </td>
              </tr>
            ) : (
              users.map(u => (
                <tr key={u.id} className={u.id === user?.id ? 'current-user' : ''}>
                  <td>
                    {u.username}
                    {u.id === user?.id && <span className="badge">You</span>}
                  </td>
                  <td>{u.full_name || '-'}</td>
                  <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                  <td>
                    <span className={`status-badge ${u.is_active ? 'active' : 'inactive'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="actions-cell">
                    <button onClick={() => startEdit(u)} className="btn btn-sm btn-secondary">Edit</button>
                    {u.id !== user?.id && (
                      <button
                        onClick={() => handleToggleUserStatus(u.id, u.is_active)}
                        className={`btn btn-sm ${u.is_active ? 'btn-warning' : 'btn-success'}`}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default AdminPanel