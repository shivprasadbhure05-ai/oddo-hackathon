import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { Mail, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export default function Signin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  // Forgot password flow
  const handleForgotPassword = async () => {
    if (!email) {
      return toast.error("Please enter your email to reset the password")
    }

    setIsResetting(true)
    const toastId = toast.loading("Sending temporary password...")

    try {
      const response = await api.post('/api/auth/forgot-password', { email })
      toast.success(`Password reset! Your temp password is: ${response.data.temp_password}`, { id: toastId, duration: 10000 })
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to reset password.", { id: toastId })
    } finally {
      setIsResetting(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsSubmitting(true)
    const toastId = toast.loading("Signing in...")

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      toast.success("Welcome back!", { id: toastId })

      // Fetch profile and get role directly from the DB response
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('role, company_id')
        .eq('id', data.user.id)
        .single()

      if (profileError) throw profileError

      const role = profile.role
      if (role === 'admin') navigate('/admin')
      else if (role === 'cfo') navigate('/cfo')
      else if (role === 'manager') navigate('/manager')
      else navigate('/employee')

    } catch (error) {
      toast.error(error.message || "Invalid login credentials", { id: toastId })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <h1>Welcome Back</h1>
          <p>Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Work Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
              <input 
                type="email" 
                placeholder="john@acmecorp.com" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ paddingLeft: '40px' }}
              />
            </div>
          </div>

          <div className="form-group mb-2">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label style={{ margin: 0 }}>Password</label>
              <button 
                type="button" 
                onClick={handleForgotPassword}
                disabled={isResetting}
                style={{ background: 'none', color: 'var(--primary)', border: 'none', fontSize: '0.875rem', padding: 0 }}
              >
                Forgot password?
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
              <input 
                type="password" 
                placeholder="••••••••" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingLeft: '40px' }}
              />
            </div>
          </div>

          <button 
            type="submit" 
            className="btn-primary" 
            style={{ width: '100%', marginTop: '1.5rem', padding: '0.875rem' }}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing In..." : "Sign In"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm">
          Don't have an account? <Link to="/signup">Sign up your company</Link>
        </p>
      </div>
    </div>
  )
}
