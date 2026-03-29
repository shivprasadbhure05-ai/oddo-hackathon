from supabase import create_client
from app.config import settings

# Service-role client — bypasses RLS. NEVER expose this in frontend code.
supabase_admin = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

# Anon client — for operations that go through RLS
supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
