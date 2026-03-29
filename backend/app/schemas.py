from pydantic import BaseModel, EmailStr
from typing import Optional

class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    company_name: str
    country: str
    base_currency: str

class SigninRequest(BaseModel):
    email: EmailStr
    password: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class CreateUserRequest(BaseModel):
    name: str
    email: EmailStr
    role: str
    manager_id: Optional[str] = None

class UpdateRoleRequest(BaseModel):
    role: str

class UpdateManagerRequest(BaseModel):
    manager_id: Optional[str] = None
