import React, { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import api from './api'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import StockManagement from './components/StockManagement'
import ShiftManagement from './components/ShiftManagement'
import Logs from './components/Logs'
import AdminPanel from './components/AdminPanel'
import Navigation from './components/Navigation'

const AuthContext = createContext()

export const useAuth = () => useContext(AuthContext)

const ProtectedRoute = ({ children, requireAdmin = false }) => {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div className="loading-screen">Loading...</div>
  }
  
  if (!user) {
    return <Navigate to="/login" replace />
  }
  
  if (requireAdmin && user.role !== 'admin') {
    return <Navigate to="/shifts" replace />
  }
  
  return children
}

const AppContent = () => {
  const { user, logout } = useAuth()
  const location = useLocation()
  const isLoginPage = location.pathname === '/login'
  
  return (
    <div className="app-container">
      {!isLoginPage && user && <Navigation user={user} onLogout={logout} />}
      <div className={!isLoginPage && user ? 'main-content' : ''}>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Dashboard removed - redirect to shifts */}
          <Route path="/dashboard" element={<Navigate to="/shifts" replace />} />
          <Route path="/stock" element={
            <ProtectedRoute>
              <StockManagement />
            </ProtectedRoute>
          } />
          <Route path="/shifts" element={
            <ProtectedRoute>
              <ShiftManagement />
            </ProtectedRoute>
          } />
          <Route path="/logs" element={
            <ProtectedRoute requireAdmin>
              <Logs />
            </ProtectedRoute>
          } />
          <Route path="/admin" element={
            <ProtectedRoute requireAdmin>
              <AdminPanel />
            </ProtectedRoute>
          } />
          <Route path="/" element={<Navigate to="/shifts" replace />} />
          <Route path="*" element={<Navigate to="/shifts" replace />} />
        </Routes>
      </div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState(localStorage.getItem('token'))

  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      fetchUser()
    } else {
      setLoading(false)
    }
  }, [token])

  const fetchUser = async () => {
    try {
      const response = await api.get('/auth/me')
      setUser(response.data)
    } catch (error) {
      console.error('Failed to fetch user:', error)
      localStorage.removeItem('token')
      delete api.defaults.headers.common['Authorization']
      setToken(null)
    } finally {
      setLoading(false)
    }
  }

  const login = (userData, newToken) => {
    setUser(userData)
    setToken(newToken)
    localStorage.setItem('token', newToken)
    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    localStorage.removeItem('token')
    delete api.defaults.headers.common['Authorization']
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthContext.Provider>
  )
}

export default App