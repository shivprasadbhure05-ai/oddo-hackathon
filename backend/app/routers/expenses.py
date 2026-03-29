from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Form
from pydantic import BaseModel
from app.db import supabase_admin
from typing import Optional
import jwt as pyjwt
import httpx
from datetime import date
from app.config import settings

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

CATEGORIES = ["Food", "Travel", "Accommodation", "Miscellaneous", "Other"]
# Simple in-memory exchange rate cache: { "INR": {"rates": {...}, "date": "2026-03-29"} }
_rate_cache: dict = {}

import re

@router.post("/ocr")
async def extract_receipt_data(file: UploadFile = File(...), authorization: str = Header(None)):
    uid = get_uid(authorization)
    
    # 1. Read file bytes
    content = await file.read()
    
    # 2. Send to free OCR API (OCR.Space)
    try:
        api_key = settings.OCR_SPACE_API_KEY or "helloworld"
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                "https://api.ocr.space/parse/image",
                files={"file": (file.filename, content, file.content_type or "application/octet-stream")},
                data={
                    "apikey": api_key,
                    "language": "eng",
                    "isOverlayRequired": "false",
                    "OCREngine": "2"
                }
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=400, detail=f"OCR service error: HTTP {response.status_code}")
            res_json = response.json()
            if res_json.get("IsErroredOnProcessing"):
                err = res_json.get("ErrorMessage") or res_json.get("ErrorDetails") or "OCR processing error"
                raise HTTPException(status_code=400, detail=f"OCR failed: {err}")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"External OCR service timeout or error")
        
    parsed = res_json.get("ParsedResults", []) or []
    text = ""
    if parsed and isinstance(parsed, list) and parsed[0]:
        text = parsed[0].get("ParsedText", "") or ""
    
    if not text:
        return {"amount": "", "date": "", "category": "Miscellaneous", "description": "Scanned Receipt", "remarks": ""}
        
    # 3. Parse Text with Regex
    amount = ""
    # Prefer totals with keywords, else fallback to last decimal with 2 places
    lines_raw = text.split('\n')
    lines = [L.strip() for L in lines_raw if L.strip()]
    keyword_patterns = [
        r'(grand\s*total)\s*[:\-]?\s*([0-9]+(?:[\.,][0-9]{2})?)',
        r'(total\s*amount)\s*[:\-]?\s*([0-9]+(?:[\.,][0-9]{2})?)',
        r'(amount\s*due)\s*[:\-]?\s*([0-9]+(?:[\.,][0-9]{2})?)',
        r'(total)\s*[:\-]?\s*([0-9]+(?:[\.,][0-9]{2})?)',
        r'(balance\s*due)\s*[:\-]?\s*([0-9]+(?:[\.,][0-9]{2})?)'
    ]
    found_totals = []
    for line in lines:
        lower = line.lower()
        for pat in keyword_patterns:
            m = re.search(pat, lower, flags=re.IGNORECASE)
            if m:
                # amount is group 2
                amt = m.group(2).replace(',', '.')
                found_totals.append(amt)
    if found_totals:
        amount = found_totals[-1]
    else:
        # Fallback: last decimal in text
        amount_matches = re.findall(r'(\d+[\.,]\d{2})', text)
        if amount_matches:
            amount = amount_matches[-1].replace(',', '.')
        
    date_val = ""
    date_match = re.search(r'(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})', text)
    if date_match:
        date_val = date_match.group(1)
        
    category = "Miscellaneous"
    text_lower = text.lower()
    if any(kw in text_lower for kw in ['restaurant', 'cafe', 'food', 'grill', 'pizza', 'burger', 'coffee', 'bakery', 'kitchen', 'dine']):
        category = "Food"
    elif any(kw in text_lower for kw in ['hotel', 'inn', 'resort', 'motel', 'lodge', 'room']):
        category = "Accommodation"
    elif any(kw in text_lower for kw in ['uber', 'lyft', 'taxi', 'flight', 'air', 'train', 'ticket', 'gas', 'fuel', 'transit']):
        category = "Travel"
        
    # Attempt to extract a decent description from the first line
    lines = [L.strip() for L in text.split('\n') if L.strip() and len(L.strip()) > 3]
    description = lines[0] if lines else "Scanned Receipt"
    if len(description) > 30:
        description = description[:30] + "..."

    return {
        "amount": amount,
        "date": date_val,
        "category": category,
        "description": description.title(),
        "remarks": "All food items" if category == "Food" else ""
    }

