import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import api from '../api'
import { format, formatDistanceToNow } from 'date-fns'

const Logs = () => {
  const { user } = useAuth()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    limit: 50,
    action: '',
    userId: ''
  })
  const [users, setUsers] = useState([])
  const [actions, setActions] = useState([])
  const [isAdmin] = useState(user?.role === 'admin')

  useEffect(() => {
    fetchLogs()
    if (isAdmin) {
      fetchUsers()
      fetchActions()
    }
  }, [filters])

  const fetchLogs = async () => {
    try {
      const params = new URLSearchParams()
      Object.keys(filters).forEach(key => {
        if (filters[key]) {
          params.append(key, filters[key])
        }
      })
      const response = await api.get(`/logs?${params.toString()}`)
      setLogs(response.data)
    } catch (error) {
      console.error('Failed to fetch logs:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const response = await api.get('/auth/users')
      setUsers(response.data)
    } catch (error) {
      console.error('Failed to fetch users:', error)
    }
  }

  const fetchActions = async () => {
    try {
      const response = await api.get('/logs/actions')
      setActions(response.data)
    } catch (error) {
      console.error('Failed to fetch actions:', error)
    }
  }

  const handleFilterChange = (key, value) => {
    setFilters({ ...filters, [key]: value })
  }

  const getActionIcon = (action) => {
    const icons = {
      login: '🔐',
      logout: '🚪',
      shift_started: '🚀',
      shift_ended: '✅',
      stock_added: '📦',
      stock_allocated: '📤',
      stock_correction: '✏️',
      user_created: '👤',
      user_updated: '✏️'
    }
    return icons[action] || '📋'
  }

  if (loading) {
    return <div className="loading-screen">Loading logs...</div>
  }

  return (
    <div className="logs">
      <div className="page-header">
        <h1>Activity Logs</h1>
        <div className="header-actions">
          <button onClick={fetchLogs} className="btn btn-secondary">🔄 Refresh</button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="filter-group">
          <label>Action</label>
          <select
            value={filters.action}
            onChange={(e) => handleFilterChange('action', e.target.value)}
          >
            <option value="">All Actions</option>
            {actions.map(action => (
              <option key={action} value={action}>{action.replace('_', ' ').toUpperCase()}</option>
            ))}
          </select>
        </div>

        {isAdmin && (
          <div className="filter-group">
            <label>User</label>
            <select
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
            >
              <option value="">All Users</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>{user.username}</option>
              ))}
            </select>
          </div>
        )}

        <div className="filter-group">
          <label>Limit</label>
          <select
            value={filters.limit}
            onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </div>
      </div>

      <div className="logs-list">
        {logs.length === 0 ? (
          <p className="empty-state">No logs found</p>
        ) : (
          logs.map(log => (
            <div key={log.id} className="log-item">
              <div className="log-icon">{getActionIcon(log.action)}</div>
              <div className="log-content">
                <div className="log-header">
                  <span className="log-action">{log.action.replace('_', ' ').toUpperCase()}</span>
                  <span className="log-user">{log.username}</span>
                  <span className="log-time" title={format(new Date(log.timestamp), 'PPpp')}>
                    {formatDistanceToNow(new Date(log.timestamp))} ago
                  </span>
                </div>
                <div className="log-description">{log.description}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Logs
