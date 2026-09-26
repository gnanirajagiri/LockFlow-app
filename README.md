# LockFlow

The AI content-creation workspace built on **continuity**: reusable models, environments and assets are versioned and independently locked before use in content jobs.

> **Status — foundation milestone.** This repository currently ships the authenticated app shell, design system and database baseline. AI generation, payments, provider integrations and feature logic are intentionally out of scope.

---

## Tech stack

| Concern            | Choice                                                |
| ------------------ | ----------------------------------------------------- |
| Framework          | React 18 + TypeScript (strict), Vite 5                |
| Routing            | React Router 7                                        |
| Auth / DB / Files  | Supabase (Auth, PostgreSQL + RLS, private storage)    |
| Styling            | Hand-rolled design-token CSS (no CSS framework)       |
| Schema changes     | Tracked SQL migrations in `supabase/migrations/`      |

No other runtime dependencies — icons, dialogs and toasts are first-party.

## Local setup

```bash
# 1. Install
npm install

# 2. Configure Supabase (skip to run in demo mode)
cp .env.example .env.local
#    Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from
#    Supabase → Project Settings → API.

# 3. Run
npm run dev          # http://localhost:5173
```

### Demo mode

Without Supabase env vars the app runs in **demo mode**: authentication is mocked with an in-memory session and pages render against labelled mock data (`src/mock/`), so the shell is explorable without a backend. Demo mode is a development convenience only — never build data features on it.

### Scripts

| Command              | Purpose                              |
| -------------------- | ------------------------------------ |
| `npm run dev`        | Vite dev server                      |
| `npm run build`      | Typecheck + production build         |
| `npm run typecheck`  | `tsc --noEmit`                       |
| `npm run preview`    | Serve the production build           |

## Environment variables

| Variable                 | Required | Purpose                                        |
| ------------------------ | -------- | ---------------------------------------------- |
| `VITE_SUPABASE_URL`      | Yes*     | Supabase project URL                           |
| `VITE_SUPABASE_ANON_KEY` | Yes*     | Public anon key (RLS-protected; safe in the browser) |

\* Required for real authentication. When both are absent the app falls back to demo mode. Only `VITE_`-prefixed vars reach the browser — **never** put service-role keys here.

## Database migrations

Schema lives in versioned SQL files under `supabase/migrations/` — never change the schema by hand.

```bash
# Apply locally (Supabase CLI)
supabase migration up

# Or create a new migration
supabase migration new < descriptive_name >
```

**`20260926000000_initial_schema.sql`** creates:

- `workspaces` — top-level tenancy boundary (name, slug, plan, creator)
- `profiles` — one row per auth user (display name, avatar path, email)
- `workspace_members` — membership with `owner | editor | viewer` roles
- Row-level security on all three tables (see below)
- A `security definer` trigger that bootstraps a profile for every new auth user
- A private `workspace-assets` storage bucket (policies arrive with uploads)

### Security model

- RLS is enabled on every table; the anon key can only read what policies allow.
- `profiles`: a user can select/update **only their own** row.
- `workspaces`: readable by members, creatable by the creator, updatable by owners only.
- `workspace_members`: roster visible to members; first owner row seeded by the workspace creator; role changes restricted to owners; members can remove themselves.
- The storage bucket is **private** — objects are reachable only through future storage policies.

## App structure

```
├── index.html                  # Vite entry document
├── public/                     # Static assets (favicon)
├── supabase/migrations/        # Versioned SQL schema (source of truth)
└── src/
    ├── main.tsx                # React entry, style cascade order
    ├── App.tsx                 # Router tree + providers
    ├── styles/
    │   ├── tokens.css          # Design tokens (colours, spacing, radii, shadows, type)
    │   ├── tokens.ts           # Typed mirror of tokens.css
    │   ├── base.css            # Reset, document defaults, focus rings
    │   ├── components.css      # UI component styles
    │   ├── layout.css          # Shell styles (sidebar, topbar, canvas)
    │   └── pages.css           # Page-scoped styles
    ├── lib/                    # env, Supabase client, storage helpers
    ├── auth/                   # AuthProvider, ProtectedRoute, LoginPage
    ├── navigation/nav.tsx      # Single source of truth for navigation
    ├── components/
    │   ├── icons.tsx           # Inline SVG icon set
    │   ├── ui/                 # Reusable component library (see below)
    │   └── layout/             # AppShell, Sidebar, Topbar, MobileNavDrawer, PageHeader
    ├── pages/                  # One polished page per route
    └── mock/                   # Clearly-labelled mock data (until DB access lands)
```

### Component library

`Button`, `Input`, `Card`, `Badge`, `Tabs`, `Modal`, `Drawer`, `EmptyState`, `Skeleton` and `Toast` live in `src/components/ui/` with a barrel export (`index.ts`). All are token-styled, keyboard-accessible and dependency-free. Examples: `Modal`/`Drawer` manage portals, Escape and focus restore; `Tabs` implements the WAI-ARIA roving tabindex; toasts pause on hover.

### Shell behaviour

- Desktop sidebar (dark navy) collapses to an icon rail; the choice persists in `localStorage`.
- Below 960px the sidebar is replaced by a hamburger-triggered drawer.
- Skip-link, `aria-current` nav state, strong focus rings and `prefers-reduced-motion` support are built in.

## Product terminology (contractual)

| Term          | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| **Gallery**   | Generated content jobs and outputs only — queued, rendering, drafts, review-ready work and exports. |
| **Library**   | One unified reusable-asset system: products, props, wardrobe, saved Looks, scenes and brand assets. Never "Global Library", "My Library" or "Library of outputs". |
| **Models**    | The Model Builder system — versioned and locked **independently** of environments. |
| **Content Studio** | The Environment Builder system — a separate builder with its own locks and versions. |

## Roadmap beyond this milestone

1. Workspace provisioning on first sign-in (create workspace + owner membership).
2. Model Builder and Environment Builder data models with version + lock tables.
3. Library asset types backed by Supabase Storage (private bucket already provisioned).
4. Content job pipeline feeding the Gallery.
