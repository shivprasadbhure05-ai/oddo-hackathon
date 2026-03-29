"""
Fix script: Create missing expense_approvals rows for pending expenses
that silently had no approval chain created when employees submitted them.

Root cause: When those employees originally submitted, they had manager_id = None
(the old deleted manager's ID had been cleared). The submit_expense code raised
an HTTPException AFTER already updating the expense to 'pending' status, but
the approval row was never created. So the expense sits in 'pending' limbo.

This script:
1. Finds all 'pending' expenses with no approval row
2. Creates the correct approval row pointing to the employee's current manager
"""
import os
from dotenv import load_dotenv
load_dotenv()

from app.db import supabase_admin

MANAGER_ID = 'dbfec776-dded-4a0f-8814-23b462d546b4'  # madhur (active manager)

# Get all pending expenses
pending = supabase_admin.table('expenses').select('id, employee_id, status').eq('status', 'pending').execute()
print(f'Found {len(pending.data)} pending expenses')

fixed = 0
for exp in pending.data:
    exp_id = exp['id']
    emp_id = exp['employee_id']
    
    # Check if there's already an approval row
    existing = supabase_admin.table('expense_approvals').select('id').eq('expense_id', exp_id).execute()
    if existing.data:
        print(f'  expense {exp_id}: already has {len(existing.data)} approval row(s) - skip')
        continue
    
    # Get the employee's current manager_id
    employee = supabase_admin.table('users').select('name, manager_id, is_active').eq('id', emp_id).single().execute()
    if not employee.data:
        print(f'  expense {exp_id}: employee {emp_id} not found - skip')
        continue
        
    emp = employee.data
    emp_name = emp['name']
    approver_id = emp.get('manager_id')
    
    if not approver_id:
        # Employee has no manager - use the active company manager as fallback
        approver_id = MANAGER_ID
        print(f'  expense {exp_id} (by {emp_name}): no manager assigned, using fallback manager')
    
    # Insert missing approval row
    try:
        result = supabase_admin.table('expense_approvals').insert({
            'expense_id': exp_id,
            'approver_id': approver_id,
            'sequence_order': 1,
            'status': 'pending',
            'is_required': True
        }).execute()
        print(f'  expense {exp_id} (by {emp_name}): FIXED - created approval row -> approver {approver_id}')
        fixed += 1
    except Exception as e:
        print(f'  expense {exp_id}: ERROR inserting approval row: {e}')

print(f'\nDone! Fixed {fixed} expenses.')
