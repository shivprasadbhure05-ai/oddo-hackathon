-- ============================================================
-- REIMBURSEMENT MANAGEMENT — ROW LEVEL SECURITY POLICIES
-- Run this AFTER schema.sql in Supabase → SQL Editor
-- ============================================================

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
ALTER TABLE companies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rule_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_approval_rules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_approvals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- HELPER FUNCTION: Get current user's company_id
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
    SELECT company_id FROM users WHERE id = auth.uid();
$$;

-- ============================================================
-- HELPER FUNCTION: Get current user's role
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql STABLE
AS $$
    SELECT role FROM users WHERE id = auth.uid();
$$;


-- ============================================================
-- TABLE: companies
-- ============================================================
-- Drop existing policies before recreating
DROP POLICY IF EXISTS "Users can read their own company" ON companies;

-- Users can only see their own company
CREATE POLICY "Users can read their own company"
    ON companies FOR SELECT
    USING (id = get_my_company_id());

-- No direct INSERT from frontend — backend service role only
-- No UPDATE or DELETE from frontend


-- ============================================================
-- TABLE: users
-- ============================================================
DROP POLICY IF EXISTS "Users can read themselves" ON users;
DROP POLICY IF EXISTS "Admin can read all company users" ON users;
DROP POLICY IF EXISTS "Manager can read their team" ON users;
DROP POLICY IF EXISTS "Admin can insert users in their company" ON users;
DROP POLICY IF EXISTS "Admin can update users in their company" ON users;

-- Any user can see their own row
CREATE POLICY "Users can read themselves"
    ON users FOR SELECT
    USING (id = auth.uid());

-- Admin can read ALL users in their company
CREATE POLICY "Admin can read all company users"
    ON users FOR SELECT
    USING (
        get_my_role() = 'admin'
        AND company_id = get_my_company_id()
    );

-- Manager can read users who report to them (manager_id = their id)
CREATE POLICY "Manager can read their team"
    ON users FOR SELECT
    USING (
        get_my_role() = 'manager'
        AND manager_id = auth.uid()
        AND company_id = get_my_company_id()
    );

-- Admin can INSERT new users in their company
CREATE POLICY "Admin can insert users in their company"
    ON users FOR INSERT
    WITH CHECK (
        get_my_role() = 'admin'
        AND company_id = get_my_company_id()
    );

-- Admin can UPDATE users in their company
CREATE POLICY "Admin can update users in their company"
    ON users FOR UPDATE
    USING (
        get_my_role() = 'admin'
        AND company_id = get_my_company_id()
    );


-- ============================================================
-- TABLE: expenses
-- ============================================================
DROP POLICY IF EXISTS "Employee can read own expenses" ON expenses;
DROP POLICY IF EXISTS "Manager can read team expenses" ON expenses;
DROP POLICY IF EXISTS "Admin can read all company expenses" ON expenses;
DROP POLICY IF EXISTS "Employee can insert own expenses" ON expenses;
DROP POLICY IF EXISTS "Employee can update own draft expenses" ON expenses;

-- Employee: only their own expenses
CREATE POLICY "Employee can read own expenses"
    ON expenses FOR SELECT
    USING (
        employee_id = auth.uid()
        AND company_id = get_my_company_id()
    );

-- Manager: expenses from employees they manage
CREATE POLICY "Manager can read team expenses"
    ON expenses FOR SELECT
    USING (
        get_my_role() IN ('manager', 'admin')
        AND company_id = get_my_company_id()
        AND employee_id IN (
            SELECT id FROM users
            WHERE manager_id = auth.uid()
              AND company_id = get_my_company_id()
        )
    );

-- Admin: all expenses in their company
CREATE POLICY "Admin can read all company expenses"
    ON expenses FOR SELECT
    USING (
        get_my_role() = 'admin'
        AND company_id = get_my_company_id()
    );

-- Also allow managers/admins who are approvers to read those expenses
CREATE POLICY "Approver can read assigned expenses"
    ON expenses FOR SELECT
    USING (
        company_id = get_my_company_id()
        AND id IN (
            SELECT expense_id FROM expense_approvals
            WHERE approver_id = auth.uid()
        )
    );

-- Employee can INSERT their own expenses
CREATE POLICY "Employee can insert own expenses"
    ON expenses FOR INSERT
    WITH CHECK (
        employee_id = auth.uid()
        AND company_id = get_my_company_id()
    );

-- Employee can UPDATE only their OWN DRAFT expenses
CREATE POLICY "Employee can update own draft expenses"
    ON expenses FOR UPDATE
    USING (
        employee_id = auth.uid()
        AND status = 'draft'
        AND company_id = get_my_company_id()
    );


