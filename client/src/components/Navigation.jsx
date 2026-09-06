import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

const Navigation = ({ user, onLogout }) => {
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  const handleLogout = () => {
    onLogout()
    navigate('/login')
  }

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-brand">
          <span className="brand-icon">☕</span>
          <span className="brand-text">Saraya</span>
          <span className="brand-sub">Inventory</span>
        </div>

        <div className="navbar-links">
          {/* Dashboard removed - only keep essential links */}
          <NavLink to="/shifts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🔄</span>
            Shifts
          </NavLink>
          <NavLink to="/stock" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📦</span>
            Stock
          </NavLink>
          {/* Logs - Only visible to admin */}
          {isAdmin && (
            <NavLink to="/logs" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">📋</span>
              Logs
            </NavLink>
          )}
          {/* Admin Panel - Only visible to admin */}
          {isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">⚙️</span>
              Admin
            </NavLink>
          )}
        </div>

        <div className="navbar-user">
          <span className="user-name">{user?.fullName || user?.username}</span>
          <span className={`user-role-badge ${user?.role}`}>{user?.role}</span>
          <button onClick={handleLogout} className="logout-btn">
            <span>🚪</span> Logout
          </button>
        </div>
      </div>
    </nav>
  )
}

export default Navigation