# ---------- helpers ----------
def get_uid(authorization: str) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ")[1]
    payload = pyjwt.decode(token, options={"verify_signature": False})
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token")
    return uid


def get_user_row(uid: str) -> dict:
    r = supabase_admin.table("users").select("*").eq("id", uid).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="User not found")
    # Block deactivated (soft-deleted) users from using the API
    if not r.data.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account has been deactivated. Contact your admin.")
    return r.data


async def get_rate(base_currency: str, target_currency: str) -> float:
    """Fetch exchange rate with daily cache."""
    today = str(date.today())
    cached = _rate_cache.get(base_currency)
    if cached and cached["date"] == today:
        rates = cached["rates"]
    else:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.exchangerate-api.com/v4/latest/{base_currency}",
                timeout=10
            )
            data = resp.json()
            rates = data.get("rates", {})
            _rate_cache[base_currency] = {"date": today, "rates": rates}

    rate = rates.get(target_currency)
    if not rate:
        raise HTTPException(status_code=400, detail=f"Cannot find rate for {target_currency} → {base_currency}")
    # rate is base→target, we need target→base
    # e.g. base=INR, target=USD: rates["USD"] = 0.012, so 1 USD = 1/0.012 INR
    base_rate = rates.get(base_currency, 1.0)  # always 1 when base is the currency
    # Actually exchangerate-api returns rates relative to base
    # rates["USD"] means 1 INR = rates["USD"] USD
    # We want: 1 target_currency = ? base_currency
    # 1 USD = 1 / rates["USD"] INR
    return 1.0 / rates[target_currency]  # rate to convert 1 target → base


# ---------- schemas ----------
class CreateExpenseRequest(BaseModel):
    amount: float
    currency: str
    category: str
    description: Optional[str] = None
    paid_by: Optional[str] = None
    remarks: Optional[str] = None
    expense_date: str  # ISO date string "YYYY-MM-DD"
    receipt_url: Optional[str] = None


class UpdateExpenseRequest(BaseModel):
    amount: Optional[float] = None
    currency: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    paid_by: Optional[str] = None
    remarks: Optional[str] = None
    expense_date: Optional[str] = None
    receipt_url: Optional[str] = None


# ---------- routes ----------

@router.get("/")
async def list_expenses(authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)

    expenses = supabase_admin.table("expenses").select("*") \
        .eq("employee_id", uid) \
        .eq("company_id", user["company_id"]) \
        .order("created_at", desc=True) \
        .execute()
    return expenses.data


@router.post("/")
async def create_expense(request: CreateExpenseRequest, authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)

    if request.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {CATEGORIES}")

    data = {
        "company_id": user["company_id"],
        "employee_id": uid,
        "amount": request.amount,
        "currency": request.currency,
        "category": request.category,
        "description": request.description,
        "paid_by": request.paid_by or user["name"],
        "remarks": request.remarks,
        "expense_date": request.expense_date,
        "receipt_url": request.receipt_url,
        "status": "draft"
    }

    result = supabase_admin.table("expenses").insert(data).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create expense")
    return result.data[0]


