import { useState, useEffect, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import {
  TrendingUp, Wallet, CheckCircle, Clock, 
  BarChart3, PieChart, Info, ChevronRight, User, Receipt
} from 'lucide-react'

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession()
  return `Bearer ${data.session?.access_token}`
}

export default function CfoDashboard() {
  const [stats, setStats] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const header = await getAuthHeader()
      const [statsResp, appResp] = await Promise.all([
        api.get('/api/expenses/stats', { headers: { Authorization: header } }),
        api.get('/api/expenses/approvals', { headers: { Authorization: header } })
      ])
      setStats(statsResp.data)
      setApprovals(appResp.data)
    } catch (err) {
      toast.error('Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        supabase.from('users').select('name').eq('id', data.session.user.id).single()
          .then(({ data: u }) => u && setUserName(u.name))
      }
    })
  }, [fetchData])

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
        <p style={{ color: 'var(--text-muted)' }}>Preparing finance insights...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Navbar */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <TrendingUp size={22} color="var(--primary)" />
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Finance Control Tower</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {userName && <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>👋 {userName}</span>}
          <button
            onClick={() => supabase.auth.signOut().then(() => { window.location.href = '/login' })}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              background: 'none', color: 'var(--text-muted)', fontSize: '0.875rem',
              padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '8px'
            }}>
            Role: CFO
          </button>
        </div>
      </nav>

      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <header style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.8rem', background: 'linear-gradient(135deg, #fff 0%, #cbd5e1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Company Financial Overview</h1>
          <p style={{ color: 'var(--text-muted)' }}>Real-time spend analysis across all departments.</p>
        </header>

        {/* Top Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Total Approved</span>
              <Wallet size={18} color="var(--success)" />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>₹{stats?.total_approved?.toLocaleString() || 0}</div>
          </div>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>In Review Pipeline</span>
              <Clock size={18} color="var(--primary)" />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>₹{stats?.total_pending?.toLocaleString() || 0}</div>
          </div>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Claims Approved</span>
              <CheckCircle size={18} color="var(--success)" />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats?.by_status?.approved || 0}</div>
          </div>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Requests</span>
              <Info size={18} color="var(--primary)" />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats?.by_status?.pending || 0}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
          {/* Main Chart/Analytics Section */}
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
              <BarChart3 size={20} color="var(--primary)" />
              <h3 style={{ fontSize: '1.1rem' }}>Spend Distribution by Category</h3>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {stats && Object.entries(stats.by_category).map(([cat, amount]) => {
                const percentage = stats.total_approved > 0 ? (amount / stats.total_approved) * 100 : 0
                return (
                  <div key={cat}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      <span style={{ fontWeight: 500 }}>{cat}</span>
                      <span style={{ color: 'var(--text-muted)' }}>₹{amount.toLocaleString()} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ 
                        height: '100%', 
                        background: 'var(--primary)', 
                        width: `${percentage}%`,
                        transition: 'width 1s ease-out'
                      }}></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Side Section - Your Actions */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <PieChart size={20} color="var(--primary)" />
              <h3 style={{ fontSize: '1rem' }}>Your Approval Queue</h3>
            </div>

            {approvals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                <p>No pending approvals assigned to you.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {approvals.map(app => (
                  <div 
                    key={app.id} 
                    style={{ 
                      padding: '1rem', background: 'rgba(255,255,255,0.03)', 
                      borderRadius: '10px', border: '1px solid var(--border-color)',
                      cursor: 'pointer'
                    }}
                    onClick={() => window.location.href = '/manager'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.85rem' }}>
                        <div style={{ fontWeight: 600 }}>{app.expenses.users?.name}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{app.expenses.category} • ₹{app.expenses.amount_in_base}</div>
                      </div>
                      <ChevronRight size={16} color="var(--text-muted)" />
                    </div>
                  </div>
                ))}
                <button 
                  onClick={() => window.location.href = '/manager'}
                  style={{ 
                    marginTop: '1rem', width: '100%', padding: '0.75rem', borderRadius: '8px',
                    background: 'var(--primary)', color: 'white', fontSize: '0.85rem'
                  }}
                >
                  Manage All Requests
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Company Activity Feed */}
        <div className="glass-panel" style={{ marginTop: '1.5rem', padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Receipt size={20} color="var(--primary)" />
            <h3 style={{ fontSize: '1.1rem' }}>Global Spending Monitor</h3>
          </div>
          <div style={{ textAlign: 'center', padding: '3rem', border: '2px dashed var(--border-color)', borderRadius: '12px', color: 'var(--text-muted)' }}>
            <p>Exportable reports and historical audits Coming Soon</p>
          </div>
        </div>
      </div>
    </div>
  )
}
