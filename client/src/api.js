import axios from 'axios'

// Local:
// VITE_API_URL is empty → /api → Vite proxy
//
// Production:
// VITE_API_URL is set → Railway backend
const API_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Add token to every request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  },
  (error) => Promise.reject(error)
)

// Handle expired authentication
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token')
      delete api.defaults.headers.common['Authorization']

      window.location.href = '/login'
    }

    return Promise.reject(error)
  }
)

export default api