@router.patch("/{expense_id}")
async def update_expense(expense_id: str, request: UpdateExpenseRequest, authorization: str = Header(None)):
    uid = get_uid(authorization)

    # Verify ownership and draft status
    exp = supabase_admin.table("expenses").select("*").eq("id", expense_id).single().execute()
    if not exp.data:
        raise HTTPException(status_code=404, detail="Expense not found")
    if exp.data["employee_id"] != uid:
        raise HTTPException(status_code=403, detail="Not your expense")
    if exp.data["status"] != "draft":
        raise HTTPException(status_code=403, detail="Expense cannot be edited after submission")

    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    result = supabase_admin.table("expenses").update(updates).eq("id", expense_id).execute()
    return result.data[0]


@router.post("/{expense_id}/submit")
async def submit_expense(expense_id: str, authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)

    # Get expense and verify
    exp = supabase_admin.table("expenses").select("*").eq("id", expense_id).single().execute()
    if not exp.data:
        raise HTTPException(status_code=404, detail="Expense not found")
    expense = exp.data
    if expense["employee_id"] != uid:
        raise HTTPException(status_code=403, detail="Not your expense")
    if expense["status"] != "draft":
        raise HTTPException(status_code=400, detail="Expense is already submitted")

    # Get company base currency
    company = supabase_admin.table("companies").select("base_currency").eq("id", user["company_id"]).single().execute()
    base_currency = company.data["base_currency"]
    expense_currency = expense["currency"]

    # Freeze the conversion rate
    if expense_currency == base_currency:
        conversion_rate = 1.0
        amount_in_base = expense["amount"]
    else:
        try:
            conversion_rate = await get_rate(base_currency, expense_currency)
            amount_in_base = round(expense["amount"] * conversion_rate, 2)
        except Exception:
            conversion_rate = 1.0
            amount_in_base = expense["amount"]

    # PRE-FLIGHT CHECK: ensure the user has a valid approval path before mutating DB
    # Use non-single() to avoid exceptions when no row exists
    rule_map = supabase_admin.table("user_approval_rules").select("rule_id").eq("user_id", uid).execute()
    rule_id = (rule_map.data[0]["rule_id"] if rule_map.data else None)
    
    rule_data = None
    approvers_data = []
    
    if not rule_id:
        # If user doesn't have a rule, try to ensure at least one approver exists in company
        # Prefer managers, then CFOs, then Admins
        mgrs = supabase_admin.table("users").select("id").eq("company_id", user["company_id"]).eq("role", "manager").eq("is_active", True).execute()
        cfos = supabase_admin.table("users").select("id").eq("company_id", user["company_id"]).eq("role", "cfo").eq("is_active", True).execute()
        admins = supabase_admin.table("users").select("id").eq("company_id", user["company_id"]).eq("role", "admin").eq("is_active", True).execute()
        has_company_approver = bool((mgrs.data or []) or (cfos.data or []) or (admins.data or []))
        if not user.get("manager_id") and not has_company_approver:
            raise HTTPException(status_code=400, detail="No approvers configured for your company. Contact your admin.")
    else:
        rule = supabase_admin.table("approval_rules").select("*").eq("id", rule_id).single().execute()
        if not rule.data:
            raise HTTPException(status_code=400, detail="Assigned approval rule is missing.")
        rule_data = rule.data
        approvers = supabase_admin.table("approval_rule_approvers").select("*").eq("rule_id", rule_id).order("sequence_order").execute()
        approvers_data = approvers.data or []
        if rule_data.get("include_manager") and not user.get("manager_id"):
            raise HTTPException(status_code=400, detail="This rule requires a manager approval, but you don't have one assigned.")

    # Update expense to pending with frozen rate
    supabase_admin.table("expenses").update({
        "status": "pending",
        "amount_in_base": amount_in_base,
        "conversion_rate": conversion_rate
    }).eq("id", expense_id).execute()

    # Write to audit_log
    supabase_admin.table("audit_log").insert({
        "expense_id": expense_id,
        "actor_id": uid,
        "action": "submitted",
        "old_status": "draft",
        "new_status": "pending"
    }).execute()

    # Build the approval chain from the user's rule
    if not rule_id:
        # Fallback: direct manager if available; otherwise route to first available company approver
        approver_id = user.get("manager_id")
        if not approver_id:
            # Try manager in company
            mgr = supabase_admin.table("users").select("id").eq("company_id", user["company_id"]).eq("role", "manager").eq("is_active", True).limit(1).execute()
            if mgr.data:
                approver_id = mgr.data[0]["id"]
            else:
                # Try CFO
                cfo = supabase_admin.table("users").select("id").eq("company_id", user["company_id"]).eq("role", "cfo").eq("is_active", True).limit(1).execute()
                if cfo.data:
                    approver_id = cfo.data[0]["id"]
                else:
                    # Fallback to admin
                    admin = supabase_admin.table("users").select("id").eq("company_id", user["company_id"]).eq("role", "admin").eq("is_active", True).limit(1).execute()
                    if admin.data:
                        approver_id = admin.data[0]["id"]
                    else:
                        # Should never reach here due to pre-flight, but guard anyway
                        raise HTTPException(status_code=400, detail="No approvers available in your company")

        supabase_admin.table("expense_approvals").insert({
            "expense_id": expense_id,
            "approver_id": approver_id,
            "sequence_order": 1,
            "status": "pending",
            "is_required": True
        }).execute()
    else:
        # Use assigned rule
        next_sequence = 1
        current_status = "pending" if rule_data.get("use_sequence") else "pending"
        
        # Rule injection for manager
        if rule_data.get("include_manager"):
            supabase_admin.table("expense_approvals").insert({
                "expense_id": expense_id,
                "approver_id": user["manager_id"],
                "sequence_order": next_sequence,
                "status": "pending",
                "is_required": True
            }).execute()
            next_sequence += 1
            if rule_data.get("use_sequence"):
                current_status = "inactive" # Remaining will be inactive initially
        
        # Other approvers from rule
        for idx, approver in enumerate(approvers_data):
            supabase_admin.table("expense_approvals").insert({
                "expense_id": expense_id,
                "approver_id": approver["user_id"],
                "sequence_order": next_sequence + idx,
                "status": current_status,
                "is_required": approver.get("is_required", False)
            }).execute()

    return {
        "message": "Expense submitted for approval",
        "amount_in_base": amount_in_base,
        "conversion_rate": conversion_rate,
        "base_currency": base_currency
    }


