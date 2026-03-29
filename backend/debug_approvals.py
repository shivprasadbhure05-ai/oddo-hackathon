import os, asyncio
from dotenv import load_dotenv
load_dotenv()
from app.db import supabase_admin

# Check existing pending expenses for active employees - do they have approval rows?
active_employees = ['7624edc0-fddf-4d3e-a0e6-c4a04b26ca15', '3283c20f-2606-4143-8678-1ae2f591bbf0', 'c512771d-c77c-471c-835d-5fbe5bc8f060']

print('=== Pending expenses for ACTIVE employees ===')
for emp_id in active_employees:
    expenses = supabase_admin.table('expenses').select('id, status').eq('employee_id', emp_id).execute()
    for exp in expenses.data:
        print(f'expense {exp["id"]} status={exp["status"]}')
        approvals = supabase_admin.table('expense_approvals').select('*').eq('expense_id', exp['id']).execute()
        if approvals.data:
            for a in approvals.data:
                print(f'  -> approval approver={a["approver_id"]} status={a["status"]}')
        else:
            print(f'  -> NO APPROVAL ROWS! (expense is {exp["status"]} with no approver assigned)')

print()
print('=== Manager ID for active employees ===')
for emp_id in active_employees:
    user = supabase_admin.table('users').select('name, manager_id').eq('id', emp_id).single().execute()
    print(f'employee={user.data["name"]} manager_id={user.data["manager_id"]}')

print()
print('=== Simulating submit for active employee expense ===')
# Find a pending expense for an active employee
test_exp_id = '1d319903-f13e-4484-a9ff-2728e618cd32'  # prajwal's expense
test_emp_id = '7624edc0-fddf-4d3e-a0e6-c4a04b26ca15'  # prajwal
manager_id = 'dbfec776-dded-4a0f-8814-23b462d546b4'  # madhur

print(f'Manually inserting approval row for expense {test_exp_id} -> approver={manager_id}')
try:
    result = supabase_admin.table('expense_approvals').insert({
        'expense_id': test_exp_id,
        'approver_id': manager_id,
        'sequence_order': 1,
        'status': 'pending',
        'is_required': True
    }).execute()
    print('Success:', result.data)
except Exception as e:
    print('ERROR:', e)
