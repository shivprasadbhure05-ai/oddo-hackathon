# 🧾 Reimbursement Management — Complete Build Roadmap

> **How to use this doc:** Follow phases in order. Every phase ends with a **Savepoint** — a checklist you manually test before moving to the next phase. If a savepoint check fails, fix it before going further. Skipping savepoints is how bugs multiply silently.

**Stack you're building with:**
- **Frontend** → React (Vite)
- **Backend** → FastAPI (Python)
- **Database + Auth** → Supabase
- **Frontend Deploy** → Vercel (free)
- **Backend Deploy** → Render.com (free)
- **Country + Currency data** → `https://restcountries.com/v3.1/all?fields=name,currencies`
- **Live currency conversion** → `https://api.exchangerate-api.com/v4/latest/{BASE_CURRENCY}`

---

## 📊 Phase Summary Table

| Phase | What you build | Est. time | Highest risk if skipped/rushed |
|---|---|---|---|
| 0 — Setup | Schema, RLS, env vars | 1–2 hrs | Missing RLS = any user reads any company's data |
| 1 — Auth | Signup + login + company bootstrap | 2–3 hrs | Bad transaction = orphan users with no company |
| 2 — User mgmt | Create users, roles, manager links | 2–3 hrs | Role change while approvals are pending |
| 3 — Expenses | Submit form, draft→pending, currency freeze | 3–4 hrs | Unfrozen exchange rate breaks historical reports |
| 4 — Approval rules | Rule builder UI + approval engine backend | 4–5 hrs | Sequential vs parallel vs % vs required combos |
| 5 — Manager view | Review queue, approve/reject | 2–3 hrs | Frontend hides buttons but backend doesn't validate turn |
| 6 — OCR | Receipt scan → auto-fill form | 2–3 hrs | OCR fails and blocks expense submission entirely |
| 7 — Polish | Errors, loading states, deploy | 2–3 hrs | CORS not locked = open to cross-origin attacks |

---

---

# PHASE 0 — Project Setup & Schema Design

> **Foundation — get this right or everything breaks later**
> ⏱ Est. time: 1–2 hrs

This phase has zero UI work. It's all setup and database design. Rushing Phase 0 is the #1 cause of mid-project rewrites. Every table you design here will affect every API you write later. Do not skip or shortcut this.

---

## Task 0.1 — Repo & environment bootstrap
`[FRONTEND + BACKEND]`

Set up your project structure so both frontend and backend live together cleanly.

- Create a **monorepo** — one root folder, with `/frontend` (React Vite) and `/backend` (FastAPI) inside it
- In the root, create a `.env.example` file listing every environment variable the project needs — this is what you commit to git so teammates (or your future self) know what to fill in. **Never commit the real `.env` file with actual keys**
- The keys you'll need across the project:
  - `SUPABASE_URL` — the URL of your Supabase project (found in Supabase dashboard → Settings → API)
  - `SUPABASE_ANON_KEY` — the public anon key for frontend Supabase calls
  - `SUPABASE_SERVICE_ROLE_KEY` — the secret key for backend-only admin-level DB operations (never expose this to frontend)
  - `JWT_SECRET` — a random string used to sign your auth tokens
  - `EXCHANGE_API_KEY` — your key for the exchange rate API (if the free tier requires one)

> 💡 **What is a monorepo?** Just a single git repo that holds both your frontend and backend folders. You don't need any fancy tooling — just a folder structure like `my-project/frontend/` and `my-project/backend/`.

---

## Task 0.2 — Database schema — design ALL tables before writing a single API
`[DATABASE]`

> Design all tables now. Changing your schema mid-project causes cascading bugs across every API endpoint and every frontend query. This is the most important 30 minutes of the entire project.

Here are all the tables you need. Create these in Supabase → SQL Editor:

### `companies`
Stores one row per company. Created automatically when the first admin signs up.
```
id            uuid  PRIMARY KEY
name          text  NOT NULL
base_currency text  NOT NULL   -- e.g. "INR", "USD" — set from country selection on signup
country       text  NOT NULL
created_at    timestamptz  DEFAULT now()
```

### `users`
Every person in the system — admin, manager, or employee. All belong to one company.
```
id          uuid  PRIMARY KEY  -- matches Supabase auth user id
company_id  uuid  REFERENCES companies(id)
name        text  NOT NULL
email       text  NOT NULL
role        text  NOT NULL  -- "admin" | "manager" | "employee"
manager_id  uuid  REFERENCES users(id)  -- who is this person's direct manager?
is_active   bool  DEFAULT true
created_at  timestamptz  DEFAULT now()
```

### `expenses`
One row per expense claim submitted by an employee.
```
id              uuid  PRIMARY KEY
company_id      uuid  REFERENCES companies(id)
employee_id     uuid  REFERENCES users(id)
amount          numeric  NOT NULL         -- original amount (e.g. 567)
currency        text  NOT NULL            -- original currency (e.g. "USD")
amount_in_base  numeric                   -- converted to company base currency, frozen at submission
conversion_rate numeric                   -- the rate used at submission time — store this!
category        text  NOT NULL            -- "Food", "Travel", etc.
description     text
expense_date    date  NOT NULL
receipt_url     text                      -- Supabase Storage URL
status          text  DEFAULT 'draft'     -- "draft" | "pending" | "approved" | "rejected"
created_at      timestamptz  DEFAULT now()
updated_at      timestamptz  DEFAULT now()
```