@router.get("/approvals")
async def list_approvals(authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)

    # For managers/admins/CFOs: show ALL pending approvals across the company
    if user["role"] in ("manager", "admin", "cfo"):
        # Fetch all expense ids for this company where expense is pending (submitted)
        company_expenses = supabase_admin.table("expenses") \
            .select("id") \
            .eq("company_id", user["company_id"]) \
            .neq("status", "draft") \
            .execute()
        exp_ids = [e["id"] for e in (company_expenses.data or [])]
        if not exp_ids:
            return []

        approvals = supabase_admin.table("expense_approvals") \
            .select("*, expenses!inner(*, users!inner(name))") \
            .in_("expense_id", exp_ids) \
            .eq("status", "pending") \
            .execute()
        return approvals.data

    # Otherwise (employees): only show approvals where they are the approver
    approvals = supabase_admin.table("expense_approvals") \
        .select("*, expenses!inner(*, users!inner(name))") \
        .eq("approver_id", uid) \
        .eq("status", "pending") \
        .execute()

    return approvals.data


@router.get("/stats")
async def get_stats(authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)
    
    # Simple analytics: group all approved expenses in the company by category
    all_expenses = supabase_admin.table("expenses") \
        .select("category, amount_in_base, status, created_at") \
        .eq("company_id", user["company_id"]) \
        .execute()
    
    data = all_expenses.data or []
    
    stats = {
        # Null-guard: amount_in_base is None for draft expenses (not yet submitted)
        "total_approved": sum((e["amount_in_base"] or 0) for e in data if e["status"] == "approved"),
        "total_pending": sum((e["amount_in_base"] or 0) for e in data if e["status"] == "pending"),
        "by_category": {},
        "by_status": {
            "approved": len([e for e in data if e["status"] == "approved"]),
            "pending": len([e for e in data if e["status"] == "pending"]),
            "rejected": len([e for e in data if e["status"] == "rejected"]),
            "draft": len([e for e in data if e["status"] == "draft"]),
        }
    }
    
    # Fill cat totals — null-guard for drafts without amount_in_base
    for cat in CATEGORIES:
        stats["by_category"][cat] = sum((e["amount_in_base"] or 0) for e in data if e["category"] == cat and e["status"] == "approved")
        
    return stats


