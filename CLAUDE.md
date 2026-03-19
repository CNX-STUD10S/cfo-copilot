# CLAUDE.md — CFO Copilot Codebase Guide

This file provides guidance for AI assistants (Claude Code and others) working on the CFO Copilot repository.

---

## Project Overview

**CFO Copilot** is an AI-powered financial operating system for Indian startups — a "CFO-as-a-Service" that replaces the need for a ₹8–15 lakh/year fractional CFO. It delivers real-time financial intelligence, India-specific compliance tracking, fundraising support, and AI-powered advisory powered by Anthropic Claude.

- **Live URL:** https://compyte.in
- **GitHub Pages mirror:** https://cnx-stud10s.github.io/cfo-copilot/
- **Target users:** Indian SaaS founders at Seed/Series A stage

---

## Architecture

### Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Pure HTML5 + Vanilla JS (ES6+) | No framework — intentional for speed |
| Fonts | Syne (headings), JetBrains Mono (numbers) | Loaded from Google Fonts |
| Database | Supabase (PostgreSQL + Auth + RLS) | Row-level security for multi-tenancy |
| AI backend | Anthropic Claude API (Haiku model) | Via Supabase Deno Edge Function |
| File parsing | SheetJS (`xlsx@0.18.5`) | Bank statements, Tally exports |
| Payments | Razorpay | India-specific gateway |
| Hosting | GitHub Pages → Vercel (planned) | Zero infrastructure cost |

### No Build Step

There is **no build/compilation step**. A `git push` to `main` auto-deploys to GitHub Pages. Do not introduce build tools, bundlers, or package managers unless explicitly requested.

---

## File Structure

```
cfo-copilot/
├── app.html                      # Main SPA — entire application (~3,900 lines)
├── index.html                    # Marketing landing page
├── blog.html                     # Blog index
├── privacy.html                  # Privacy policy
├── terms.html                    # Terms of service
├── vs-tally.html                 # Comparison page (vs Tally)
├── vs-zoho-books.html            # Comparison page (vs Zoho Books)
├── blog/
│   ├── why-38658-indian-companies-were-struck-off.html
│   ├── runway-burn-rate-cash-flow-indian-startups.html
│   └── vc-readiness-score-series-a-india.html
├── supabase/
│   └── functions/
│       └── ai-chat/
│           └── index.ts          # Deno Edge Function: AI chat + rate limiting
├── CNAME                         # Custom domain: compyte.in
├── robots.txt
├── sitemap.xml
├── README.md
└── SECURITY.md
```

---

## Core Files

### `app.html` — The Main Application

The entire SPA lives in this single file (~3,900 lines). It contains:

- Inline `<style>` block (CSS)
- All HTML markup (page sections, modals, forms)
- Inline `<script>` block (all JavaScript)

**Global state object:**
```javascript
const S = {
  company: {},       // Company profile from Supabase
  snapshots: [],     // Monthly financial snapshots
  user: {},          // Supabase auth user
  session: {}        // JWT session
};
```

**Key function groups:**

| Function | Purpose |
|----------|---------|
| `init()` | Bootstrap app, init Supabase client |
| `loadApp(user)` | Load company data after auth |
| `saveData()` | Persist financial snapshots to Supabase |
| `sendMsg()` | Send message to AI CFO (calls Edge Function) |
| `refreshDashboard()` | Recalculate all financial metrics |
| `buildCompliance()` | Generate GST/TDS/ROC compliance calendar |
| `calcScenario()` | Run scenario analysis |
| `buildForecast()` | Revenue forecasting with chart |
| `buildPL()` / `buildBalanceSheet()` / `buildCashFlow()` | Financial statements |
| `addEmployee()` / `renderPayroll()` | Payroll with PF/ESI/TDS |
| `addShareholder()` / `renderCapTable()` / `calcDilution()` | Cap table |
| `addInvoice()` / `renderInvoices()` | Invoice tracking |
| `processFile()` / `parseCSV()` / `parseExcelRows()` | File imports |
| `logAudit()` | Append to audit trail |

**Navigation pattern:**
```javascript
showPage('dashboard')      // Switch main page
showSub('page', 'subpage') // Switch tab within a page
```

