import { useState, useEffect, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import {
  PlusCircle, FileText, Clock, CheckCircle, XCircle,
  LogOut, Receipt, Send, Edit3, Upload, X, ChevronDown
} from 'lucide-react'

const CATEGORIES = ['Food', 'Travel', 'Accommodation', 'Miscellaneous', 'Other']
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'JPY', 'CAD']

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession()
  return `Bearer ${data.session?.access_token}`
}

const statusConfig = {
  draft:    { label: 'Draft',    color: '#64748b', bg: 'rgba(100,116,139,0.15)', icon: Edit3 },
  pending:  { label: 'Pending',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  icon: Clock },
  approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.15)',   icon: CheckCircle },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.15)',    icon: XCircle },
}

function StatusBadge({ status }) {
  const cfg = statusConfig[status] || statusConfig.draft
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

function EmptyState({ status }) {
  const msgs = {
    draft: { icon: '📝', title: 'No draft expenses', desc: 'Click "New Expense" to create one.' },
    pending: { icon: '⏳', title: 'All caught up!', desc: 'No expenses waiting for approval.' },
    approved: { icon: '✅', title: 'No approved expenses yet', desc: '' },
    rejected: { icon: '❌', title: 'No rejected expenses', desc: '' },
  }
  const m = msgs[status]
  return (
    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{m.icon}</div>
      <p style={{ fontWeight: 600 }}>{m.title}</p>
      {m.desc && <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{m.desc}</p>}
    </div>
  )
}

export default function EmployeeDashboard() {
  const [expenses, setExpenses] = useState([])
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('draft')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [form, setForm] = useState({
    description: '', category: 'Food', amount: '',
    currency: 'INR', paid_by: '', remarks: '', expense_date: new Date().toISOString().split('T')[0]
  })

  const fetchExpenses = useCallback(async () => {
    try {
      const header = await getAuthHeader()
      const resp = await api.get('/api/expenses/', { headers: { Authorization: header } })
      setExpenses(resp.data)
    } catch { toast.error('Failed to load expenses') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchExpenses()
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        supabase.from('users').select('name').eq('id', data.session.user.id).single()
          .then(({ data: u }) => u && setUserName(u.name))
      }
    })
  }, [fetchExpenses])

  const resetForm = () => {
    setForm({ description: '', category: 'Food', amount: '', currency: 'INR', paid_by: '', remarks: '', expense_date: new Date().toISOString().split('T')[0] })
    setEditingId(null)
  }

  const openNew = () => { resetForm(); setShowForm(true) }

  const openEdit = (exp) => {
    setForm({
      description: exp.description || '', category: exp.category,
      amount: exp.amount, currency: exp.currency,
      paid_by: exp.paid_by || '', remarks: exp.remarks || '',
      expense_date: exp.expense_date
    })
    setEditingId(exp.id)
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.amount || !form.category) return toast.error('Amount and category are required')
    setSubmitting(true)
    const toastId = toast.loading(editingId ? 'Saving...' : 'Creating...')
    try {
      const header = await getAuthHeader()
      const payload = { ...form, amount: parseFloat(form.amount) }
      if (editingId) {
        await api.patch(`/api/expenses/${editingId}`, payload, { headers: { Authorization: header } })
      } else {
        await api.post('/api/expenses/', payload, { headers: { Authorization: header } })
      }
      toast.success('Saved as draft!', { id: toastId })
      setShowForm(false); resetForm(); fetchExpenses()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save', { id: toastId })
    } finally { setSubmitting(false) }
  }

  const handleSubmit = async (expenseId) => {
    const toastId = toast.loading('Submitting for approval...')
    try {
      const header = await getAuthHeader()
      const resp = await api.post(`/api/expenses/${expenseId}/submit`, {}, { headers: { Authorization: header } })
      toast.success(
        `Submitted! ${resp.data.amount_in_base} ${resp.data.base_currency} (rate: ${resp.data.conversion_rate?.toFixed(4)})`,
        { id: toastId, duration: 5000 }
      )
      fetchExpenses()
      setActiveTab('pending')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Submission failed', { id: toastId })
    }
  }

  const openDetails = async (exp) => {
    setSelectedExpense(exp)
    if (exp.status !== 'draft') {
      try {
        const header = await getAuthHeader()
        const resp = await api.get(`/api/expenses/${exp.id}/approvals`, { headers: { Authorization: header } })
        setApprovals(resp.data)
      } catch { setApprovals([]) }
    } else {
      setApprovals([])
    }
  }

  const handleDelete = async (expenseId) => {
    if (!window.confirm("Are you sure you want to delete this expense?")) return
    const toastId = toast.loading('Deleting...')
    try {
      const header = await getAuthHeader()
      await api.delete(`/api/expenses/${expenseId}`, { headers: { Authorization: header } })
      toast.success('Deleted successfully', { id: toastId })
      fetchExpenses()
      setSelectedExpense(null)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Delete failed', { id: toastId })
    }
  }

  const grouped = {
    draft:    expenses.filter(e => e.status === 'draft'),
    pending:  expenses.filter(e => e.status === 'pending'),
    approved: expenses.filter(e => e.status === 'approved'),
    rejected: expenses.filter(e => e.status === 'rejected'),
  }

  // Total amount per bucket (roadmap: show "5467 rs — To submit", etc.)
  const bucketTotals = {
    draft:    grouped.draft.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0),
    pending:  grouped.pending.reduce((s, e) => s + (parseFloat(e.amount_in_base) || parseFloat(e.amount) || 0), 0),
    approved: grouped.approved.reduce((s, e) => s + (parseFloat(e.amount_in_base) || 0), 0),
    rejected: grouped.rejected.reduce((s, e) => s + (parseFloat(e.amount_in_base) || 0), 0),
  }

  const bucketLabels = {
    draft:    'To Submit',
    pending:  'Waiting Approval',
    approved: 'Approved',
    rejected: 'Rejected',
  }

  const tabs = [
    { key: 'draft',    label: 'To Submit',        icon: Edit3 },
    { key: 'pending',  label: 'Waiting Approval',  icon: Clock },
    { key: 'approved', label: 'Approved',          icon: CheckCircle },
    { key: 'rejected', label: 'Rejected',          icon: XCircle },
  ]

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
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>My Expenses</span>
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

      <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
        {/* Summary cards — show total amount per bucket as per roadmap */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', marginBottom: '2rem' }}>
          {tabs.map(t => {
            const cfg = statusConfig[t.key] || statusConfig.draft
            const Icon = t.icon
            return (
              <div key={t.key} className="glass-panel" style={{ padding: '1.25rem', cursor: 'pointer', border: activeTab === t.key ? `1px solid ${cfg.color}66` : undefined }}
                onClick={() => setActiveTab(t.key)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{bucketLabels[t.key]}</span>
                  <Icon size={16} color={cfg.color} />
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.5rem', color: cfg.color }}>
                  ₹{bucketTotals[t.key].toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {grouped[t.key].length} {grouped[t.key].length === 1 ? 'expense' : 'expenses'}
                </div>
              </div>
            )
          })}
        </div>

        {/* Header + New Expense */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600,
                background: activeTab === t.key ? statusConfig[t.key].bg : 'transparent',
                color: activeTab === t.key ? statusConfig[t.key].color : 'var(--text-muted)',
                border: activeTab === t.key ? `1px solid ${statusConfig[t.key].color}44` : '1px solid transparent',
              }}>{t.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={openNew} className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.1rem', fontSize: '0.875rem' }}>
              <PlusCircle size={15} /> New Expense
            </button>
            <label className="btn-primary" style={{ 
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.1rem', 
              fontSize: '0.875rem', cursor: 'pointer', background: 'var(--bg-surface)', 
              color: 'var(--text-main)', border: '1px solid var(--border-color)', boxShadow: 'none'
            }}>
              <Upload size={15} /> OCR Scan
              <input type="file" hidden accept="image/*" onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const toastId = toast.loading('Extracting data from receipt with OCR...');
                try {
                  const header = await getAuthHeader();
                  const formData = new FormData();
                  formData.append('file', file);
                  
                  const res = await api.post('/api/expenses/ocr', formData, {
                    headers: { Authorization: header, 'Content-Type': 'multipart/form-data' }
                  });
                  
                  const { amount, date, category, description } = res.data;
                  
                  setForm({
                    ...form,
                    description: description || 'Scanned Receipt',
                    category: category || 'Miscellaneous',
                    amount: amount || '',
                    expense_date: date || new Date().toISOString().split('T')[0],
                    receiptFile: file // Store the file so it uploads if they submit
                  });
                  setShowForm(true);
                  toast.success('OCR Complete! Verify extracted details.', { id: toastId });
                } catch (err) {
                  toast.error(err.response?.data?.detail || 'OCR failed. Please enter details manually.', { id: toastId });
                  // Show form anyway so they can do it manually
                  setForm({ ...form, receiptFile: file });
                  setShowForm(true);
                }
              }} />
            </label>
          </div>
        </div>

        {/* Expense List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading...</div>
        ) : grouped[activeTab].length === 0 ? (
          <div className="glass-panel"><EmptyState status={activeTab} /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {grouped[activeTab].map(exp => (
              <div key={exp.id} className="glass-panel" style={{ padding: '1.25rem', cursor: 'pointer' }}
                onClick={() => openDetails(exp)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                      <span style={{ fontWeight: 600 }}>{exp.description || exp.category}</span>
                      <StatusBadge status={exp.status} />
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      <span>📂 {exp.category}</span>
                      <span>📅 {exp.expense_date}</span>
                      {exp.amount_in_base && exp.amount_in_base !== exp.amount && (
                        <span>💱 {exp.amount} {exp.currency}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>
                      {exp.amount_in_base ? exp.amount_in_base.toFixed(2) : exp.amount} {exp.amount_in_base ? '' : exp.currency}
                    </div>
                    {exp.status === 'draft' && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', justifyContent: 'flex-end' }}
                        onClick={e => e.stopPropagation()}>
                        
                        <button onClick={() => openEdit(exp)} style={{
                          padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                          background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-color)'
                        }}>Edit</button>
                        <button onClick={() => handleSubmit(exp.id)} style={{
                          padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                          background: 'var(--primary)', color: 'white', border: 'none'
                        }}>Submit →</button>
                        
                        <button onClick={() => handleDelete(exp.id)} style={{
                          padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                          background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)'
                        }}>Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expense Form Modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} color="var(--primary)" />
                {editingId ? 'Edit Expense' : 'New Expense'}
              </h3>
              <button onClick={() => { setShowForm(false); resetForm() }}
                style={{ background: 'none', color: 'var(--text-muted)', padding: '0.25rem', border: 'none' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Description</label>
                <input type="text" placeholder="e.g. Client dinner at Taj"
                  value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Category *</label>
                  <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Expense Date *</label>
                  <input type="date" required value={form.expense_date}
                    onChange={e => setForm({ ...form, expense_date: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Total Amount *</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                    style={{ width: '100px', flexShrink: 0 }}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input type="number" step="0.01" min="0.01" required placeholder="0.00"
                    value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={{ flex: 1 }} />
                </div>
              </div>
              <div className="form-group">
                <label>Paid by</label>
                <input type="text" placeholder="Your name (default)"
                  value={form.paid_by} onChange={e => setForm({ ...form, paid_by: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Remarks</label>
                <input type="text" placeholder="Any additional notes"
                  value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={submitting}>
                  {submitting ? 'Saving...' : '💾 Save Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Expense Detail Modal */}
      {selectedExpense && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '1.1rem' }}>Expense Details</h3>
              <button onClick={() => setSelectedExpense(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {[
                ['Status', <StatusBadge status={selectedExpense.status} />],
                ['Category', selectedExpense.category],
                ['Description', selectedExpense.description || '—'],
                ['Amount', `${selectedExpense.amount} ${selectedExpense.currency}`],
                ...(selectedExpense.amount_in_base ? [['Amount in Base Currency', selectedExpense.amount_in_base + ' (frozen at submission)']] : []),
                ...(selectedExpense.conversion_rate ? [['Conversion Rate', selectedExpense.conversion_rate]] : []),
                ['Date', selectedExpense.expense_date],
                ['Paid by', selectedExpense.paid_by || '—'],
                ['Remarks', selectedExpense.remarks || '—'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{label}</span>
                  <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{value}</span>
                </div>
              ))}

              {/* Approval Timeline */}
              {selectedExpense.status !== 'draft' && (
                <div style={{ marginTop: '0.5rem' }}>
                  <p style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.9rem' }}>Approval History</p>
                  {approvals.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No approvers assigned yet.</p>
                  ) : approvals.map((a, i) => (
                    <div key={a.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.65rem', borderRadius: '8px', background: 'var(--bg-surface)', marginBottom: '0.5rem'
                    }}>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>{a.users?.name || 'Approver'}</p>
                        {a.comment && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{a.comment}</p>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <StatusBadge status={a.status} />
                        {a.actioned_at && <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                          {new Date(a.actioned_at).toLocaleString()}
                        </p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
