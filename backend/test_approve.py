import asyncio
from app.db import supabase_admin
from app.schemas import UpdateRoleRequest # just to import something from app
from pydantic import BaseModel
from typing import Optional

class ActionRequest(BaseModel):
    comment: Optional[str] = None

async def test_approve():
    # Pick a pending 
    pending = supabase_admin.table("expense_approvals").select("*").eq("status", "pending").execute()
    if not pending.data:
        print("No pending expenses to test.")
        return

    this_approval = pending.data[0]
    expense_id = this_approval["expense_id"]
    uid = this_approval["approver_id"]
    print(f"Testing approve for expense {expense_id} by approver {uid}")
    
    request = ActionRequest(comment="LGTM")
    
    # Run the exact code
    try:
        # Sequential mode check
        earlier_pending = supabase_admin.table("expense_approvals") \
            .select("id") \
            .eq("expense_id", expense_id) \
            .eq("status", "pending") \
            .lt("sequence_order", this_approval["sequence_order"]) \
            .execute()
        if earlier_pending.data:
            print("earlier pending:", earlier_pending.data)

        # Mark this approval as approved
        supabase_admin.table("expense_approvals").update({
            "status": "approved",
            "comment": request.comment,
            "actioned_at": "now()"
        }).eq("id", this_approval["id"]).execute()
        print("Marked approved")

        # Write per-action audit log entry
        supabase_admin.table("audit_log").insert({
            "expense_id": expense_id,
            "actor_id": uid,
            "action": "approved",
            "old_status": "pending",
            "new_status": "pending",  
            "comment": request.comment
        }).execute()
        print("Logged")

        # Load all approvals 
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

        # Get the rule for this expense's employee 
        exp_row = supabase_admin.table("expenses").select("employee_id").eq("id", expense_id).single().execute()
        employee_id = exp_row.data["employee_id"]
        rule_map = supabase_admin.table("user_approval_rules").select("rule_id").eq("user_id", employee_id).single().execute()
        min_pct = None
        if rule_map.data:
            rule = supabase_admin.table("approval_rules").select("min_approval_percentage, use_sequence").eq("id", rule_map.data["rule_id"]).single().execute()
            if rule.data:
                min_pct = rule.data.get("min_approval_percentage")
                use_sequence = rule.data.get("use_sequence", False)
            else:
                use_sequence = False
        else:
            use_sequence = False

        print("Checking threshold")
        # Determine if the expense should be auto-approved now
        effective_total = total  
        pct_met = True
        if min_pct:
            pct_met = (approved_count / effective_total * 100) >= min_pct
        else:
            pct_met = (pending_count == 0 and inactive_count == 0)

        if pct_met and required_all_approved:
            print("Auto approving expense")
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
            print("Activating next")
            next_approver = next((r for r in rows if r["status"] == "inactive"), None)
            if next_approver:
                supabase_admin.table("expense_approvals").update({"status": "pending"}).eq("id", next_approver["id"]).execute()
        
        print("Success")
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(test_approve())