**Validation helpers:**
```javascript
V.text(str, maxLen)   // Trim and truncate strings (XSS safe)
V.money(val)          // Parse financial value (returns 0+ float)
esc(str)              // HTML-escape for XSS prevention
sanitiseHTML(str)     // Strip dangerous HTML tags
assertOwnership(id)   // Verify resource belongs to current user (IDOR prevention)
```

**Demo mode:**
The `demoData()` function returns 6 months of sample financial snapshots. Used in "Try Demo — No Signup" mode. Do not remove this.

### `supabase/functions/ai-chat/index.ts` — Edge Function

Deno runtime. Responsibilities:
1. Verify user JWT from `Authorization: Bearer <token>` header
2. Check monthly usage against plan limits
3. Call Anthropic API (`claude-haiku-4-5-20251001` model)
4. Increment usage counter atomically
5. Return `{ reply, used, limit }` or error

**Plan limits:**
- `free`: 5 messages/month
- `starter`: 100 messages/month
- `pro` / `enterprise`: unlimited (999999)

**Environment variables required (server-side only):**
```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## Database Schema (Supabase PostgreSQL)

```sql
-- Company profiles
companies (
  id UUID PK,
  user_id UUID → auth.users,
  name TEXT,
  stage TEXT,      -- Bootstrapped | Pre-Seed | Seed | Series A | Series B+
  industry TEXT,
  founded TEXT,    -- YYYY-MM
  gstin TEXT,
  created_at TIMESTAMPTZ
)

-- Monthly financial snapshots
financial_snapshots (
  id UUID PK,
  company_id UUID → companies,
  month TEXT,      -- YYYY-MM
  mrr NUMERIC,     -- ₹ Lakhs
  burn NUMERIC,    -- ₹ Lakhs
  cash NUMERIC,    -- ₹ Lakhs
  salaries NUMERIC,
  cloud NUMERIC,
  marketing NUMERIC,
  headcount INTEGER,
  customers INTEGER,
  nrr NUMERIC,     -- %
  created_at TIMESTAMPTZ
)