@router.get("/all")
async def list_all_expenses(authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)
    
    if user["role"] in ("admin", "cfo", "manager"):
        # See everything in the company
        query = supabase_admin.table("expenses").select("*, users!inner(name)") \
            .eq("company_id", user["company_id"])
    else:
        raise HTTPException(status_code=403, detail="Only admins/managers can view all expenses")

    result = query.order("created_at", desc=True).execute()
    return result.data


class ActionRequest(BaseModel):
    comment: Optional[str] = None


@router.post("/{expense_id}/approve")
async def approve_expense(expense_id: str, request: ActionRequest, authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)

    # Verify this user has a pending approval row for this expense
    approval = supabase_admin.table("expense_approvals") \
        .select("*") \
        .eq("expense_id", expense_id) \
        .eq("approver_id", uid) \
        .eq("status", "pending") \
        .execute()

    # Manager/Admin/CFO override: allow approving any expense in same company
    if not approval.data and user["role"] in ("manager", "admin", "cfo"):
        exp_row = supabase_admin.table("expenses").select("company_id").eq("id", expense_id).single().execute()
        if not exp_row.data:
            raise HTTPException(status_code=404, detail="Expense not found")
        if exp_row.data["company_id"] != user["company_id"]:
            raise HTTPException(status_code=403, detail="Cannot approve expense from another company")

        # Deactivate any remaining approvals and mark expense approved
        supabase_admin.table("expense_approvals").update({"status": "inactive"}) \
            .eq("expense_id", expense_id).in_("status", ["pending", "inactive"]).execute()
        supabase_admin.table("expenses").update({"status": "approved"}).eq("id", expense_id).execute()
        supabase_admin.table("audit_log").insert({
            "expense_id": expense_id,
            "actor_id": uid,
            "action": "manager_override_approved",
            "old_status": "pending",
            "new_status": "approved",
            "comment": request.comment
        }).execute()
        return {"message": "Expense approved"}

    if not approval.data:
        raise HTTPException(status_code=403, detail="You do not have a pending approval for this expense")

    this_approval = approval.data[0]

    # Sequential mode check: ensure no lower sequence_order approver is still pending
    earlier_pending = supabase_admin.table("expense_approvals") \
        .select("id") \
        .eq("expense_id", expense_id) \
        .eq("status", "pending") \
        .lt("sequence_order", this_approval["sequence_order"]) \
        .execute()
    if earlier_pending.data:
        raise HTTPException(status_code=403, detail="It is not your turn yet — an earlier approver must act first")

    # Mark this approval as approved
    supabase_admin.table("expense_approvals").update({
        "status": "approved",
        "comment": request.comment,
        "actioned_at": "now()"
    }).eq("id", this_approval["id"]).execute()

    # Write per-action audit log entry
    supabase_admin.table("audit_log").insert({
        "expense_id": expense_id,
        "actor_id": uid,
        "action": "approved",
        "old_status": "pending",
        "new_status": "pending",  # expense itself still pending until full resolution
        "comment": request.comment
    }).execute()

    # Load all approvals for this expense to evaluate resolution
    all_approvals = supabase_admin.table("expense_approvals") \
        .select("*") \
        .eq("expense_id", expense_id) \
        .order("sequence_order") \
        .execute()
    rows = all_approvals.data

    total = len(rows)
    approved_count = len([r for r in rows if r["status"] == "approved"])
    pending_count  = len([r for r in rows if r["status"] == "pending"])
    inactive_count = len([r for r in rows if r["status"] == "inactive"])
    required_all_approved = all(r["status"] == "approved" for r in rows if r["is_required"])

    # Get the rule for this expense's employee to check percentage threshold
    exp_row = supabase_admin.table("expenses").select("employee_id").eq("id", expense_id).single().execute()
    employee_id = exp_row.data["employee_id"]
    rule_map = supabase_admin.table("user_approval_rules").select("rule_id").eq("user_id", employee_id).execute()
    min_pct = None
    if rule_map.data:
        rule = supabase_admin.table("approval_rules").select("min_approval_percentage, use_sequence").eq("id", rule_map.data[0]["rule_id"]).single().execute()
        if rule.data:
            min_pct = rule.data.get("min_approval_percentage")
            use_sequence = rule.data.get("use_sequence", False)
        else:
            use_sequence = False
    else:
        use_sequence = False

    # Determine if the expense should be auto-approved now
    effective_total = total  # For percentage check, count all rows
    pct_met = True
    if min_pct:
        pct_met = (approved_count / effective_total * 100) >= min_pct
    else:
        pct_met = (pending_count == 0 and inactive_count == 0)  # 100% required if no threshold

    if pct_met and required_all_approved:
        # Auto-approve the expense — mark remaining inactive rows as such
        supabase_admin.table("expense_approvals").update({"status": "inactive"}) \
            .eq("expense_id", expense_id).eq("status", "pending").execute()
        supabase_admin.table("expenses").update({"status": "approved"}).eq("id", expense_id).execute()
        supabase_admin.table("audit_log").insert({
            "expense_id": expense_id,
            "actor_id": uid,
            "action": "auto_approved",
            "old_status": "pending",
            "new_status": "approved",
            "comment": "Approval threshold met"
        }).execute()
    elif use_sequence and pending_count == 0 and inactive_count > 0:
        # Sequential mode: activate the next inactive approver
        next_approver = next((r for r in rows if r["status"] == "inactive"), None)
        if next_approver:
            supabase_admin.table("expense_approvals").update({"status": "pending"}).eq("id", next_approver["id"]).execute()

    return {"message": "Expense approved"}


