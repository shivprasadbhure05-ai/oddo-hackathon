import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { Building2, Mail, Lock, User, Globe } from 'lucide-react'
import { useCountryStore } from '../store/useCountryStore'
import { api } from '../lib/api'

export default function Signup() {
  const navigate = useNavigate()
  const { countries, isLoading: isCountriesLoading, fetchCountries } = useCountryStore()
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    companyName: '',
    country: ''
  })
  
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetchCountries()
  }, [fetchCountries])

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (formData.password !== formData.confirmPassword) {
      return toast.error("Passwords do not match!")
    }

    if (!formData.country) {
      return toast.error("Please select a country")
    }

    // Find the selected country to get its base_currency
    const selectedCountry = countries.find(c => c.name === formData.country)
    if (!selectedCountry) {
      return toast.error("Invalid country selected")
    }

    setIsSubmitting(true)
    const toastId = toast.loading("Creating your company workspace...")

    try {
      await api.post('/api/auth/signup', {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        company_name: formData.companyName,
        country: formData.country,
        base_currency: selectedCountry.currencyCode
      })

      toast.success("Account created successfully! Please log in.", { id: toastId })
      navigate('/login')
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to create account. Please try again.", { id: toastId })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <h1>Reimburse.ly</h1>
          <p>Create your company workspace</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Full Name</label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                name="name"
                placeholder="John Doe" 
                required 
                value={formData.name}
                onChange={handleChange}
                style={{ paddingLeft: '40px' }}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Company Name</label>
            <div style={{ position: 'relative' }}>
              <Building2 size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                name="companyName"
                placeholder="Acme Corp" 
                required 
                value={formData.companyName}
                onChange={handleChange}
                style={{ paddingLeft: '40px' }}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Work Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
              <input 
                type="email" 
                name="email"
                placeholder="john@acmecorp.com" 
                required 
                value={formData.email}
                onChange={handleChange}
                style={{ paddingLeft: '40px' }}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Country (Sets your base currency)</label>
            <div style={{ position: 'relative' }}>
              <Globe size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
              <select 
                name="country" 
                required 
                value={formData.country}
                onChange={handleChange}
                style={{ paddingLeft: '40px', appearance: 'none' }}
                disabled={isCountriesLoading}
              >
                <option value="" disabled>
                  {isCountriesLoading ? "Loading countries..." : "Select your country"}
                </option>
                {countries.map(c => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.currencyCode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
                <input 
                  type="password" 
                  name="password"
                  placeholder="••••••••" 
                  required 
                  minLength={6}
                  value={formData.password}
                  onChange={handleChange}
                  style={{ paddingLeft: '40px' }}
                />
              </div>
            </div>
            
            <div className="form-group">
              <label>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
                <input 
                  type="password" 
                  name="confirmPassword"
                  placeholder="••••••••" 
                  required 
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  style={{ paddingLeft: '40px' }}
                />
              </div>
            </div>
          </div>

          <button 
            type="submit" 
            className="btn-primary" 
            style={{ width: '100%', marginTop: '1rem', padding: '0.875rem' }}
            disabled={isSubmitting || isCountriesLoading}
          >
            {isSubmitting ? "Creating Workspace..." : "Create Account"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm">
          Already have an account? <Link to="/login">Sign in here</Link>
        </p>
      </div>
    </div>
  )
}
