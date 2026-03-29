import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set, get) => ({
  user: null,
  role: null,
  companyId: null,
  isLoading: true,

  initialize: async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error

      if (session?.user) {
        await get().fetchUserProfile(session.user.id)
      } else {
        set({ user: null, role: null, companyId: null, isLoading: false })
      }

      // Listen for auth changes
      supabase.auth.onAuthStateChange(async (_event, newSession) => {
        if (newSession?.user) {
          await get().fetchUserProfile(newSession.user.id)
        } else {
          set({ user: null, role: null, companyId: null, isLoading: false })
        }
      })
    } catch (err) {
      console.error('Error initializing auth auth:', err)
      set({ isLoading: false })
    }
  },

  fetchUserProfile: async (userId) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('role, company_id, is_active')
        .eq('id', userId)
        .single()
      
      if (error) throw error

      // If the user has been soft-deleted (deactivated), force sign-out
      if (!data || data.is_active === false) {
        console.warn('Account deactivated — signing out.')
        await supabase.auth.signOut()
        set({ user: null, role: null, companyId: null, isLoading: false })
        window.location.href = '/login'
        return
      }
      
      set({ 
        user: { id: userId }, 
        role: data.role, 
        companyId: data.company_id, 
        isLoading: false 
      })
    } catch (err) {
      console.error('Error fetching user profile:', err)
      // If we can't find the user profile at all, sign them out to be safe
      await supabase.auth.signOut()
      set({ user: null, role: null, companyId: null, isLoading: false })
    }
  },

  logout: async () => {
    await supabase.auth.signOut()
    set({ user: null, role: null, companyId: null })
  }
}))