@router.post("/{expense_id}/reject")
async def reject_expense(expense_id: str, request: ActionRequest, authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)
    
    if not request.comment:
        raise HTTPException(status_code=400, detail="A reason for rejection is required")

    # Verify this user has a pending approval row for this expense
    approval = supabase_admin.table("expense_approvals") \
        .select("*") \
        .eq("expense_id", expense_id) \
        .eq("approver_id", uid) \
        .eq("status", "pending") \
        .execute()

    # Manager/Admin/CFO override: allow rejecting any expense in same company
    if not approval.data and user["role"] in ("manager", "admin", "cfo"):
        exp_row = supabase_admin.table("expenses").select("company_id").eq("id", expense_id).single().execute()
        if not exp_row.data:
            raise HTTPException(status_code=404, detail="Expense not found")
        if exp_row.data["company_id"] != user["company_id"]:
            raise HTTPException(status_code=403, detail="Cannot reject expense from another company")

        supabase_admin.table("expense_approvals").update({"status": "inactive"}) \
            .eq("expense_id", expense_id).in_("status", ["pending", "inactive"]).execute()
        supabase_admin.table("expenses").update({"status": "rejected"}).eq("id", expense_id).execute()
        supabase_admin.table("audit_log").insert({
            "expense_id": expense_id,
            "actor_id": uid,
            "action": "manager_override_rejected",
            "old_status": "pending",
            "new_status": "rejected",
            "comment": request.comment
        }).execute()
        return {"message": "Expense rejected"}

    if not approval.data:
        raise HTTPException(status_code=403, detail="You do not have a pending approval for this expense")

    this_approval = approval.data[0]

    # Sequential: ensure no lower sequence_order approver is still pending
    earlier_pending = supabase_admin.table("expense_approvals") \
        .select("id") \
        .eq("expense_id", expense_id) \
        .eq("status", "pending") \
        .lt("sequence_order", this_approval["sequence_order"]) \
        .execute()
    if earlier_pending.data:
        raise HTTPException(status_code=403, detail="It is not your turn yet — an earlier approver must act first")

    # Mark this approval as rejected
    supabase_admin.table("expense_approvals").update({
        "status": "rejected",
        "comment": request.comment,
        "actioned_at": "now()"
    }).eq("id", this_approval["id"]).execute()

    # Write per-action audit log
    supabase_admin.table("audit_log").insert({
        "expense_id": expense_id,
        "actor_id": uid,
        "action": "rejected",
        "old_status": "pending",
        "new_status": "pending",
        "comment": request.comment
    }).execute()

    # Load all approvals to evaluate if expense must auto-reject
    all_approvals = supabase_admin.table("expense_approvals") \
        .select("*") \
        .eq("expense_id", expense_id) \
        .execute()
    rows = all_approvals.data

    total = len(rows)
    approved_count = len([r for r in rows if r["status"] == "approved"])
    rejected_count = len([r for r in rows if r["status"] == "rejected"])
    remaining_can_approve = len([r for r in rows if r["status"] in ("pending", "inactive")])

    # Get rule to check percentage threshold
    exp_row = supabase_admin.table("expenses").select("employee_id").eq("id", expense_id).single().execute()
    employee_id = exp_row.data["employee_id"]
    rule_map = supabase_admin.table("user_approval_rules").select("rule_id").eq("user_id", employee_id).execute()
    min_pct = None
    if rule_map.data:
        rule = supabase_admin.table("approval_rules").select("min_approval_percentage").eq("id", rule_map.data[0]["rule_id"]).single().execute()
        if rule.data:
            min_pct = rule.data.get("min_approval_percentage")

    # Case 1: A required approver rejected → immediate auto-reject
    required_rejected = any(r["is_required"] and r["status"] == "rejected" for r in rows)
    
    # Case 2: Threshold can no longer be met even if all remaining approve
    max_possible_approved = approved_count + remaining_can_approve
    threshold_unreachable = False
    if min_pct:
        threshold_unreachable = (max_possible_approved / total * 100) < min_pct
    else:
        # 100% required by default — any rejection is fatal
        threshold_unreachable = rejected_count > 0

    if required_rejected or threshold_unreachable:
        # Auto-reject the whole expense, deactivate remaining approvers
        supabase_admin.table("expense_approvals").update({"status": "inactive"}) \
            .eq("expense_id", expense_id).in_("status", ["pending", "inactive"]).execute()
        supabase_admin.table("expenses").update({"status": "rejected"}).eq("id", expense_id).execute()
        supabase_admin.table("audit_log").insert({
            "expense_id": expense_id,
            "actor_id": uid,
            "action": "auto_rejected",
            "old_status": "pending",
            "new_status": "rejected",
            "comment": "Required approver rejected or threshold can no longer be met"
        }).execute()

    return {"message": "Expense rejected"}


