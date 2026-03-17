# CFO Copilot — Security Hardening Guide

## 1. Supabase Configuration (CRITICAL — do these now)

### Auth Settings (Supabase Dashboard → Auth → Settings)
```
✅ Enable email confirmations: ON
✅ Magic link expiry: 3600 seconds (1 hour)
✅ JWT expiry: 3600 seconds (1 hour)
✅ Refresh token rotation: ENABLED
✅ Refresh token reuse interval: 10 seconds
✅ OTP expiry: 300 seconds (5 minutes)
✅ Rate limiting: ENABLED (default)
```

### Row Level Security — verify all tables have RLS enabled
```sql
-- Run in Supabase SQL Editor to verify
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
-- Every table should show rowsecurity = true
```

### Restrict public schema access
```sql
-- Revoke direct public access to all tables
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Re-grant only through RLS policies
GRANT SELECT, INSERT, UPDATE, DELETE ON companies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON financial_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_members TO authenticated;
```

### Rate limiting at Supabase level
Go to: Dashboard → Auth → Rate Limits
```
✅ Email sends: 3 per hour (default: 3)
✅ Token refreshes: 150 per hour
✅ Sign ups: 30 per hour
```

---

## 2. Edge Function Security

### Deploy the secure version
```bash
# Copy ai-chat-edge-function.ts to supabase/functions/ai-chat/index.ts
cp ai-chat-edge-function.ts supabase/functions/ai-chat/index.ts
supabase functions deploy ai-chat
```

### Set secrets (NEVER put these in code)
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
# The service role key is in: Dashboard → Settings → API → service_role
```

### Verify secrets are set
```bash
supabase secrets list
# Should show ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY
```

---

## 3. What's Safe to Expose (frontend)

The `SB_KEY` in `app.html` is the **publishable anon key** — this is intentionally public.
It is safe because:
- RLS policies enforce per-user data isolation
- The anon key cannot bypass RLS
- No sensitive operations use the anon key directly

What is NEVER safe to expose:
```
❌ ANTHROPIC_API_KEY       — only in Edge Function secrets
❌ SUPABASE_SERVICE_ROLE_KEY — only in Edge Function secrets
❌ Razorpay secret key      — only server-side
❌ Any private key / JWT secret
```

---

## 4. GitHub Repository Settings

### Branch protection (Settings → Branches)
```
✅ Require pull request reviews: ON
✅ Require status checks: ON
✅ Restrict pushes to main: ON
✅ No force pushes: ON
```

### Secrets scanning
GitHub automatically scans for leaked API keys.
If you accidentally commit a key:
1. Immediately rotate it in the provider dashboard
2. Remove it from git history: `git filter-branch` or `git-filter-repo`
3. Force push

### GitHub Actions secret (if using CI/CD)
```
Settings → Secrets → New repository secret
Name: SUPABASE_ACCESS_TOKEN
Value: your-supabase-access-token
```

---

## 5. HTTPS Enforcement

GitHub Pages automatically serves HTTPS. Verify:
- URL starts with `https://`
- No mixed content warnings in browser console
- `Enforce HTTPS` is ON in repo Settings → Pages

For custom domain (cfocopilot.in):
```
1. Add CNAME record pointing to cnx-stud10s.github.io
2. Enable "Enforce HTTPS" in GitHub Pages settings
3. Add HSTS header (GitHub Pages handles this automatically)
```

---

## 6. Content Security Policy (Advanced)

Add to GitHub Pages via `_headers` file (if using Netlify/Vercel):
```
/app.html
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src https://*.supabase.co https://api.anthropic.com; frame-src 'none'; object-src 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## 7. Monitoring & Alerting

### Supabase Dashboard monitoring
- Auth → Logs: watch for repeated failed login attempts
- Database → Logs: watch for unusual query patterns
- Edge Functions → Logs: watch for 401/403 errors

### Set up alerts for
```
⚠️  > 10 failed auth attempts from same IP in 1 hour
⚠️  > 100 API calls per minute from single user
⚠️  Any database error on RLS-protected tables
⚠️  Edge Function error rate > 1%
```

---

## 8. Security Checklist — Before Going Live

```
AUTH
✅ Magic link expiry set to 1 hour
✅ Email confirmation required
✅ Rate limiting on OTP sends (3/hour)
✅ Session cleared on sign out
✅ JWT verified server-side in Edge Function
✅ access_token stripped from URL immediately

DATABASE
✅ RLS enabled on all tables
✅ Every query scoped to authenticated user
✅ company_id double-locked on mutations
✅ No direct public internet access to DB
✅ Service role key only in Edge Function

INPUT VALIDATION
✅ All text inputs: sanitised + length-capped
✅ Numbers: type-checked + range-validated
✅ Email: RFC regex validated
✅ GSTIN: format validated
✅ File uploads: type + size validated
✅ All user data escaped before innerHTML

XSS PREVENTION
✅ esc() function used for all user data in innerHTML
✅ sanitiseHTML() used for AI responses
✅ No eval() or Function() calls
✅ No document.write()

IDOR PREVENTION
✅ assertOwnership() before all mutations
✅ assertInvoiceOwnership() before invoice ops
✅ Double-lock: eq(id) AND eq(company_id) on all DB mutations
✅ Team member verified in local state before DB delete

RATE LIMITING
✅ Magic link: 3/minute per email
✅ Account creation: 5/hour
✅ Invoice creation: 50/hour
✅ Team invites: 10/hour
✅ AI chat: enforced server-side by plan limits

SECRETS
✅ Anthropic API key: Edge Function secret only
✅ Service role key: Edge Function secret only
✅ Anon key: safe to expose (RLS protects data)
✅ .gitignore: prevents secret file commits

DEPLOYMENT
✅ HTTPS enforced (GitHub Pages default)
✅ Security meta headers added
✅ No sensitive data in console.log
✅ Error messages don't leak stack traces to UI
```