-- ============================================================
-- TABLE: approval_rules
-- ============================================================
DROP POLICY IF EXISTS "Admin can manage approval rules" ON approval_rules;
DROP POLICY IF EXISTS "All company members can read approval rules" ON approval_rules;

-- Admin can do everything with rules in their company
CREATE POLICY "Admin can manage approval rules"
    ON approval_rules FOR ALL
    USING (
        get_my_role() = 'admin'
        AND company_id = get_my_company_id()
    );

-- All users can read rules (needed for approval engine display)
CREATE POLICY "All company members can read approval rules"
    ON approval_rules FOR SELECT
    USING (company_id = get_my_company_id());


-- ============================================================
-- TABLE: approval_rule_approvers
-- ============================================================
DROP POLICY IF EXISTS "Admin can manage rule approvers" ON approval_rule_approvers;
DROP POLICY IF EXISTS "Company members can read rule approvers" ON approval_rule_approvers;

CREATE POLICY "Admin can manage rule approvers"
    ON approval_rule_approvers FOR ALL
    USING (
        get_my_role() = 'admin'
        AND rule_id IN (
            SELECT id FROM approval_rules WHERE company_id = get_my_company_id()
        )
    );

CREATE POLICY "Company members can read rule approvers"
    ON approval_rule_approvers FOR SELECT
    USING (
        rule_id IN (
            SELECT id FROM approval_rules WHERE company_id = get_my_company_id()
        )
    );


-- ============================================================
-- TABLE: user_approval_rules
-- ============================================================
DROP POLICY IF EXISTS "Admin can manage user rule assignments" ON user_approval_rules;
DROP POLICY IF EXISTS "Users can read their own rule assignment" ON user_approval_rules;

CREATE POLICY "Admin can manage user rule assignments"
    ON user_approval_rules FOR ALL
    USING (
        get_my_role() = 'admin'
        AND company_id = get_my_company_id()
    );

CREATE POLICY "Users can read their own rule assignment"
    ON user_approval_rules FOR SELECT
    USING (user_id = auth.uid());


-- ============================================================
-- TABLE: expense_approvals
-- ============================================================
DROP POLICY IF EXISTS "Approver can read their approval rows" ON expense_approvals;
DROP POLICY IF EXISTS "Employee can read approvals for their expenses" ON expense_approvals;
DROP POLICY IF EXISTS "Admin can read all company approval rows" ON expense_approvals;

-- Approver can see their own rows
CREATE POLICY "Approver can read their approval rows"
    ON expense_approvals FOR SELECT
    USING (approver_id = auth.uid());

-- Employee can see who is approving their expense
CREATE POLICY "Employee can read approvals for their expenses"
    ON expense_approvals FOR SELECT
    USING (
        expense_id IN (
            SELECT id FROM expenses WHERE employee_id = auth.uid()
        )
    );

-- Admin can read all approval rows in their company
CREATE POLICY "Admin can read all company approval rows"
    ON expense_approvals FOR SELECT
    USING (
        get_my_role() = 'admin'
        AND expense_id IN (
            SELECT id FROM expenses WHERE company_id = get_my_company_id()
        )
    );

-- Only backend service role can INSERT/UPDATE expense_approvals
-- (no frontend insert policy)


-- ============================================================
-- TABLE: audit_log
-- ============================================================
DROP POLICY IF EXISTS "Employee can read own expense audit logs" ON audit_log;
DROP POLICY IF EXISTS "Approver can read audit logs for their expenses" ON audit_log;
DROP POLICY IF EXISTS "Admin can read all company audit logs" ON audit_log;

-- Employee can read audit log for their own expenses
CREATE POLICY "Employee can read own expense audit logs"
    ON audit_log FOR SELECT
    USING (
        expense_id IN (
            SELECT id FROM expenses WHERE employee_id = auth.uid()
        )
    );

-- Approver can read audit log for expenses they are assigned to
CREATE POLICY "Approver can read audit logs for their expenses"
    ON audit_log FOR SELECT
    USING (
        expense_id IN (
            SELECT expense_id FROM expense_approvals WHERE approver_id = auth.uid()
        )
    );

-- Admin can read all audit logs in their company
CREATE POLICY "Admin can read all company audit logs"
    ON audit_log FOR SELECT
    USING (
        get_my_role() = 'admin'
        AND expense_id IN (
            SELECT id FROM expenses WHERE company_id = get_my_company_id()
        )
    );

-- NO INSERT, UPDATE, DELETE policies for audit_log from frontend.
-- Only the backend service role (bypasses RLS) can write here.


-- ============================================================
-- DONE — All RLS policies applied.
-- Test with 2 separate company signups to verify isolation.
-- ============================================================