### `approval_rules`
A rule defines who approves expenses and under what conditions.
```
id                        uuid  PRIMARY KEY
company_id                uuid  REFERENCES companies(id)
name                      text  NOT NULL   -- e.g. "Miscellaneous expenses rule"
description               text
min_approval_percentage   numeric          -- e.g. 60 means 60% of approvers must approve. NULL = all must approve
required_approver_id      uuid  REFERENCES users(id)  -- if set, this person's approval is always mandatory
use_sequence              bool  DEFAULT false  -- true = sequential, false = parallel (all at once)
```

### `approval_rule_approvers`
The actual list of approvers for a rule, in order.
```
id              uuid  PRIMARY KEY
rule_id         uuid  REFERENCES approval_rules(id)
user_id         uuid  REFERENCES users(id)
sequence_order  int   NOT NULL   -- 1, 2, 3... (only matters if use_sequence = true)
is_required     bool  DEFAULT false  -- if true, this person's approval is mandatory regardless of % rule
```

### `expense_approvals`
One row per approver per expense — tracks where each expense is in the flow.
```
id              uuid  PRIMARY KEY
expense_id      uuid  REFERENCES expenses(id)
approver_id     uuid  REFERENCES users(id)
sequence_order  int   NOT NULL
status          text  DEFAULT 'pending'  -- "pending" | "approved" | "rejected" | "inactive"
comment         text                     -- approver's comment when they act
actioned_at     timestamptz              -- when they approved/rejected
```

> 💡 **Why `inactive` status?** In sequential mode, approvers after the current step shouldn't act yet. Setting them to `inactive` initially means the manager dashboard only shows `pending` rows — so approver 2 won't even see the expense until approver 1 has acted.

### `audit_log`
An immutable history of every status change on every expense. Never update or delete rows here.
```
id          uuid  PRIMARY KEY
expense_id  uuid  REFERENCES expenses(id)
actor_id    uuid  REFERENCES users(id)   -- who performed this action
action      text  NOT NULL               -- "submitted", "approved", "rejected", "auto_approved", etc.
old_status  text
new_status  text
comment     text
created_at  timestamptz  DEFAULT now()
```

---

## Task 0.3 — Supabase RLS (Row Level Security) policies
`[DATABASE]` 🔴 **CRITICAL**

> Without RLS, if someone gets hold of your Supabase anon key (which is public in your frontend), they can read every single company's data — all expenses, all users, everything. RLS locks this down at the database level, not just in your API. Set it NOW before writing any data.

Turn on RLS for every table in Supabase → Table Editor → click the table → toggle RLS on.

Then write these policies (in Supabase → Authentication → Policies):

**On `expenses` table:**
- Employees can only SELECT rows where `employee_id = auth.uid()`
- Managers can SELECT rows where the expense's `employee_id` belongs to a user whose `manager_id = auth.uid()`
- Admin can SELECT all rows where `company_id` matches their own company's id
- No user can SELECT anything from a different company — ever

**On `users` table:**
- Users can read their own row
- Admin can read/write all users in their `company_id`
- Managers can read users in their team

**On `audit_log`:**
- Everyone can read logs for expenses they are involved with (employee, approver, or admin of that company)
- Nobody can INSERT directly into audit_log from the frontend — only the backend service role writes here

> 💡 **How to test RLS is working:** Create 2 companies (2 signup flows). Log in as a user from Company A. Try to fetch expenses from Company B directly via the Supabase JS client. If RLS is correct, you get zero rows. If you get data, your policies are wrong.

---

## ✅ Savepoint 0 — Schema & infra verified

Before moving to Phase 1, confirm all of these manually:

- [ ] All 7 tables exist in Supabase with correct column types and foreign keys
- [ ] RLS is enabled on every table (not just created — actually toggled ON)
- [ ] You tested with 2 dummy users from 2 different companies — they cannot see each other's data
- [ ] `.env.example` file exists at project root with all key names documented (no real values)
- [ ] Both `/frontend` and `/backend` folders exist and run locally without errors

---

---

# PHASE 1 — Auth: Signup, Login, Company Auto-Creation

> Signup page · Signin page · Company bootstrapping · Password flow
> ⏱ Est. time: 2–3 hrs

This phase builds the entry point for every user. The most important thing here is the **signup transaction** — creating the company and the admin user must happen atomically (both succeed or both fail).

---

## Task 1.1 — Signup page: Admin + Company creation
`[FRONTEND + BACKEND]` 🔴 **CRITICAL**

> From the Excalidraw mockup, the signup page has these fields: **Name, Email, Password, Confirm Password, Country selection (dropdown)**.

**Frontend:**
- Build the signup form with all 5 fields
- The Country field is a searchable dropdown populated from `https://restcountries.com/v3.1/all?fields=name,currencies`
- **Cache this API response** — fetch it once when the app loads (in a React context or Zustand store) and reuse it everywhere. Do NOT call it on every keystroke or every time the component mounts. The list has 250+ countries and calling it repeatedly will either slow the page or get you rate-limited
- From each country object, extract the currency code (e.g. India → `INR`, USA → `USD`) to store as the company's `base_currency`

**Backend (what happens when the form submits):**
1. Call Supabase Auth to create the user account
2. Create a new row in `companies` table with the selected country's currency as `base_currency`
3. Create a new row in `users` table with `role = 'admin'` and the new `company_id`
4. **Do all 3 steps in a database transaction** — if step 2 or 3 fails, roll back step 1 too. Otherwise you end up with a Supabase auth user that has no corresponding company or users row, and the app breaks for that person

