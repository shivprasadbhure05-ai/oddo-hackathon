import { useState, useEffect, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import {
  CheckCircle, XCircle, LogOut, Receipt, Clock, 
  ChevronRight, MessageSquare, AlertCircle, FileText, User, Trash2
} from 'lucide-react'

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession()
  return `Bearer ${data.session?.access_token}`
}

function StatusBadge({ status }) {
  const statusConfig = {
    pending:  { label: 'Pending',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  icon: Clock },
    approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.15)',   icon: CheckCircle },
    rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.15)',    icon: XCircle },
  }
  const cfg = statusConfig[status] || statusConfig.pending
  const Icon = cfg.icon
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
      padding: '0.25rem 0.75rem', borderRadius: '99px', fontSize: '0.78rem',
      fontWeight: 600, background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.color}44`
    }}>
      <Icon size={12} /> {cfg.label}
    </span>
  )
}

export default function ManagerDashboard() {
  const [approvals, setApprovals] = useState([])
  const [allExpenses, setAllExpenses] = useState([])
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedApproval, setSelectedApproval] = useState(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [viewMode, setViewMode] = useState('pending') // 'pending' or 'history'

  const fetchData = useCallback(async () => {
    try {
      const header = await getAuthHeader()
      const [appResp, allResp] = await Promise.all([
        api.get('/api/expenses/approvals', { headers: { Authorization: header } }),
        api.get('/api/expenses/all', { headers: { Authorization: header } })
      ])
      setApprovals(appResp.data)
      setAllExpenses(allResp.data)
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

  const handleAction = async (approvalId, status) => {
    if (status === 'reject' && !comment.trim()) {
      return toast.error('Please provide a reason for rejection')
    }

    setSubmitting(true)
    const toastId = toast.loading(status === 'approve' ? 'Approving...' : 'Rejecting...')
    try {
      const header = await getAuthHeader()
      // approvalId is the expense_approvals row id.
      // We need the actual EXPENSE id to call the backend route.
      const approval = approvals.find(a => a.id === approvalId)
      if (!approval || !approval.expenses?.id) {
        throw new Error('Could not find expense for this approval.')
      }
      const expenseId = approval.expenses.id
      await api.post(`/api/expenses/${expenseId}/${status}`, { comment }, { headers: { Authorization: header } })
      
      toast.success(status === 'approve' ? 'Expense approved!' : 'Expense rejected', { id: toastId })
      setSelectedApproval(null)
      setComment('')
      fetchData()
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Action failed', { id: toastId })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (expenseId) => {
    if (!window.confirm("Are you sure you want to delete this approved expense?")) return
    const toastId = toast.loading('Deleting...')
    try {
      const header = await getAuthHeader()
      await api.delete(`/api/expenses/${expenseId}`, { headers: { Authorization: header } })
      toast.success('Deleted successfully', { id: toastId })
      fetchData()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Delete failed', { id: toastId })
    }
  }

  const filteredHistory = allExpenses.filter(e => e.status === 'approved' || e.status === 'rejected')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Navbar */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Receipt size={22} color="var(--primary)" />
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Manager Portal</span>
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
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </nav>

      <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
        <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>Review Queue</h1>
            <p style={{ color: 'var(--text-muted)' }}>Monitor and manage employee reimbursement requests.</p>
          </div>
          <div style={{ display: 'flex', background: 'var(--bg-surface)', padding: '0.25rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
             <button 
               onClick={() => setViewMode('pending')}
               style={{ 
                 padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                 background: viewMode === 'pending' ? 'var(--primary)' : 'transparent',
                 color: viewMode === 'pending' ? 'white' : 'var(--text-muted)'
               }}>
               Pending ({approvals.length})
             </button>
             <button 
               onClick={() => setViewMode('history')}
               style={{ 
                 padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                 background: viewMode === 'history' ? 'var(--primary)' : 'transparent',
                 color: viewMode === 'history' ? 'white' : 'var(--text-muted)'
               }}>
               Approved/Rejected ({filteredHistory.length})
             </button>
          </div>
        </header>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem' }}>Loading dashboard...</div>
        ) : viewMode === 'pending' ? (
          approvals.length === 0 ? (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
              <h3 style={{ marginBottom: '0.5rem' }}>All caught up!</h3>
              <p style={{ color: 'var(--text-muted)' }}>No pending approvals for you.</p>
            </div>
          ) : (
             <div style={{ display: 'grid', gap: '1rem' }}>
               {approvals.map(approval => (
                 <ApprovalCard key={approval.id} item={approval.expenses} onClick={() => setSelectedApproval(approval)} />
               ))}
             </div>
          )
        ) : (
          filteredHistory.length === 0 ? (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem' }}>
              <p style={{ color: 'var(--text-muted)' }}>No history available yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {filteredHistory.map(exp => (
                <div key={exp.id} className="glass-panel" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <div style={{ 
                        width: '40px', height: '40px', borderRadius: '10px', 
                        background: 'rgba(255,255,255,0.03)', display: 'flex', 
                        alignItems: 'center', justifyContent: 'center' 
                      }}>
                        <User size={20} color="var(--text-muted)" />
                      </div>
                      <div>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{exp.users?.name}</h4>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                           <StatusBadge status={exp.status} />
                           <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{exp.category} • {exp.expense_date}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>₹{exp.amount_in_base}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-placeholder)' }}>{exp.amount} {exp.currency}</div>
                      </div>
                      {exp.status === 'approved' && (
                        <button 
                          onClick={() => handleDelete(exp.id)}
                          style={{ 
                            padding: '0.5rem', borderRadius: '8px', color: '#ef4444', 
                            background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' 
                          }}
                          title="Delete Approved"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Detail Modal */}
      {selectedApproval && (
        <DetailModal 
          selectedApproval={selectedApproval} 
          onClose={() => { setSelectedApproval(null); setComment(''); }} 
          comment={comment}
          setComment={setComment}
          submitting={submitting}
          handleAction={handleAction}
        />
      )}
    </div>
  )
}

function ApprovalCard({ item, onClick }) {
  return (
    <div className="glass-panel" 
      style={{ padding: '1.25rem', cursor: 'pointer', transition: 'transform 0.2s' }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
          <div style={{ 
            width: '48px', height: '48px', borderRadius: '12px', 
            background: 'var(--primary-glow)', display: 'flex', 
            alignItems: 'center', justifyContent: 'center' 
          }}>
            <User size={24} color="var(--primary)" />
          </div>
          <div>
            <h4 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{item.users?.name || 'Unknown Staff'}</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {item.category} • {item.expense_date}
            </p>
          </div>
        </div>
        
        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ textAlign: 'right' }}>
            {/* Roadmap: show "567 USD (in INR) = 49,896" format */}
            {item.currency !== 'INR' && item.amount_in_base ? (
              <>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {parseFloat(item.amount).toLocaleString()} {item.currency}
                </div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                  = ₹{parseFloat(item.amount_in_base).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </div>
              </>
            ) : (
              <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>
                ₹{parseFloat(item.amount_in_base || item.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </div>
            )}
          </div>
          <ChevronRight size={20} color="var(--text-placeholder)" />
        </div>
      </div>
    </div>
  )
}

function DetailModal({ selectedApproval, onClose, comment, setComment, submitting, handleAction }) {
  const exp = selectedApproval.expenses
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1.5rem'
    }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', padding: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
          <div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Decision Required</h3>
            <p style={{ color: 'var(--text-muted)' }}>Confirm or reject request from {exp.users?.name}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-muted)' }}><XCircle size={24} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2.5rem' }}>
          <div><label style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Category</label><div style={{ fontWeight: 600 }}>{exp.category}</div></div>
          <div><label style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Date</label><div style={{ fontWeight: 600 }}>{exp.expense_date}</div></div>
          <div style={{ gridColumn: 'span 2' }}><label style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Description</label><div style={{ fontWeight: 600 }}>{exp.description || '—'}</div></div>
          <div><label style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Amount in Base (INR)</label>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary)' }}>
              ₹{parseFloat(exp.amount_in_base).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div><label style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Original Amount</label>
            <div style={{ fontWeight: 600 }}>
              {parseFloat(exp.amount).toLocaleString()} {exp.currency}
              {exp.currency !== 'INR' && exp.conversion_rate && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Rate: {exp.conversion_rate} {exp.currency}/INR</div>
              )}
            </div>
          </div>
        </div>

        {exp.receipt_url && (
          <div style={{ marginBottom: '2rem' }}>
            <a href={exp.receipt_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '12px', textDecoration: 'none', color: 'inherit' }}>
              <AlertCircle size={20} color="var(--primary)" /><span>Review Receipt Attachment</span><ChevronRight size={16} style={{ marginLeft: 'auto' }} />
            </a>
          </div>
        )}

        <div style={{ marginBottom: '2.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}><MessageSquare size={16} /> Decision Remarks</label>
          <textarea 
            placeholder="Explain why this was approved or rejected..." 
            value={comment} onChange={e => setComment(e.target.value)}
            style={{ width: '100%', minHeight: '120px', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem', color: 'var(--text-main)', resize: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => handleAction(selectedApproval.id, 'reject')} disabled={submitting} 
            style={{ flex: 1, padding: '1rem', borderRadius: '12px', fontWeight: 700, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            Reject
          </button>
          <button onClick={() => handleAction(selectedApproval.id, 'approve')} disabled={submitting} 
            className="btn-primary" style={{ flex: 1, padding: '1rem' }}>
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