@router.delete("/{expense_id}")
async def delete_expense(expense_id: str, authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)

    exp = supabase_admin.table("expenses").select("*").eq("id", expense_id).single().execute()
    if not exp.data:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    expense = exp.data

    # Logic:
    # 1. Employee can delete if it's their own AND status is draft or pending
    # 2. Manager can delete if it's approved (and arguably if it's in their company)
    
    can_delete = False
    
    if expense["employee_id"] == uid:
        if expense["status"] == "draft":
            can_delete = True
        else:
            raise HTTPException(status_code=403, detail="Employees can only delete draft expenses. Submitted expenses cannot be deleted.")
    
    elif user["role"] in ("manager", "cfo", "admin"):
        # For managers/cfo/admin, they can delete approved expenses
        if expense["status"] == "approved":
            can_delete = True
        else:
            # If they are just managers, they shouldn't delete other's drafts
            raise HTTPException(status_code=403, detail="Managers can only delete approved expenses")

    if not can_delete:
        raise HTTPException(status_code=403, detail="You do not have permission to delete this expense")

    supabase_admin.table("expenses").delete().eq("id", expense_id).execute()
    return {"message": "Expense deleted successfully"}


@router.get("/{expense_id}/approvals")
async def get_approvals(expense_id: str, authorization: str = Header(None)):
    uid = get_uid(authorization)

    exp = supabase_admin.table("expenses").select("employee_id").eq("id", expense_id).single().execute()
    if not exp.data or exp.data["employee_id"] != uid:
        raise HTTPException(status_code=403, detail="Not your expense")

    approvals = supabase_admin.table("expense_approvals").select(
        "*, users(name, email)"
    ).eq("expense_id", expense_id).order("sequence_order").execute()

    return approvals.data


