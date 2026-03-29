import { useState, useEffect, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { 
  UserPlus, Users, Shield, User, ChevronDown, 
  LogOut, Trash2, Settings, Plus, X, List, CheckSquare
} from 'lucide-react'

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession()
  return `Bearer ${data.session?.access_token}`
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('members') // 'members' or 'rules'
  const [users, setUsers] = useState([])
  const [managers, setManagers] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Member modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', email: '', role: 'employee', manager_id: '' })
  const [creating, setCreating] = useState(false)

  // Rule modal state
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [ruleForm, setRuleForm] = useState({
    name: '', description: '', min_approval_percentage: '',
    include_manager: false, use_sequence: false, approvers: []
  })
  const [creatingRule, setCreatingRule] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const header = await getAuthHeader()
      const [uResp, rResp] = await Promise.all([
        api.get('/api/users/', { headers: { Authorization: header } }),
        api.get('/api/expenses/rules/all', { headers: { Authorization: header } })
      ])
      setUsers(uResp.data)
      setManagers(uResp.data.filter(u => u.role === 'manager' || u.role === 'cfo'))
      setRules(rResp.data)
    } catch (e) {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleCreateUser = async (e) => {
    e.preventDefault()
    setCreating(true)
    const toastId = toast.loading('Creating user...')
    try {
      const header = await getAuthHeader()
      const resp = await api.post('/api/users/', createForm, { headers: { Authorization: header } })
      toast.success(`Created! Temp password: ${resp.data.temp_password}`, { id: toastId, duration: 8000 })
      setShowCreateModal(false)
      setCreateForm({ name: '', email: '', role: 'employee', manager_id: '' })
      fetchData()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create user', { id: toastId })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteUser = async (userId) => {
    if (!window.confirm("Delete this user permanently?")) return
    try {
      const header = await getAuthHeader()
      await api.delete(`/api/users/${userId}`, { headers: { Authorization: header } })
      toast.success('User deleted')
      // Optimistically remove from local state immediately
      setUsers(prev => prev.filter(u => u.id !== userId))
      setManagers(prev => prev.filter(u => u.id !== userId))
      // Then sync from server to ensure consistency
      fetchData()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to delete user')
    }
  }

  const handleCreateRule = async (e) => {
    e.preventDefault()
    if (ruleForm.approvers.length === 0 && !ruleForm.include_manager) {
      return toast.error('Add at least one approver or include manager.')
    }
    setCreatingRule(true)
    try {
      const header = await getAuthHeader()
      await api.post('/api/expenses/rules', {
        ...ruleForm,
        min_approval_percentage: ruleForm.min_approval_percentage ? parseFloat(ruleForm.min_approval_percentage) : null
      }, { headers: { Authorization: header } })
      toast.success('Approval rule created')
      setShowRuleModal(false)
      setRuleForm({ name: '', description: '', min_approval_percentage: '', include_manager: false, use_sequence: false, approvers: [] })
      fetchData()
    } catch (e) {
      toast.error('Failed to create rule')
    } finally {
      setCreatingRule(false)
    }
  }

  const handleDeleteRule = async (id) => {
    if (!window.confirm("Delete this rule?")) return
    try {
      const header = await getAuthHeader()
      await api.delete(`/api/expenses/rules/${id}`, { headers: { Authorization: header } })
      toast.success('Rule deleted')
      fetchData()
    } catch (e) {
      toast.error('Failed to delete rule')
    }
  }

  const assignRule = async (userId, ruleId) => {
    try {
      const header = await getAuthHeader()
      await api.post('/api/expenses/rules/assign', { user_id: userId, rule_id: ruleId }, { headers: { Authorization: header } })
      toast.success('Rule assigned')
      fetchData()
    } catch (e) {
      toast.error('Assignment failed')
    }
  }

  const roleColor = { admin: '#6366f1', cfo: '#8b5cf6', manager: '#f59e0b', employee: '#10b981' }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Navbar */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Shield size={22} color="var(--primary)" />
            <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Admin Console</span>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button 
              onClick={() => setActiveTab('members')}
              style={{ background: 'none', color: activeTab === 'members' ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 600, fontSize: '0.9rem' }}>
              Members
            </button>
            <button 
              onClick={() => setActiveTab('rules')}
              style={{ background: 'none', color: activeTab === 'rules' ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 600, fontSize: '0.9rem' }}>
              Approval Rules
            </button>
          </div>
        </div>
        <button onClick={() => supabase.auth.signOut().then(() => window.location.href='/login')} 
          style={{ background: 'none', color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <LogOut size={16} /> Sign out
        </button>
      </nav>

      <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
        {activeTab === 'members' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
               <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Company Directory</h2>
               <button onClick={() => setShowCreateModal(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                 <UserPlus size={16} /> Add Member
               </button>
            </div>
            
            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                    {['Member', 'Role', 'Manager', 'Applied Rule', 'Action'].map(h => (
                      <th key={h} style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 500 }}>{u.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.email}</div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: roleColor[u.role] }}>{u.role.toUpperCase()}</span>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {u.role !== 'admin' && (
                           <span style={{ fontSize: '0.85rem' }}>{users.find(m => m.id === u.manager_id)?.name || 'None'}</span>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {u.role !== 'admin' && (
                          <select 
                            style={{ background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: '0.25rem', borderRadius: '4px' }}
                            value={u.user_approval_rules?.[0]?.rule_id || ''}
                            onChange={(e) => assignRule(u.id, e.target.value)}
                          >
                             <option value="">Direct Manager Only</option>
                             {rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {u.role !== 'admin' && <button onClick={() => handleDeleteUser(u.id)} style={{ color: '#ef4444' }}><Trash2 size={16}/></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
               <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Expense Approval Flows</h2>
               <button onClick={() => setShowRuleModal(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                 <Plus size={16} /> New Rule
               </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
              {rules.map(rule => (
                <div key={rule.id} className="glass-panel" style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{rule.name}</h3>
                    <button onClick={() => handleDeleteRule(rule.id)} style={{ color: 'var(--text-muted)' }}><X size={16}/></button>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>{rule.description || 'No description'}</p>
                  
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    {rule.include_manager && <span style={{ background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>+ Manager</span>}
                    {rule.use_sequence ? <span style={{ border: '1px solid var(--primary)', color: 'var(--primary)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>Sequential</span> : <span style={{ border: '1px solid #10b981', color: '#10b981', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>Parallel</span>}
                    {rule.min_approval_percentage && <span style={{ background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>Threshold: {rule.min_approval_percentage}%</span>}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem' }}>APPROVER CHAIN</label>
                    {rule.approval_rule_approvers.map(a => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        <span>{a.users?.name}</span>
                        {a.is_required && <CheckSquare size={14} color="var(--primary)" />}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Member Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-panel" style={{ width: '400px' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Add Team Member</h3>
            <form onSubmit={handleCreateUser}>
               <div className="form-group"><label>Name</label><input type="text" required value={createForm.name} onChange={e => setCreateForm({...createForm, name: e.target.value})}/></div>
               <div className="form-group"><label>Email</label><input type="email" required value={createForm.email} onChange={e => setCreateForm({...createForm, email: e.target.value})}/></div>
               <div className="form-group"><label>Role</label><select value={createForm.role} onChange={e => setCreateForm({...createForm, role: e.target.value})}><option value="employee">Employee</option><option value="manager">Manager</option><option value="cfo">CFO</option></select></div>
               <div className="form-group"><label>Manager</label><select value={createForm.manager_id} onChange={e => setCreateForm({...createForm, manager_id: e.target.value})}><option value="">None</option>{managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
               <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                  <button type="button" onClick={() => setShowCreateModal(false)} style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-surface)' }}>Cancel</button>
                  <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={creating}>Create</button>
               </div>
            </form>
          </div>
        </div>
      )}

      {/* Rule Modal */}
      {showRuleModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-panel" style={{ width: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Define Approval Rule</h3>
            <form onSubmit={handleCreateRule}>
               <div className="form-group"><label>Rule Name</label><input type="text" required value={ruleForm.name} onChange={e => setRuleForm({...ruleForm, name: e.target.value})}/></div>
               <div className="form-group"><label>Description</label><input type="text" value={ruleForm.description} onChange={e => setRuleForm({...ruleForm, description: e.target.value})}/></div>
               
               <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={ruleForm.include_manager} onChange={e => setRuleForm({...ruleForm, include_manager: e.target.checked})}/> Include Manager?
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={ruleForm.use_sequence} onChange={e => setRuleForm({...ruleForm, use_sequence: e.target.checked})}/> Sequential?
                  </label>
               </div>

               <div className="form-group">
                 <label>Custom Approvers Chain</label>
                 {ruleForm.approvers.map((a, idx) => (
                   <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <select style={{ flex: 1 }} value={a.user_id} onChange={e => {
                        const newApp = [...ruleForm.approvers];
                        newApp[idx].user_id = e.target.value;
                        setRuleForm({...ruleForm, approvers: newApp});
                      }}>
                        <option value="">Select User</option>
                        {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <button type="button" onClick={() => {
                        const newApp = ruleForm.approvers.filter((_, i) => i !== idx);
                        setRuleForm({...ruleForm, approvers: newApp});
                      }} style={{ color: '#ef4444' }}><Trash2 size={16}/></button>
                   </div>
                 ))}
                 <button type="button" onClick={() => setRuleForm({...ruleForm, approvers: [...ruleForm.approvers, { user_id: '', is_required: true }]})} 
                   style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '0.5rem', fontWeight: 600 }}>+ Add Approver Step</button>
               </div>

               <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                  <button type="button" onClick={() => setShowRuleModal(false)} style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-surface)' }}>Cancel</button>
                  <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={creatingRule}>Create Rule</button>
               </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
