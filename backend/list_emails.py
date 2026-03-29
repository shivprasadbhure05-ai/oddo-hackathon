from app.db import supabase_admin
print('===== REGISTERED EMAILS =====')
res = supabase_admin.table('users').select('email, role, name').execute()
for u in res.data:
    print(f"[{u['role']}] {u['name']} -> {u['email']}")
print('=============================')
