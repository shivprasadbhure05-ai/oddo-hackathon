from app.db import supabase_admin
import json

users = supabase_admin.auth.admin.list_users()
with open("users.txt", "w", encoding="utf-8") as f:
    for u in users:
        f.write(json.dumps(u.__dict__, default=str) + "\n")
