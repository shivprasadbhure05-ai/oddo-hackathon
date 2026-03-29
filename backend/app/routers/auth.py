from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError
from app.schemas import SignupRequest, SigninRequest, ForgotPasswordRequest
from app.db import supabase_admin, supabase
import secrets
import string

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/signup")
async def signup(request: SignupRequest):
    try:
        # 1. Pre-check: Does a company with an admin already exist? 
        # (Though our unique index prevents it, checking here is cleaner to return a 400 early)

        # 2. Call Supabase Auth to create the user account using admin client
        # We use admin.create_user to not automatically sign them in but just create it.
        # Actually, since it's signup, we can use regular signup if we have email confirmations off.
        # But admin client is safer since we need atomic creation and avoid returning their session until we finish.
        try:
            auth_response = supabase_admin.auth.admin.create_user({
                "email": request.email,
                "password": request.password,
                "email_confirm": True
            })
            user_id = auth_response.user.id
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Error creating user: {str(e)}")

        print(f"Created Auth User: {user_id}")

        # 3. Create the company and user in DB
        try:
            # We must do this as admin because RLS might block normal insertion of company
            
            # Step A: Insert company
            company_data = {
                "name": request.company_name,
                "base_currency": request.base_currency,
                "country": request.country
            }
            company_response = supabase_admin.table("companies").insert(company_data).execute()
            
            if not company_response.data:
                raise Exception("Failed to insert company")
            
            company_id = company_response.data[0]["id"]
            
            # Step B: Insert the user as admin
            user_data = {
                "id": user_id,
                "company_id": company_id,
                "name": request.name,
                "email": request.email,
                "role": "admin"
            }
            user_response = supabase_admin.table("users").insert(user_data).execute()
            
            if not user_response.data:
                raise Exception("Failed to insert user profile")

        except Exception as e:
            # Rollback: delete the auth user since DB insertion failed
            try:
                supabase_admin.auth.admin.delete_user(user_id)
            except Exception as rollback_e:
                print(f"Rollback failed: {rollback_e}")
            raise HTTPException(status_code=400, detail=f"Transaction failed: {str(e)}")

        return {"message": "Signup successful", "user_id": user_id, "company_id": company_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    try:
        # Use supabase admin to send reset password email or generate temp password
        # Option 1: Supabase built-in
        # supabase.auth.reset_password_email(request.email)
        
        # Option 2: Generate unique password, update auth user, and email them
        # (Since the roadmap says "The system sends a randomly generated unique password to that email address")
        chars = string.ascii_letters + string.digits + "!@#$%^&*"
        temp_pwd = ''.join(secrets.choice(chars) for _ in range(12))
        
        # We need to find the user id by email first
        # But auth admin can update user by id.
        users_resp = supabase_admin.auth.admin.list_users() # Not efficient for prod, but we can query public.users
        users = supabase_admin.table("users").select("id").eq("email", request.email).execute()
        
        if not users.data:
            raise HTTPException(status_code=404, detail="User not found")
        
        user_id = users.data[0]["id"]
        
        # Update user's password using admin client
        supabase_admin.auth.admin.update_user_by_id(user_id, {"password": temp_pwd})
        
        # TODO: Here we would send the email with the temp password via SendGrid/Resend
        # For now, we will just return it in the response for dev testing purposes (or print it)
        print(f"TEMP PASSWORD FOR {request.email} IS: {temp_pwd}")

        return {"message": "Temporary password generated (check server console during dev)", "temp_password": temp_pwd}

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
