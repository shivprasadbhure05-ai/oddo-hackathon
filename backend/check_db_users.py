from app.db import supabase_admin
data = supabase_admin.table('users').select('*').execute().data
with open("users_db.txt", "w", encoding="utf-8") as f:
    f.write(str(data))
