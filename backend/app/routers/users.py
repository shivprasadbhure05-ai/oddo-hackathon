import secrets
import string
from fastapi import APIRouter, HTTPException, Header
from app.db import supabase_admin
from app.schemas import CreateUserRequest, UpdateRoleRequest, UpdateManagerRequest

router = APIRouter(prefix="/api/users", tags=["users"])


def get_uid_from_token(authorization: str):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    token = authorization.split(" ")[1]
    try:
        user = supabase_admin.auth.get_user(token)
        return user.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(uid: str):
    user = supabase_admin.table("users").select("*").eq("id", uid).single().execute()
    if not user.data or user.data["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if not user.data.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account has been deactivated.")
    return user.data


@router.get("/")
async def list_users(authorization: str = Header(None)):
    uid = get_uid_from_token(authorization)
    admin = require_admin(uid)
    company_id = admin["company_id"]

    users = supabase_admin.table("users") \
        .select("*, user_approval_rules(rule_id)") \
        .eq("company_id", company_id) \
        .eq("is_active", True) \
        .execute()

    all_users = users.data or []

    # Sort: admins first, then managers/cfo, then employees
    role_order = {"admin": 0, "cfo": 1, "manager": 2, "employee": 3}
    sorted_users = sorted(all_users, key=lambda u: role_order.get(u["role"], 99))
    return sorted_users


@router.post("/")
async def create_user(request: CreateUserRequest, authorization: str = Header(None)):
    uid = get_uid_from_token(authorization)
    admin = require_admin(uid)
    company_id = admin["company_id"]

    # Validate role
    if request.role not in ("cfo", "manager", "employee"):
        raise HTTPException(status_code=400, detail="Role must be 'cfo', 'manager' or 'employee'")

    # Generate a secure temporary password
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    temp_pwd = ''.join(secrets.choice(chars) for _ in range(12))

    # Create auth user
    try:
        auth_resp = supabase_admin.auth.admin.create_user({
            "email": request.email,
            "password": temp_pwd,
            "email_confirm": True
        })
        new_uid = auth_resp.user.id
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create auth user: {str(e)}")

    # Insert into users table
    try:
        user_data = {
            "id": new_uid,
            "company_id": company_id,
            "name": request.name,
            "email": request.email,
            "role": request.role,
            "manager_id": request.manager_id if request.manager_id else None
        }
        supabase_admin.table("users").insert(user_data).execute()
    except Exception as e:
        # Rollback auth user
        try:
            supabase_admin.auth.admin.delete_user(new_uid)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Failed to create user record: {str(e)}")

    # TODO: send email with credentials (temp_pwd) via Resend/SendGrid
    # For now return temp password for dev testing
    return {
        "message": f"User {request.email} created successfully",
        "temp_password": temp_pwd,
        "user_id": new_uid
    }


@router.patch("/{user_id}/role")
async def update_role(user_id: str, request: UpdateRoleRequest, authorization: str = Header(None)):
    uid = get_uid_from_token(authorization)
    admin = require_admin(uid)
    company_id = admin["company_id"]

    if request.role not in ("cfo", "manager", "employee"):
        raise HTTPException(status_code=400, detail="Role must be 'cfo', 'manager' or 'employee'")

    # Make sure the target user is in same company and is not the admin
    target = supabase_admin.table("users").select("role, company_id").eq("id", user_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="User not found")
    if target.data["company_id"] != company_id:
        raise HTTPException(status_code=403, detail="Cannot modify user from another company")
    if target.data["role"] == "admin":
        raise HTTPException(status_code=400, detail="Cannot change admin role")

    # Check if demotion leaves pending approvals
    if target.data["role"] in ("manager", "cfo") and request.role == "employee":
        pending = supabase_admin.table("expense_approvals").select("id").eq(
            "approver_id", user_id).eq("status", "pending").execute()
        if pending.data:
            raise HTTPException(
                status_code=400,
                detail=f"This user has {len(pending.data)} pending approvals. Reassign them before changing role."
            )

    supabase_admin.table("users").update({"role": request.role}).eq("id", user_id).execute()
    return {"message": "Role updated successfully"}


@router.patch("/{user_id}/manager")
async def update_manager(user_id: str, request: UpdateManagerRequest, authorization: str = Header(None)):
    uid = get_uid_from_token(authorization)
    admin = require_admin(uid)
    company_id = admin["company_id"]

    # Verify target user is in same company
    target = supabase_admin.table("users").select("company_id").eq("id", user_id).single().execute()
    if not target.data or target.data["company_id"] != company_id:
        raise HTTPException(status_code=404, detail="User not found")

    # Validate the proposed manager is not the admin
    if request.manager_id:
        proposed_mgr = supabase_admin.table("users").select("role, company_id").eq("id", request.manager_id).single().execute()
        if not proposed_mgr.data or proposed_mgr.data["company_id"] != company_id:
            raise HTTPException(status_code=400, detail="Assigned manager not found in this company")
        if proposed_mgr.data["role"] == "admin":
            raise HTTPException(status_code=400, detail="Admin cannot be assigned as a manager")

    supabase_admin.table("users").update({
        "manager_id": request.manager_id if request.manager_id else None
    }).eq("id", user_id).execute()
    return {"message": "Manager updated successfully"}


@router.delete("/{user_id}")
async def delete_user(user_id: str, authorization: str = Header(None)):
    uid = get_uid_from_token(authorization)
    admin = require_admin(uid)
    company_id = admin["company_id"]

    # Check the users table — but handle orphaned auth users gracefully
    target = supabase_admin.table("users").select("role, company_id").eq("id", user_id).single().execute()

    if target.data:
        # User exists in DB — enforce business rules
        if target.data["company_id"] != company_id:
            raise HTTPException(status_code=403, detail="Cannot modify user from another company")
        if target.data["role"] == "admin":
            raise HTTPException(status_code=400, detail="Cannot delete admin account")

        if target.data["role"] in ("manager", "cfo"):
            pending = supabase_admin.table("expense_approvals").select("id").eq(
                "approver_id", user_id).eq("status", "pending").execute()
            if pending.data:
                raise HTTPException(
                    status_code=400,
                    detail=f"This user has {len(pending.data)} pending approvals. Reassign them before deleting."
                )
    try:
        # Step 1: Delete from Supabase Auth so they can no longer log in
        supabase_admin.auth.admin.delete_user(user_id)
    except Exception:
        pass # Ignore if auth user is already gone

    try:
        # Always soft-delete: preserve financial history but remove from active directory.
        # Hard deleting enterprise users is an anti-pattern and hits cascade/trigger blocks.
        scrambled = f"deleted_{user_id[:8]}@odoo.local"
        supabase_admin.table("users").update({
            "is_active": False,
            "email": scrambled,
            "manager_id": None
        }).eq("id", user_id).execute()
        
        # Also clean up their approval rule assignments
        supabase_admin.table("user_approval_rules").delete().eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to remove user: {str(e)}")

    return {"message": "User deleted successfully"}
