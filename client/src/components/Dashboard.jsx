import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import api from '../api'
import { format, formatDistanceToNow } from 'date-fns'

const Dashboard = () => {
  const { user } = useAuth()
  const [stats, setStats] = useState({
    totalItems: 0,
    totalStockValue: 0,
    activeShifts: 0,
    todayRevenue: 0,
    recentShifts: [],
    lowStockItems: []
  })
  const [loading, setLoading] = useState(true)
  const [activeShift, setActiveShift] = useState(null)

  useEffect(() => {
    fetchDashboardData()
    fetchActiveShift()
  }, [])

  const fetchDashboardData = async () => {
    try {
      // Get all stock
      const stockRes = await api.get('/stock')
      const stock = stockRes.data

      // Get shifts
      const shiftsRes = await api.get('/shifts')
      const shifts = shiftsRes.data

      // Calculate stats
      const totalItems = stock.length
      const totalStockValue = stock.reduce((sum, item) => {
        const price = item.price || 0
        const total = (item.warehouse_quantity || 0) + (item.front_quantity || 0)
        return sum + (price * total)
      }, 0)

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const todayShifts = shifts.filter(s => {
        const shiftDate = new Date(s.start_time)
        shiftDate.setHours(0, 0, 0, 0)
        return shiftDate.getTime() === today.getTime() && s.status === 'ended'
      })

      const todayRevenue = todayShifts.reduce((sum, s) => sum + (s.final_recette || 0), 0)
      const activeShifts = shifts.filter(s => s.status === 'active').length
      const recentShifts = shifts.slice(0, 5)

      // Low stock items (warehouse < 5)
      const lowStockItems = stock.filter(item => (item.warehouse_quantity || 0) < 5)

      setStats({
        totalItems,
        totalStockValue,
        activeShifts,
        todayRevenue,
        recentShifts,
        lowStockItems
      })
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchActiveShift = async () => {
    try {
      const response = await api.get('/shifts/active')
      if (response.data.active) {
        setActiveShift(response.data.shift)
      }
    } catch (error) {
      console.error('Failed to fetch active shift:', error)
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading dashboard...</div>
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Welcome back, {user?.fullName || user?.username}!</h1>
        <p className="subtitle">Here's what's happening with your shop today</p>
      </div>

      {activeShift && (
        <div className="alert alert-info">
          <span className="alert-icon">🔄</span>
          <div>
            <strong>Active Shift!</strong> You have an active shift since{' '}
            {format(new Date(activeShift.start_time), 'HH:mm')}
          </div>
          <a href="/shifts" className="alert-action">Go to Shift →</a>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📦</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalItems}</div>
            <div className="stat-label">Total Items</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">${stats.totalStockValue.toFixed(2)}</div>
            <div className="stat-label">Total Stock Value</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">🔄</div>
          <div className="stat-content">
            <div className="stat-value">{stats.activeShifts}</div>
            <div className="stat-label">Active Shifts</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">💵</div>
          <div className="stat-content">
            <div className="stat-value">${stats.todayRevenue.toFixed(2)}</div>
            <div className="stat-label">Today's Revenue</div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <h2>Recent Shifts</h2>
          {stats.recentShifts.length === 0 ? (
            <p className="empty-state">No shifts yet</p>
          ) : (
            <div className="shift-list">
              {stats.recentShifts.map(shift => (
                <div key={shift.id} className="shift-item">
                  <div className="shift-info">
                    <span className="shift-user">{shift.username}</span>
                    <span className={`shift-status ${shift.status}`}>{shift.status}</span>
                  </div>
                  <div className="shift-meta">
                    <span>{format(new Date(shift.start_time), 'MMM d, HH:mm')}</span>
                    {shift.final_recette && (
                      <span className="shift-revenue">${shift.final_recette.toFixed(2)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dashboard-panel">
          <h2>Low Stock Alert</h2>
          {stats.lowStockItems.length === 0 ? (
            <p className="empty-state success">✓ All items are well stocked</p>
          ) : (
            <div className="low-stock-list">
              {stats.lowStockItems.map(item => (
                <div key={item.id} className="low-stock-item">
                  <span className="item-name">{item.display_name}</span>
                  <span className="item-quantity warning">
                    {item.warehouse_quantity || 0} {item.unit} left
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard
