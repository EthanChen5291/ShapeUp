# Session Handoff — ShapeUp

> **How to use this file:**  
> When starting a new Claude session after a context limit, copy this template to `handoff/HANDOFF_<DATE>.md`, fill in the blanks under "Current Session State", and paste it at the top of the new conversation.

---

## Project Snapshot

**Repo:** `/Users/brrodrig/Documents/FUQ_WINDOWS/bat_cave/ShapeUp`  
**Stack:** Next.js 16 (App Router, React 19) · Clerk (auth) · Convex (backend/DB) · Stripe (payments) · Gemini (LLM hair edits) · Python FaceLift server (3D head scan via ngrok)  
**Branch:** `main`

### Key Files
| Area | Path |
|------|------|
| DB schema | `convex/schema.ts` |
| Users (credits) | `convex/users.ts` |
| Sessions | `convex/sessions.ts` |
| Stripe webhook | `convex/http.ts` |
| Clerk JWT config | `convex/auth.config.ts` |
| Main UI | `src/app/page.tsx` |
| Auth providers | `src/components/ConvexClerkProvider.tsx` |
| Layout | `src/app/layout.tsx` |
| Facelift proxy (deducts credit) | `src/app/api/facelift/route.ts` |
| Stripe checkout | `src/app/api/stripe/checkout/route.ts` |
| Save scan | `src/app/api/save-scan/route.ts` |
| Admin sessions | `src/app/api/admin-sessions/route.ts` |

### Credits System
- 25 credits for $5 (Stripe one-time payment)
- 1 credit per facelift (3D scan) run — deducted in `src/app/api/facelift/route.ts`
- Stripe webhook → `internal.users.addCredits({ clerkId, amount: 25 })`
- Pending user merge: if bought before first login, `tokenIdentifier: "pending|{clerkId}"` → merged on next login

### Convex Deployment
- Convex site URL: `https://flippant-lark-931.convex.site`
- Clerk domain: `full-sparrow-61.clerk.accounts.dev`
- Clerk JWT template: `"convex"` (aud: `"convex"`)

### Always do first
Read `convex/_generated/ai/guidelines.md` before touching any Convex code (CLAUDE.md requirement).

---

## Current Session State

> Fill this section in before starting the new session.

**Date:** YYYY-MM-DD  
**Picking up from:** [brief description of previous session]

### What was completed this session
-

### What is in progress / partially done
-

### What still needs to be done
-

### Files modified (not yet committed)
```
# paste output of: git status --short
```

### Uncommitted diff summary
```
# paste output of: git diff --stat HEAD
```

### Any blockers or open questions
-

### Commands that were running / need to be restarted
- [ ] `npx convex dev` (Convex dev server)
- [ ] `npm run dev` (Next.js dev server)
- [ ] Python FaceLift server (check `server/` dir)

---

## How to Resume

1. Read this file top-to-bottom.
2. Run `git status` and `git log --oneline -5` to orient yourself.
3. Read `convex/_generated/ai/guidelines.md` if touching Convex.
4. Pick up at the first unchecked item in "What still needs to be done."
