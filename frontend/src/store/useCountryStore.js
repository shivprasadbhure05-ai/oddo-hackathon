import { create } from 'zustand'

export const useCountryStore = create((set, get) => ({
  countries: [],
  isLoading: false,
  hasFetched: false,

  fetchCountries: async () => {
    // Prevent duplicate fetches
    if (get().hasFetched || get().isLoading) return;

    set({ isLoading: true })
    try {
      const resp = await fetch('https://restcountries.com/v3.1/all?fields=name,currencies')
      const data = await resp.json()

      // Sort alphabetically, and format it elegantly
      const formatted = data
        .filter(c => c.currencies && Object.keys(c.currencies).length > 0)
        .map(c => {
          const currencyCode = Object.keys(c.currencies)[0]
          return {
            name: c.name.common,
            currencyCode: currencyCode,
            currencyName: c.currencies[currencyCode].name
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))

      set({ countries: formatted, hasFetched: true, isLoading: false })
    } catch (err) {
      console.error("Failed to fetch countries", err)
      set({ isLoading: false })
    }
  }
}))
