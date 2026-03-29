-- ============================================================
-- REIMBURSEMENT MANAGEMENT — COMPLETE DATABASE SCHEMA
-- Run this entire file in Supabase → SQL Editor
-- ============================================================


-- ============================================================
-- STEP 1: ENABLE UUID EXTENSION
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- TABLE 1: companies
-- One row per company. Created when the first admin signs up.
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text        NOT NULL,
    base_currency text        NOT NULL,   -- e.g. "INR", "USD"
    country       text        NOT NULL,
    created_at    timestamptz DEFAULT now()
);


-- ============================================================
-- TABLE 2: users
-- Every person in the system. Matches Supabase auth user ID.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id         uuid        PRIMARY KEY,  -- MUST match auth.users.id
    company_id uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    email      text        NOT NULL,
    role       text        NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
    manager_id uuid        REFERENCES users(id) ON DELETE SET NULL,
    is_active  bool        DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- One admin per company — enforced at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS one_admin_per_company
    ON users(company_id)
    WHERE role = 'admin';

-- Indexes for common lookup patterns
CREATE INDEX IF NOT EXISTS idx_users_company_id  ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_manager_id  ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_role        ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);


-- ============================================================
-- TABLE 3: expenses
-- One row per expense claim submitted by an employee.
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    employee_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount          numeric     NOT NULL CHECK (amount > 0),
    currency        text        NOT NULL,
    amount_in_base  numeric,               -- Frozen at submission time
    conversion_rate numeric,               -- Rate used at submission time
    category        text        NOT NULL CHECK (category IN ('Food', 'Travel', 'Accommodation', 'Miscellaneous', 'Other')),
    description     text,
    paid_by         text,                  -- Defaults to employee name, can be overridden
    remarks         text,
    expense_date    date        NOT NULL,
    receipt_url     text,
    status          text        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_company_id   ON expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_expenses_employee_id  ON expenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status       ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);

-- Auto-update `updated_at` on any row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_expenses_updated_at ON expenses;
CREATE TRIGGER set_expenses_updated_at
    BEFORE UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- TABLE 4: approval_rules
-- Defines who approves expenses and under what conditions.
-- ============================================================
CREATE TABLE IF NOT EXISTS approval_rules (
    id                      uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              uuid    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name                    text    NOT NULL,
    description             text,
    min_approval_percentage numeric CHECK (min_approval_percentage BETWEEN 0 AND 100),
    required_approver_id    uuid    REFERENCES users(id) ON DELETE SET NULL,
    use_sequence            bool    NOT NULL DEFAULT false,  -- true=sequential, false=parallel
    include_manager         bool    NOT NULL DEFAULT false,  -- inject employee's manager as step 0
    manager_override_id     uuid    REFERENCES users(id) ON DELETE SET NULL,  -- override manager per-rule
    created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_rules_company_id ON approval_rules(company_id);


-- ============================================================
-- TABLE 5: approval_rule_approvers
-- The list of approvers for a rule, ordered by sequence.
-- ============================================================
CREATE TABLE IF NOT EXISTS approval_rule_approvers (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id        uuid NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
    user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sequence_order int  NOT NULL,
    is_required    bool NOT NULL DEFAULT false,
    UNIQUE (rule_id, sequence_order),
    UNIQUE (rule_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ara_rule_id ON approval_rule_approvers(rule_id);
CREATE INDEX IF NOT EXISTS idx_ara_user_id ON approval_rule_approvers(user_id);


-- ============================================================
-- TABLE 6: user_approval_rules
-- Maps each employee to their assigned approval rule.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_approval_rules (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rule_id    uuid NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    UNIQUE (user_id)  -- one active rule per user
);

CREATE INDEX IF NOT EXISTS idx_uar_user_id ON user_approval_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_uar_rule_id ON user_approval_rules(rule_id);


-- ============================================================
-- TABLE 7: expense_approvals
-- One row per approver per expense — tracks the approval flow.
-- ============================================================
CREATE TABLE IF NOT EXISTS expense_approvals (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id     uuid        NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    approver_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sequence_order int         NOT NULL,
    is_required    bool        NOT NULL DEFAULT false,
    status         text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected', 'inactive')),
    comment        text,
    actioned_at    timestamptz,
    UNIQUE (expense_id, approver_id)
);

CREATE INDEX IF NOT EXISTS idx_ea_expense_id  ON expense_approvals(expense_id);
CREATE INDEX IF NOT EXISTS idx_ea_approver_id ON expense_approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_ea_status      ON expense_approvals(status);


-- ============================================================
-- TABLE 8: audit_log
-- Immutable history of every status change. Never UPDATE or DELETE.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id uuid        NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    actor_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action     text        NOT NULL,  -- "submitted" | "approved" | "rejected" | "auto_approved" | "auto_rejected"
    old_status text,
    new_status text,
    comment    text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_expense_id ON audit_log(expense_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id   ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- Prevent any UPDATE or DELETE on audit_log (immutability enforced at DB level)
CREATE OR REPLACE FUNCTION block_audit_log_mutations()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log rows are immutable — no updates or deletes allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_update_audit_log ON audit_log;
CREATE TRIGGER no_update_audit_log
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION block_audit_log_mutations();


-- ============================================================
-- DONE — All 8 tables created with indexes, constraints, triggers
-- Next step: run rls_policies.sql to enable Row Level Security
-- ============================================================