@router.post("/{expense_id}/upload-receipt")
async def upload_receipt(expense_id: str, file: UploadFile = File(...), authorization: str = Header(None)):
    uid = get_uid(authorization)

    exp = supabase_admin.table("expenses").select("employee_id, status").eq("id", expense_id).single().execute()
    if not exp.data or exp.data["employee_id"] != uid:
        raise HTTPException(status_code=403, detail="Not your expense")
    if exp.data["status"] != "draft":
        raise HTTPException(status_code=403, detail="Cannot upload receipt after submission")

    file_bytes = await file.read()
    file_path = f"receipts/{expense_id}/{file.filename}"

    supabase_admin.storage.from_("receipts").upload(
        file_path, file_bytes,
        {"content-type": file.content_type, "upsert": "true"}
    )

    public_url = supabase_admin.storage.from_("receipts").get_public_url(file_path)
    supabase_admin.table("expenses").update({"receipt_url": public_url}).eq("id", expense_id).execute()

    return {"receipt_url": public_url}


@router.get("/rules/all")
async def list_rules(authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    rules = supabase_admin.table("approval_rules").select("*, approval_rule_approvers(*, users(name))").execute()
    return rules.data


class ApproverEntry(BaseModel):
    user_id: str
    is_required: bool = False


class CreateRuleRequest(BaseModel):
    name: str
    description: Optional[str] = None
    min_approval_percentage: Optional[float] = None
    include_manager: bool = False
    use_sequence: bool = False
    approvers: list[ApproverEntry] = []


@router.post("/rules")
async def create_rule(request: CreateRuleRequest, authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    rule_data = {
        "company_id": user["company_id"],
        "name": request.name,
        "description": request.description,
        "min_approval_percentage": request.min_approval_percentage,
        "include_manager": request.include_manager,
        "use_sequence": request.use_sequence
    }
    
    res = supabase_admin.table("approval_rules").insert(rule_data).execute()
    rule_id = res.data[0]["id"]
    
    for idx, approver in enumerate(request.approvers):
        supabase_admin.table("approval_rule_approvers").insert({
            "rule_id": rule_id,
            "user_id": approver.user_id,
            "sequence_order": idx + 1,
            "is_required": approver.is_required
        }).execute()
        
    return res.data[0]


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    supabase_admin.table("approval_rules").delete().eq("id", rule_id).execute()
    return {"message": "Rule deleted"}


@router.post("/rules/assign")
async def assign_rule(request: dict, authorization: str = Header(None)):
    uid = get_uid(authorization)
    user = get_user_row(uid)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    user_id = request.get("user_id")
    rule_id = request.get("rule_id")
    
    supabase_admin.table("user_approval_rules").upsert({
        "company_id": user["company_id"],
        "user_id": user_id,
        "rule_id": rule_id
    }, on_conflict="user_id").execute()
    
    return {"message": "Rule assigned"}