-- Subscriptions & AI usage
subscriptions (
  id UUID PK,
  user_id UUID → auth.users,
  plan TEXT DEFAULT 'free',
  ai_messages_used INTEGER DEFAULT 0,
  reset_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
```

Row-Level Security (RLS) is enabled on all tables. Policies ensure users access only their own data.

---

## Key Conventions

### JavaScript Style

- **No TypeScript** in `app.html` (pure vanilla JS)
- **TypeScript** only in `supabase/functions/` (Deno runtime)
- Use `async/await` for all async operations
- Prefer `const`; use `let` only when reassignment is needed
- All monetary values stored in **₹ Lakhs** (not rupees or crores)

### India-Specific Financial Rules

When writing or modifying financial calculation code, adhere to these rules:

| Calculation | Rule |
|-------------|------|
| PF (Provident Fund) | 12% of basic salary, capped at ₹15,000/month basic |
| ESI | 3.25% employer contribution if salary ≤ ₹21,000/month |
| TDS | 10% if monthly salary > ₹50,000 |
| GST filing | GSTR-3B due by 20th of following month |
| TDS return | Quarterly (Q1: Jul 31, Q2: Oct 31, Q3: Jan 31, Q4: May 31) |
| ROC Annual Return | Due 60 days after AGM (typically by Nov 29) |

### Security Rules — Always Follow

1. **Never expose the Anthropic API key to the frontend.** All Claude API calls must go through the Edge Function.
2. **Always call `assertOwnership(id)` before mutating any resource** to prevent IDOR vulnerabilities.
3. **Always use `esc()` or `sanitiseHTML()`** when rendering user-supplied content as HTML.
4. **Always use `V.text()` and `V.money()`** to sanitize and validate inputs.
5. **Never hardcode secrets** in `app.html` or any frontend file. The Supabase `anon` key (publishable) is safe; the service role key is not.
6. **JWT must be verified** on every Edge Function request before processing.

### UI/UX Conventions

- Financial figures are displayed in **₹ Lakhs** (e.g., `₹42.5L`)
- Runway displayed in months (e.g., `14.2 months`)
- Color coding: green for healthy metrics, amber for warnings, red for critical
- Modals use `.modal-overlay` + `.modal` classes; toggled with `.open`
- Tab navigation uses `.stab` buttons with `onclick="showSub('page', 'subpage')"`

---

## Development Workflow

### Local Development

**Option 1 — Simple HTTP server (recommended):**
```bash
python3 -m http.server 8080
# Open http://localhost:8080/app.html
```

**Option 2 — VS Code Live Server extension:**
Right-click `app.html` → "Open with Live Server"

**Option 3 — Node.js:**
```bash
npx serve .
```

### Supabase Configuration

1. Create a project at https://supabase.com
2. Replace in `app.html`:
   ```javascript
   const SB_URL = 'https://YOUR_PROJECT.supabase.co';
   const SB_KEY = 'your_anon_key_here';
   ```
3. Enable Email Magic Links in Supabase Auth settings
4. Run the schema SQL in the Supabase SQL editor
5. Enable RLS and create policies per `SECURITY.md`

### Edge Function Deployment

```bash
# Install Supabase CLI
npm install -g supabase

# Deploy the AI chat function
supabase functions deploy ai-chat

# Set secrets (server-side only)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Git & Deployment

```bash
# All changes auto-deploy to GitHub Pages on push to main
git add -p          # Stage selectively
git commit -m "feat: ..."
git push origin main
```

Supabase Edge Functions require a separate manual deploy step (see above).

---

## Features Reference

| Feature | Location in app.html | Key Functions |
|---------|----------------------|---------------|
| Auth (Magic Link) | `#page-login` | `init()`, `loadApp()` |
| Dashboard | `#page-dash` | `refreshDashboard()` |
| AI CFO Chat | `#chat-drawer` | `sendMsg()` |
| Financial Statements | `#sub-reports-*` | `buildPL()`, `buildBalanceSheet()`, `buildCashFlow()` |
| Compliance Calendar | `#sub-compliance-*` | `buildCompliance()` |
| Fundraising Intelligence | `#page-fundraising` | `buildVCScore()`, `buildBoardDeck()` |
| Unit Economics | `#sub-unit-economics` | `calcUnitEconomics()` |
| Revenue Forecasting | `#sub-forecasting` | `buildForecast()` |
| Cap Table | `#sub-captable` | `addShareholder()`, `calcDilution()` |
| Payroll | `#sub-payroll` | `addEmployee()`, `renderPayroll()` |
| Scenario Modeling | `#sub-scenarios` | `calcScenario()` |
| Invoices | `#sub-invoices` | `addInvoice()`, `renderInvoices()` |
| Data Imports | `#sub-integrations` | `processFile()`, `parseCSV()` |
| Benchmarks | `#sub-benchmarks` | `buildBenchmarks()` |
| Audit Trail | `#sub-audit` | `logAudit()`, `renderAuditLog()` |
| Team Management | `#sub-team` | `inviteTeam()` |

---

## Testing

There are no automated tests. Testing is done via:

1. **Demo mode** — Click "Try Demo — No Signup" to load `demoData()` (6 months sample data)
2. **Manual walkthrough** — Use the onboarding tour
3. **Local server** — Test changes at `http://localhost:8080/app.html`

When making changes, verify:
- Demo mode still loads and all features work without a Supabase connection
- Financial calculations produce correct results for known inputs
- No `console.error` logs in browser devtools
- Mobile layout (375px viewport) is not broken

---

## Roadmap Context

**v1.0 (Shipped)** — Current state of the repo
**v1.5 (Q2 2026)** — RBI Account Aggregator, Razorpay auto-sync, WhatsApp alerts, CA filing automation, Mobile PWA
**v2.0 (Q3 2026)** — OAuth integrations (Tally/Zoho/HubSpot), ML anomaly detection, MCA/ROC automation, Excel export

When implementing new features, prefer extending existing page sections over creating new HTML pages. Follow the existing tab/subpage navigation pattern.

---

## Common Pitfalls

- **Don't introduce npm/webpack/bundlers** — this is an intentionally zero-build project
- **Don't import React/Vue/Angular** — vanilla JS only in `app.html`
- **Don't commit secrets** — `.gitignore` blocks `.env` files; keep API keys in Supabase secrets
- **Don't store sensitive financial data in localStorage** — use Supabase with RLS
- **Do use `₹ Lakhs` for all monetary units** — not rupees (₹), not crores
- **Do call `logAudit()`** after any financial data mutation
- **Do test demo mode** after any change to the dashboard or financial calculations
