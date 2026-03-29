import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'

export function ProtectedRoute() {
  const { user, isLoading } = useAuthStore()

  if (isLoading) return <div>Loading...</div>
  
  return user ? <Outlet /> : <Navigate to="/login" replace />
}

export function RoleProtectedRoute({ allowedRole }) {
  const { role, isLoading, user } = useAuthStore()

  if (isLoading) return <div>Loading...</div>
  
  if (!user) return <Navigate to="/login" replace />

  if (role !== allowedRole) {
    // Return 403 or redirect to correct dashboard
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>403 Forbidden</h2>
        <p>You do not have access to this page.</p>
        <div style={{ marginTop: '1rem' }}>
          {role === 'admin' && <Navigate to="/admin" replace />}
          {role === 'manager' && <Navigate to="/manager" replace />}
          {role === 'employee' && <Navigate to="/employee" replace />}
        </div>
      </div>
    )
  }

  return <Outlet />
}