**Important constraint from mockup (written in red):**
- Only **1 admin per company** is allowed
- Enforce this with a **unique partial index** in your database: `CREATE UNIQUE INDEX one_admin_per_company ON users(company_id) WHERE role = 'admin';`
- Don't just check this in the frontend — the DB constraint is the real safety net

---

## Task 1.2 — Signin page + "Forgot password" flow
`[FRONTEND + BACKEND]`

> From the mockup: The signin page has **Email** and **Password** fields, a **"Don't have an account? Signup"** link, and a **"Forgot password?"** link.

**Signin:**
- Standard email + password login via Supabase Auth
- On success, read the user's `role` from the `users` table and redirect accordingly:
  - `admin` → `/admin` dashboard
  - `manager` → `/manager` dashboard
  - `employee` → `/employee` dashboard
- Store the JWT token either in `httpOnly` cookie (more secure) or `localStorage` (simpler). Pick one and be consistent everywhere — mixing them causes random logout bugs

**Forgot password flow (from the Excalidraw mockup):**
- User clicks "Forgot password?" → enters their email
- The system sends a **randomly generated unique password** to that email address
- The user logs in with that temp password and can then change it from their profile
- Implementation options:
  - Use **Supabase Auth's built-in** `resetPasswordForEmail()` — easiest
  - Or generate a random password in your FastAPI backend and send it via **SendGrid** or **Resend** (both have generous free tiers)

---

## Task 1.3 — Route guards & role-based redirects
`[FRONTEND]`

Protect every page so users can only access what their role allows.

- Wrap your React Router routes in a `ProtectedRoute` component that checks if the user is logged in. If not, redirect to `/login`
- Add a second layer: `RoleProtectedRoute` that checks the user's role. If an employee navigates to `/admin`, show a proper 403 page — not a crash, not a blank screen
- After login, always redirect to the correct dashboard based on role — don't send everyone to the same page and make them figure it out

---

> ⚠️ **GOTCHA — Country Dropdown Performance**
> The restcountries API returns 250+ countries. If you call it every time the signup page mounts, you'll hammer the API and slow the page down. Fetch it **once** on app load (e.g. in your root `App.jsx` inside a `useEffect`) and store it in React Context or Zustand. Every component that needs the country list just reads from the store — zero extra API calls.

---

## ✅ Savepoint 1 — Auth fully working end-to-end

- [ ] Sign up as a new Admin → check Supabase dashboard → `companies` row exists with correct `base_currency` → `users` row exists with `role = 'admin'`
- [ ] Login with that admin → lands on admin dashboard, not employee dashboard
- [ ] Create a second signup → try logging in as first admin → still works, both companies are separate
- [ ] "Forgot password?" flow → email received → temp password works → can log in
- [ ] Two admins cannot be created for the same company (test by trying to insert directly in Supabase — the unique index should reject it)
- [ ] Log out → session is fully cleared → can't access protected routes without logging in again

---

---

# PHASE 2 — Admin: User Management

> Create users · Assign roles · Set manager relationships
> ⏱ Est. time: 2–3 hrs

The admin dashboard is where the company's org chart gets built. This phase produces the user table and the ability to manage everyone in the company.

---

## Task 2.1 — User creation with auto-generated password
`[FRONTEND + BACKEND]`

> From the Excalidraw mockup: Admin fills in **Name**, **Email**, **Role** for the new user. Then clicks a **"Send password"** button. The new user receives an email with their login credentials.

- The admin never manually types a password for the new user — the backend generates one
- **Backend flow:**
  1. Admin submits name + email + role via the form
  2. Backend generates a random secure password (e.g. `secrets.token_urlsafe(12)` in Python)
  3. Backend calls Supabase Admin API to create the auth user with that email + generated password
  4. Backend creates the `users` row in your DB with the correct `company_id` and `role`
  5. Backend emails the new user their login credentials (email + password) using SendGrid, Resend, or Supabase's built-in email
- **Important from mockup note:** The user dropdowns throughout the app (e.g. when selecting a manager for an employee) should support **create-on-type** — if the admin types a name that doesn't exist yet, they should be able to create that user on the fly without leaving the form. Think of it like a combobox that has a "+ Create new user" option at the bottom.

---

## Task 2.2 — Manager assignment per employee
`[FRONTEND + BACKEND]`

