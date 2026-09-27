# LockFlow

The AI content-creation workspace built on **continuity**: reusable models, environments and assets are versioned and independently locked before use in content jobs.

> **Status — Models interface milestone.** The authenticated app shell, design system, Models data foundation and the functional Models interface are in place. AI generation, payments, provider integrations, Content Studio, Gallery, Campaigns and the full Library are intentionally out of scope.

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
| `npm test`           | Vitest suites (domain guards + service rules) |
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

## Models domain

Models are independently reusable actors. Their protected identity is a **versioned Character Sheet** containing identity traits only — face features, hair, complexion, body proportions and distinctive details. Clothing, accessories, props, products and environments are **not** identity traits; they attach from the one unified shared Library at job time.

### Version & lock rules

| Rule | Enforcement |
| ---- | ----------- |
| Draft versions are editable | UI + service guard + DB triggers allow it |
| Locking makes a version read-only forever | `refuseIfLocked` guard in `src/domain/models/guards.ts` **and** `BEFORE UPDATE` triggers in Postgres |
| Any change after locking creates a new draft | `create_next_model_version` RPC copies the selected version's sheet |
| Version numbers start at 1, increment by 1 | Computed in the RPC inside the transaction |
| One draft version per model at a time | Partial unique index `model_versions_one_draft_per_model` |
| Historic versions are preserved permanently | No delete policies on the app path; models soft-archive only |
| Exactly one Character Sheet per version | `character_sheets.model_version_id` is both PK and FK |
| Model asset shortcuts are pointers, not assets | `model_asset_shortcuts` references the future shared Library by id — never duplicates it |

### Migrations

Schema changes live only in versioned files under `supabase/migrations/`:

- `20260926000000_initial_schema.sql` — profiles, workspaces, memberships, RLS baseline
- `20260926000001_models_domain.sql` — models, model_versions, character_sheets, model_references, model_asset_shortcuts; RLS; lock-immutability triggers; `create_next_model_version` / `lock_model_version` RPCs; adds `admin`/`member` to `workspace_role`

Apply with `supabase migration up` (local) or let the platform apply on push (linked projects).

### Development seed data

`src/mock/modelsSeed.ts` provides one fictional model, **Aisha** (`ready`), with locked v1 ("Original approved identity"), draft v2 ("Hair and lighting refinement"), full Character Sheets for both and three local placeholder references (portrait, full-body, profile). No real people, no external URLs. In demo mode the repository layer (`src/data/index.ts`) serves this seed; the same domain guards run over it, so lock/immutability behaviour matches production.

### Models routes

The functional Models interface lives under `/models`:

| Route | Purpose |
| ----- | ------- |
| `/models` | Index: search by name, status filter (All/Draft/Ready/Archived), grid/list toggle, soft-archive with confirmation, and the **Create a model** modal (creates the model + its first draft version, then redirects to the profile). |
| `/models/:modelId` | Profile Overview: active version + lock summary, identity-protection summary, stat placeholders, "Generated work appears in Gallery." |
| `/models/:modelId/character-sheet` | Version selector + draft editing form or locked read-only view, with portrait/full-body/profile reference placeholders. |
| `/models/:modelId/versions` | Version timeline, status filter, inspect dialog, lock confirmation, field-by-field comparison, create-draft flow. |
| `/models/:modelId/looks` | Placeholder — Looks are reusable wardrobe/accessory combinations; "Looks will connect to the shared Library next." |
| `/models/:modelId/closet-props` | Placeholder — shortcuts into the one shared Library; "Manage shared assets in Library." |
| `/models/:modelId/usage-history` | Placeholder — generated outputs remain in Gallery; "Open Gallery" is a future/disabled action. |

Routes always use the real model id from data — the seeded Aisha id is never hard-coded into route logic.

### Locked vs draft behaviour

- A **draft** version's Character Sheet is editable through the schema-validated form (`validateUpdateCharacterSheet`), saved via `ModelsService.updateCharacterSheet`, which re-checks the lock guard before every write.
- A **locked** version is permanently read-only. There is no UI or service path that updates a locked version: the domain guard `refuseIfLocked`, the service check, the mock repository and the Postgres trigger (`guard_character_sheet_locked`) all refuse independently.
- Locking requires the confirmation dialog ("Locking protects this identity version. It cannot be edited afterward. Future changes create a new version."), and only draft → locked is legal. On lock the model's `active_version_id` points at the newly locked version (the existing RPC rule) and prior locked versions become `superseded` but are preserved forever.

### Creating a new draft from a locked version

1. Open the model's **Versions** tab (or the locked Character Sheet) and choose **Create new draft version** / **Create new draft from this version**.
2. Pick the source version and enter a **required change summary**.
3. The service calls the safe version-increment path (`create_next_model_version` RPC on Supabase; the equivalent guarded mock in demo mode): it computes `max(version_number) + 1`, refuses when a draft already exists, copies the source version's Character Sheet (and its reference metadata) into the new draft, and never mutates the source.
4. You land on the new draft's Character Sheet, ready to edit.

### Identity traits vs replaceable assets

A Character Sheet stores **identity traits only**: identity summary, face & features, hair identity, complexion, body proportions, distinctive details, reference notes and lock rules. Clothing, accessories, props, products and environments are **replaceable layers**, not identity traits — they attach from the one shared Library at job time and can change without creating a new model version. Models area panels (Looks, Closet & Props, Usage history) are summaries/shortcuts only: no separate model library exists and generated work appears in Gallery.

### Tests

`npm test` runs Vitest:

- `src/domain/models/guards.test.ts` — locked-edit refusal, version numbering, Character Sheet copying, workspace isolation, validation schemas.
- `src/services/modelsService.test.ts` — the five product rules at the service boundary: (1) locked sheet fields cannot be saved; (2) draft-from-locked copies data without mutating the source; (3) lock confirmation is required and only drafts lock; (4) archive is soft-archive only with no delete path; (5) cross-workspace models cannot be read or updated.
- `src/features/models/modelDiff.test.ts` — field-by-field comparison behaviour.

## Roadmap beyond this milestone

1. Workspace provisioning on first sign-in (create workspace + owner membership).
2. Model Builder and Environment Builder data models with version + lock tables.
3. Library asset types backed by Supabase Storage (private bucket already provisioned).
4. Content job pipeline feeding the Gallery.
