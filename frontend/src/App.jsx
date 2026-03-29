import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/useAuthStore'

// Pages
import Signup from './pages/Signup'
import Signin from './pages/Signin'
import AdminDashboard from './pages/AdminDashboard'
import ManagerDashboard from './pages/ManagerDashboard'
import CfoDashboard from './pages/CfoDashboard'
import EmployeeDashboard from './pages/EmployeeDashboard'

// Guards
import { ProtectedRoute, RoleProtectedRoute } from './components/ProtectedRoute'

export default function App() {
  const { initialize, isLoading, user, role } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Toaster position="top-center" />
      <Routes>
        {/* Public Routes */}
        <Route 
          path="/" 
          element={
            user ? (
              <Navigate to={`/${role === 'admin' ? 'admin' : role === 'cfo' ? 'cfo' : role === 'manager' ? 'manager' : 'employee'}`} replace />
            ) : (
              <Navigate to="/login" replace />
            )
          } 
        />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Signin />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          
          <Route element={<RoleProtectedRoute allowedRole="admin" />}>
            <Route path="/admin/*" element={<AdminDashboard />} />
          </Route>

          <Route element={<RoleProtectedRoute allowedRole="manager" />}>
            <Route path="/manager/*" element={<ManagerDashboard />} />
          </Route>

          <Route element={<RoleProtectedRoute allowedRole="cfo" />}>
            <Route path="/cfo/*" element={<CfoDashboard />} />
          </Route>

          <Route element={<RoleProtectedRoute allowedRole="employee" />}>
            <Route path="/employee/*" element={<EmployeeDashboard />} />
          </Route>

        </Route>
      </Routes>
    </BrowserRouter>
  )
}