> From the mockup: The user management table has columns — **User, Role, Manager**. Example row: `marc | Manager | sarah` (meaning marc's manager is sarah).

- Every employee and manager row in the table should have an editable **Manager** dropdown
- The dropdown only shows users whose `role = 'manager'` within the same `company_id` — you can't assign someone from a different company as a manager, and you can't assign a regular employee as a manager
- **A manager can also have a manager** assigned to them — this supports escalation chains where a manager's expense might need their own manager to approve it
- When admin selects a manager for a user, update `manager_id` in the `users` table for that user

---

## Task 2.3 — Role change (promote/demote)
`[FRONTEND + BACKEND]`

- Admin should be able to change any user's role between `employee` and `manager` at any time via a dropdown in the user table
- **Edge case you must handle:** If you demote a Manager to Employee while that manager has **pending approval requests** sitting in their queue (i.e. expenses waiting for their signature), those approvals don't just disappear. You must either:
  - Automatically reassign them to someone else, OR
  - Flag the admin with a warning: "This manager has 3 pending approvals. Please reassign before changing role."
- The `admin` role itself **cannot be changed**. There is exactly 1 admin per company — they cannot be demoted. Show a disabled dropdown for the admin row.

---

## ✅ Savepoint 2 — User management complete

- [ ] Admin creates a new employee → employee receives an email → employee logs in successfully
- [ ] Admin creates a new manager → manager shows up in manager dropdowns throughout the app
- [ ] Manager relationship is saved and visible in the user table (e.g. marc → sarah)
- [ ] Admin changes a user's role → role is reflected on their very next login
- [ ] Employee cannot navigate to the admin user management page (403 redirect)
- [ ] Trying to demote a manager with pending approvals shows a warning

---

---

# PHASE 3 — Expense Submission (Employee View)

> Create · Draft state · Submit · Read-only after submit · Status tracking
> ⏱ Est. time: 3–4 hrs

This is the core employee experience. Everything they do starts here — creating an expense, attaching a receipt, and submitting it for approval.

---

## Task 3.1 — Expense form: all fields from mockup
`[FRONTEND]`

> From the Excalidraw mockup, the expense form has these fields: **Description, Category, Total amount + currency selector, Paid by, Remarks, Expense Date, Attach Receipt.**

Build the form with all of these:

- **Description** — free text, what the expense was for (e.g. "Restaurant bill")
- **Category** — dropdown: Food, Travel, Accommodation, Miscellaneous, etc. (you can hardcode these for now)
- **Total amount** — a number input, PLUS a separate **currency dropdown** next to it. The employee might be in the US and paid in USD, but the company's base currency is INR — they enter `567 USD` and the system handles conversion
- **Paid by** — defaults to the logged-in employee's name, but can be changed (e.g. if someone paid on behalf of another person)
- **Remarks** — optional extra notes field
- **Expense Date** — date picker, defaults to today
- **Attach Receipt** — file upload input that accepts images (JPG, PNG) and PDFs. This file goes to **Supabase Storage**, and the returned URL is stored in the `receipt_url` field on the expense

**Two separate save actions:**
- **Save Draft** → saves the expense with `status = 'draft'`. Employee can come back and edit it later. Nothing is locked yet.
- **Submit** → actually submits for approval. This triggers the approval engine (Phase 4). After this, the form locks.

---

## Task 3.2 — Currency conversion on submit
`[BACKEND]` 🔴 **CRITICAL**

> From the mockup: the manager's view shows **"567 $ (in INR) = 49896"** — the system automatically shows the converted amount.

This is one of the most important things to get right. Here's exactly what to do:

**When the employee clicks Submit:**
1. Call `https://api.exchangerate-api.com/v4/latest/{BASE_CURRENCY}` where `BASE_CURRENCY` is the company's currency (e.g. `INR`)
2. Get the conversion rate for the expense's currency (e.g. USD → INR rate = 88.something)
3. Calculate `amount_in_base = amount × rate` (e.g. 567 × 88.12 = 49,964)
4. Save **three things** to the expense row:
   - `amount` = 567 (the original)
   - `currency` = "USD" (the original currency)
   - `amount_in_base` = 49964 (the converted value)
   - `conversion_rate` = 88.12 (the rate used — save this too!)

**The golden rule: NEVER recompute this conversion after submission.**
Once an expense is submitted, its `amount_in_base` is frozen forever. If the exchange rate changes tomorrow, this expense's converted value stays the same. This is correct — it reflects what the expense actually cost at the time it was filed. If you recalculate dynamically, your historical reports will show different totals every day, which is a financial nightmare.

---

## Task 3.3 — Status pipeline: Draft → Pending → Approved/Rejected
`[FRONTEND + BACKEND]` 🔴 **CRITICAL**

> From the mockup (in red text): *"Once submitted the record should become readonly for employee and the submit button should be invisible and state should be pending approval. Now, there should be a log history visible that which user approved/rejected your request at what time."*

**Status flow:**
```
draft  →  pending  →  approved
                  ↘  rejected
```

**What changes at each stage:**

`draft` state:
- Employee can edit all fields freely
- "Save Draft" and "Submit" buttons both visible
- No approval log shown yet (or show empty state)

`pending` state (immediately after Submit):
- **All form fields become read-only** — the employee cannot change anything
- **Submit button disappears entirely** from the UI
- An **approval log timeline** appears below the expense showing: `Approver | Status | Time`
  - Initially it shows the pending approvers with status "Waiting"
  - As approvers act, rows update with their name, action, and exact timestamp
  - From the mockup: `Sarah | Approved | 12:44 4th Oct, 2025`

`approved` / `rejected` state:
- Same read-only view as pending, but with final status shown prominently

**Critical backend enforcement:**
- The read-only behavior is not just a frontend concern. Your FastAPI `PATCH /expenses/{id}` endpoint must check the expense status. If `status != 'draft'`, return a `403 Forbidden` with message `"Expense cannot be edited after submission"`. Never trust the frontend to enforce this — anyone with the API URL and a tool like Postman can bypass your frontend.

---

## Task 3.4 — Employee dashboard: expense list with status sections
`[FRONTEND]`

> From the mockup: The employee dashboard shows **3 distinct buckets** of expenses:
> - `"5467 rs — To submit"` → these are Draft expenses
> - `"33674 rs — Waiting approval"` → these are Pending expenses
> - `"500 rs — Approved"` → these are Approved expenses

Build this as either:
- **3 separate sections** on one page (like columns or stacked groups)
- Or **filter tabs**: Draft | Pending | Approved | Rejected

Each expense card in the list should show: description, category, amount (in original currency), expense date, and current status badge.

The **"Attach Receipt"** button should only appear on **Draft** expense cards — once submitted, no new receipt uploads allowed.

---

> ⚠️ **GOTCHA — Exchange Rate API Rate Limits**
> The free tier of exchangerate-api.com has a monthly request limit (typically 1,500 requests/month on the free plan). If you call it every time an employee opens the expense form, you'll burn through that quickly.
>
> **Solution:** Cache the rates in your backend. When the backend needs to convert, check if you already fetched rates for that base currency today. If yes, use the cached value. If no (or it's from a previous day), fetch fresh rates and cache them. You can use a simple Python dict in memory for dev, or a Supabase table/Redis for production.

---

## ✅ Savepoint 3 — Expense submission working end-to-end

- [ ] Create a new expense → save as Draft → come back later → still editable ✓
- [ ] Submit the expense → all fields immediately become read-only ✓
- [ ] Submit button is gone after submission (not just grayed out — completely invisible) ✓
- [ ] An expense submitted in USD with a company currency of INR → `amount_in_base` stored correctly in the DB ✓
- [ ] `conversion_rate` also stored in the DB ✓
- [ ] Try to PATCH a submitted expense directly via the API → backend returns 403 ✓
- [ ] Approval log timeline is visible below the submitted expense (even if empty/pending) ✓
- [ ] Receipt file uploads successfully → URL stored in `receipt_url` column ✓

---

---

# PHASE 4 — Admin: Approval Rule Configuration

> The most complex backend logic in the entire project
> ⏱ Est. time: 4–5 hrs

This is where the real complexity lives. Read this section fully before writing any code. The approval engine is a distinct piece of logic — treat it as its own service/class, not scattered across random endpoints.

---

## Task 4.1 — Approval rule builder UI
`[FRONTEND]`

> From the Excalidraw mockup, the approval rule form has:
> - Rule name field
> - Description field
> - Manager field (dynamic dropdown — see note below)
> - Approvers list (a dynamic table of rows: sequence number | User dropdown | Required checkbox)
> - "Is manager an approver?" toggle
> - "Approvers Sequence" toggle
> - "Minimum Approval percentage" number input + "%" label

Build this form with all these fields:

**Approvers list (the dynamic rows):**
- Admin can add as many approver rows as they want
- Each row has a sequence number (1, 2, 3...), a user dropdown (showing all users in the company), and a "Required" checkbox
- From the mockup example: `1 | John`, `2 | Mitchell`, `3 | Andreas`
- Admin can remove rows too (delete button per row)
- The sequence number auto-assigns based on row order

**"Is manager an approver?" toggle:**
- From the mockup note: *"If this field is checked then by default the approve request would go to his/her manager first, before going to other approvers."*
- When ON: the employee's direct manager (the one set on their user record) is automatically inserted as **Step 0** — before John, before Mitchell, before anyone in the approvers list
- The manager doesn't appear as a manual row in the approvers list — it's injected dynamically by the system at approval time

**"Approvers Sequence" toggle:**
- From mockup note: *"If this field is ticked true then the above mentioned sequence of approvers matters — first the request goes to John, if he approves/rejects then only request goes to Mitchell and so on."*
- When **ON** (sequential): approval requests go one at a time in order. Approver 2 doesn't even see the expense until Approver 1 has acted.
- When **OFF** (parallel): all approvers get the request simultaneously. The expense is approved when the % condition is met.

**"Minimum Approval percentage" field:**
- A number from 0–100. E.g. `60` means at least 60% of the approvers must approve for the expense to be auto-approved.
- If left blank or set to 100: all approvers must approve.

**"Required" checkbox per approver:**
- From mockup note: *"If this field is ticked, then anyhow approval of this approver is required in any approval combination scenarios."*
- This overrides the percentage rule — even if 60% have approved, if the "Required" approver hasn't acted yet (or rejected), the expense does not auto-approve.

**Manager field (the top dropdown, not the approvers list):**
- From mockup note: *"Dynamic dropdown — initially the manager set on user record should be set, admin can change manager for approval if required."*
- This is a per-rule override — admin can say "for THIS rule, use Sarah as manager instead of the one on the user's record." Used when approval rules apply to a whole department but the default manager override is needed.

---

## Task 4.2 — Approval engine: the backend logic
`[BACKEND]` 🔴 **CRITICAL**

> This is the heart of the project. Build a dedicated `ApprovalEngine` Python class/service in your FastAPI backend. Don't scatter this logic across random endpoints.

### When an expense is submitted:

1. Look up which approval rule applies to this employee
2. Read the rule's settings: sequential or parallel? What % threshold? Any required approvers? Is manager approver checked?
3. Build the approval sequence:
   - If "Is manager approver" = true: create an `expense_approvals` row for the manager with `sequence_order = 0`
   - Then create rows for each approver in `approval_rule_approvers` with their sequence orders
4. If **sequential mode**: set the first approver's status to `pending`, all others to `inactive`
5. If **parallel mode**: set ALL approvers' status to `pending` simultaneously
6. Write an entry to `audit_log`: action = `"submitted"`, new_status = `"pending"`

### When an approver acts (approves or rejects):

1. Update their `expense_approvals` row: set status + comment + actioned_at
2. Write to `audit_log`
3. **Re-evaluate the rule condition:**

**Condition check for approval:**
```
approved_count = count of expense_approvals rows with status = 'approved'
total_count = total expense_approvals rows for this expense
percentage_met = (approved_count / total_count) * 100 >= min_approval_percentage
required_approvers_all_approved = all rows where is_required = true have status = 'approved'

if percentage_met AND required_approvers_all_approved:
    → set expense status = 'approved'
    → write audit_log
```

**Condition check for rejection:**
```
if a required approver rejects:
    → immediately set expense status = 'rejected' (skip remaining approvers)
    → write audit_log

if remaining approvers (including the one who just rejected) can no longer reach the % threshold:
    → set expense status = 'rejected'
    → write audit_log
```

**In sequential mode — after an approver acts:**
- If they approved AND the expense is not yet fully resolved: activate the **next** approver (set their status from `inactive` → `pending`)
- If they rejected: stop the chain, auto-reject the expense

### Always write to audit_log on every status change
Every single action — submit, approve, reject, auto-approve, auto-reject — must create a row in `audit_log`. This is what powers the approval timeline the employee sees.

---

## Task 4.3 — Rule assignment to users/departments
`[FRONTEND + BACKEND]`

- Admin needs to be able to assign a specific approval rule to a specific employee (or set a company-wide default rule)
- Add a field to the user record or a separate `user_approval_rules` join table: `employee_id → rule_id`
- When an expense is submitted: the backend looks up this mapping to find which rule to use
- **If no rule is assigned to an employee:** either use a company default rule (if you've set one up) OR block the submission with a clear error: `"No approval rule configured for this employee. Contact your admin."`
- Don't let an expense be submitted into a void with no approver — it'll get stuck forever

---

> 🔴 **EDGE CASES — You must handle all 4 of these:**
>
> **Edge case 1:** What if "Is manager approver" is checked but the employee has no manager assigned?
> → Block the expense submission with a validation error: `"You don't have a manager assigned. Contact your admin before submitting expenses."`
>
> **Edge case 2:** What if a required approver's account is deactivated (`is_active = false`) mid-approval — while an expense is already waiting for their signature?
> → Notify the admin (show a flag on the expense) and pause the flow. Don't auto-reject — the admin should be able to reassign.
>
> **Edge case 3:** Sequential mode + required approver at step 1 rejects:
> → Don't even activate steps 2 and 3. Immediately auto-reject the entire expense. The rejection of a required approver is final.
>
> **Edge case 4:** Parallel mode + 60% threshold + 3 approvers. Approvers 1 and 2 approve (that's 67% ≥ 60%):
> → The expense is **already approved** at this point. Approver 3's pending approval row should become invisible in their dashboard — they don't need to act, and there's nothing left for them to approve. Set their row to `status = 'inactive'` or similar.

---

## ✅ Savepoint 4 — Approval engine verified with all 4 scenarios

Test each scenario manually end-to-end before moving on:

- [ ] **Scenario A:** "Is manager approver" = ON, no other chain. Submit expense → manager sees it → manager approves → expense status = `approved` ✓
- [ ] **Scenario B:** Sequential chain (John → Mitchell → Andreas). Submit expense → **only John** sees it in his queue (Mitchell and Andreas see nothing yet) → John approves → Mitchell now sees it → and so on ✓
- [ ] **Scenario C:** Parallel + 60% (3 approvers). 2 out of 3 approve → expense auto-approves → 3rd approver's pending item disappears ✓
- [ ] **Scenario D:** Required approver in the chain rejects → expense immediately auto-rejects → remaining approvers see nothing ✓
- [ ] `audit_log` has a row for every action in all 4 scenarios ✓

---

---

# PHASE 5 — Manager View: Approval Dashboard

> Review queue · Approve/Reject with comments · Read-only after action
> ⏱ Est. time: 2–3 hrs

The manager dashboard is simpler than the approval engine — most of the hard logic is already done in Phase 4. This phase is about showing the right UI and enforcing the right constraints.

---

## Task 5.1 — Approval queue table
`[FRONTEND]`

> From the Excalidraw mockup, the manager's approval table has these columns:
> **Approval Subject | Request Owner | Category | Request Status | Total amount (in company's currency)**

Build this table:
- Query `expense_approvals` where `approver_id = current_user.id` AND `status = 'pending'`
- Join with `expenses` to get all the expense details
- **Total amount shown here is in the company's BASE currency** — use `amount_in_base` from the expense, not `amount`. Managers see in their own company's currency, not whatever currency the employee originally submitted in
- From the mockup: Show both: `"567 $ (in INR) = 49,896"` — display the original currency + original amount alongside the converted value. This gives context while keeping the comparison in base currency

---

## Task 5.2 — Approve / Reject with comment + read-only enforcement
`[FRONTEND + BACKEND]` 🔴 **CRITICAL**

> From the mockup (written in red): *"Once the expense is approved/rejected by manager, that record should become readonly, the status should get set in request status field and the buttons should become invisible."*

**Frontend:**
- Each row in the approval queue has an **Approve** button and a **Reject** button
- These buttons are **only visible** when:
  1. The expense `status = 'pending'`
  2. AND it is this approver's turn (in sequential mode, check that no earlier approver is still `pending`)
- When approving: optional comment field
- When rejecting: **comment is required** before the Reject button activates — don't let a manager reject silently
- After clicking Approve or Reject: buttons **disappear entirely** from the UI (not disabled — gone). The row becomes a read-only record of what they did.

**Backend — enforce this server-side:**
- The `POST /expenses/{id}/approve` and `POST /expenses/{id}/reject` endpoints must:
  1. Verify the requesting user actually has a `pending` row in `expense_approvals` for this expense
  2. In sequential mode: verify no earlier approver (lower `sequence_order`) is still `pending` — if they are, this approver's turn hasn't come yet, return `403 Forbidden`
  3. Never trust the frontend to enforce turn order — someone could call the API directly

---

## ✅ Savepoint 5 — Manager approval flow working

- [ ] Manager logs in → only sees expenses specifically assigned to them in the current step (not all company expenses) ✓
- [ ] Manager approves → `audit_log` updated → next approver in chain now sees it in their queue ✓
- [ ] Manager rejects (with comment) → expense auto-rejects if they're required, or chain logic evaluates correctly ✓
- [ ] Approve/Reject buttons are completely invisible after the manager has acted ✓
- [ ] Employee logs in → the approval log timeline on their expense shows the manager's name + action + timestamp ✓
- [ ] Try to call the approve API endpoint out of turn (wrong sequence order) → returns 403 ✓

---

---

# PHASE 6 — OCR Receipt Auto-Fill (Additional Feature)

> Scan receipt → auto-populate expense form
> ⏱ Est. time: 2–3 hrs

This is a bonus feature from the spec that adds real polish. The idea: employee uploads a photo of a restaurant receipt, the system reads it, and pre-fills the expense form so they don't have to type anything.

---

## Task 6.1 — Receipt upload → OCR → expense form pre-fill
`[FRONTEND + BACKEND]`

> From the spec: *"Employees can just scan a receipt and using OCR algorithm the expense gets auto-generated with all necessary fields like amount, date, description, expense lines, expense type, name of restaurant (for example) where this expense was done."*
>
> From the mockup: *"User should be able to upload a receipt from his computer OR take a photo of the receipt."*

**Two upload methods to support:**
1. **File upload from computer** — standard `<input type="file" accept="image/*,application/pdf">`
2. **Camera capture on mobile** — `<input type="file" accept="image/*" capture="environment">` — this opens the camera directly on phones

**OCR options (both free):**
- **Tesseract.js** — runs entirely in the browser (no backend call needed). Decent for clear printed receipts. Import it into your React component and run it on the uploaded image client-side
- **Google Vision API** — more accurate, especially for handwritten or low-quality receipts. Free tier gives 1,000 requests/month. Send the image to your FastAPI backend, which calls the Vision API and returns parsed text

**What to extract from the OCR text:**
- Total amount (look for largest number near words like "Total", "Grand Total", "Amount Due")
- Date (look for date-like patterns)
- Merchant/restaurant name (usually at the top of the receipt)
- Category hint (if it says "Restaurant" or "Taxi" you can pre-select the category)

**After extraction:**
- Pre-fill the expense form fields with the extracted values
- Do NOT auto-submit. Always show the pre-filled form so the employee can **review and correct** any mistakes before submitting
- Mark OCR-filled fields with a small visual indicator — e.g. a yellow highlight or a small "auto-detected ✓" label next to each pre-filled field — so the user knows which values to double-check

**If OCR fails or confidence is low:**
- Show the empty expense form as normal with a gentle warning: `"Couldn't read the receipt automatically. Please fill in the details manually."`
- Do NOT block the user. Do NOT show a crash screen. OCR failure is expected sometimes and must be handled gracefully

---

> ⚠️ **GOTCHA — Never Auto-Submit from OCR**
> Receipt parsing is imperfect — OCR might misread `8` as `B`, `567.00` as `56700`, or miss a decimal point entirely. If you auto-submit based on OCR output without user review, employees could accidentally submit wrong amounts. Always show the pre-filled form and require a manual Submit click.

---

## ✅ Savepoint 6 — OCR functional

- [ ] Upload a clear photo of a real receipt → amount and date fields are pre-populated in the form ✓
- [ ] Camera capture button opens the camera on a mobile device (test on phone) ✓
- [ ] A blurry or low-quality receipt upload → shows empty form + warning message, does NOT crash ✓
- [ ] OCR-filled fields are visually marked so user knows to verify them ✓

---

---

# PHASE 7 — Final Polish, Error Handling & Deployment

> Empty states · Loading states · 403/404 pages · Deploy to production
> ⏱ Est. time: 2–3 hrs

This phase is what separates a finished project from a broken-feeling one. Even if all the features work, if errors crash pages or data loads with a blank flash, it feels unprofessional.

---

## Task 7.1 — Global error handling
`[FRONTEND + BACKEND]`

**Backend (FastAPI):**
- Every API error response must return consistent JSON: `{ "error": "Human readable message", "code": "MACHINE_READABLE_CODE" }`
- Never let unhandled exceptions return raw Python tracebacks — add a global exception handler in FastAPI that catches unexpected errors and returns a clean 500 response
- Common error codes to define: `EXPENSE_NOT_EDITABLE`, `NOT_YOUR_TURN`, `MANAGER_NOT_FOUND`, `RULE_NOT_ASSIGNED`, `UNAUTHORIZED`

**Frontend (React):**
- Every API call must have a `.catch()` or `try/catch` — no fire-and-forget calls
- Show a **toast notification** (or banner) for API errors — something like a small red popup at the top of the screen. Libraries like `react-hot-toast` or `sonner` work great for this
- If the user goes offline: show a friendly message ("You're offline. Please check your connection.") instead of letting the app hang or crash silently
- All buttons that trigger API calls must have a **loading state** — disable the button and show a spinner while the call is in flight. This prevents double-submits (user clicking Submit twice because nothing happened)

---

## Task 7.2 — Empty states & loading skeletons
`[FRONTEND]`

Your app will often show tables or lists with no data — especially for new users. Empty states make the app feel finished and guide the user on what to do next.

- **Employee with no expenses yet** → show a centered message: `"No expenses yet. Click 'New Expense' to create your first one."` with a button
- **Manager with nothing to review** → show: `"All caught up — no pending approvals."` with a checkmark icon
- **Admin with no users yet** → show: `"No team members yet. Add your first employee above."`

Loading skeletons — while data is being fetched from the API, show **skeleton placeholders** (gray animated boxes in the shape of the content) instead of a blank white flash. This makes the app feel fast and intentional even on slow connections. Libraries like `react-loading-skeleton` make this a 5 minute job.

---

## Task 7.3 — Deploy: Vercel (frontend) + Render (backend)
`[FRONTEND + BACKEND]`

**Vercel (React frontend):**
- Connect your GitHub repo to Vercel. Set the root directory to `/frontend`
- Add all environment variables in Vercel's dashboard (Settings → Environment Variables). Never put secrets in your code
- After deploying, note your production URL (e.g. `https://reimbursement-app.vercel.app`)

**Render.com (FastAPI backend):**
- Create a new Web Service on Render, connect your GitHub repo, set root to `/backend`
- Add environment variables in Render's dashboard
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Add all env vars in Render's dashboard

**Supabase — update allowed URLs:**
- In Supabase → Authentication → URL Configuration → add your Vercel production URL to **Site URL** and **Redirect URLs**. Without this, Supabase Auth redirects will fail in production

**CORS — lock it down:**
- In your FastAPI `main.py`, update `allow_origins` from `["*"]` (which you probably used in dev) to ONLY your Vercel production URL: `["https://reimbursement-app.vercel.app"]`
- Leaving `["*"]` in production means any website on the internet can make API calls to your backend

**Render free tier cold starts:**
- Render's free tier spins down your backend server after 15 minutes of inactivity. The first request after inactivity takes ~30 seconds to respond
- Either: add a lightweight health-check endpoint (`GET /health` returns `{"status": "ok"}`) and ping it every 10 minutes via a free cron service like cron-job.org
- Or: just warn users in your UI that the first request may be slow if the app hasn't been used recently

---

## ✅ Final Savepoint — Launch Checklist

This is your complete go/no-go check before sharing the project:

- [ ] Full happy path works in **production** (not just localhost): Signup → Admin creates employee → Employee submits expense → Manager approves → Employee sees "Approved" status with timestamp ✓
- [ ] Two completely separate companies cannot see each other's users, expenses, or approval rules ✓
- [ ] All 4 approval engine scenarios pass (manager only / sequential / parallel % / required rejects) ✓
- [ ] Currency conversion is correct — test with USD→INR, EUR→INR, and one other currency ✓
- [ ] `conversion_rate` is stored in the DB alongside `amount_in_base` ✓
- [ ] OCR pre-fills form from a real receipt photo ✓
- [ ] No red errors in the browser console on any page ✓
- [ ] CORS is locked to the production Vercel domain only — not `["*"]` ✓
- [ ] Render cold start warning or health-check ping is set up ✓
- [ ] `README.md` explains how to clone the repo, set up `.env`, and run it locally ✓

---

---

# 📌 Key Things From the Excalidraw Mockup (Easy to Miss)

These details came directly from the Excalidraw file and are **not clearly stated in the PDF spec**. These are the things that get missed and then flagged in code review.

1. **Password flow for new users** — Admin creates a user. The system generates a random password and emails it to the new user. The admin never types or sees the password. The new user can change it after first login.

2. **Create-on-the-fly in dropdowns** — Manager and approver dropdowns throughout the app should let admin type a name and if it doesn't exist, create a new user on the spot without leaving the current form. Behaves like a combobox with a `"+ Create new user"` option.

3. **Exact approval log format** — The mockup shows the precise UI format: `Approver | Status | Time`. Real example from mockup: `Sarah | Approved | 12:44 4th Oct, 2025`. Match this format exactly.

4. **Read-only enforcement is DOUBLE** — The mockup's red annotation says: once approved/rejected, record locks AND buttons vanish. Frontend hides the buttons. Backend rejects the API call. Both layers, not one.

5. **Currency display format in manager view** — Always show: `"567 $ (in INR) = 49,896"`. Not just the converted number. The approver needs to see the original currency context.

6. **1 admin per company is a DB constraint, not just a UI check** — The mockup marks this in red. Use a unique partial index: `CREATE UNIQUE INDEX one_admin ON users(company_id) WHERE role = 'admin'`. Frontend validation is not enough — someone can bypass it.

7. **Expense status wording from mockup** — Use these exact labels in your UI: `Draft > Waiting approval > Approved`. Not "submitted", not "in review" — these exact words.

8. **Employee dashboard 3-bucket layout** — The mockup shows three distinct groups: `"5467 rs — To submit"` (Draft) | `"33674 rs — Waiting approval"` (Pending) | `"500 rs — Approved"`. Display total amount per bucket.

9. **Manager dropdown on rule form is dynamic** — The manager field on the approval rule form is pre-populated from the employee's assigned manager, but the admin can override it per rule. It's not just display — it's an editable dropdown.

10. **"Is manager an approver?" exact behavior** — Direct quote from mockup: *"If this field is checked then by default the approve request would go to his/her manager first, before going to other approvers."* The manager is Step 0, not a replacement for the chain — both happen.

11. **"Required" approver exact behavior** — Direct quote from mockup: *"If this field is ticked, then anyhow approval of this approver is required in any approval combination scenarios."* Required overrides the percentage rule completely.

12. **"Approvers Sequence" exact behavior** — Direct quote from mockup: *"If this field is ticked true then the above mentioned sequence of approvers matters, that is first the request goes to John, if he approves/rejects then only request goes to Mitchell and so on. If the required approver rejects the request, then expense request is auto-rejected. If not ticked then send approver request to all approvers at the same time."*
