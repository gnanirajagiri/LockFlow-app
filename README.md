# LockFlow

The AI content-creation workspace built on **continuity**: reusable models, environments and assets are versioned and independently locked before use in content jobs.

> **Status — Environments data foundation.** The authenticated app shell, design system, Models data foundation + interface, and the Environments data foundation are in place. AI generation, payments, provider integrations, Content Studio (Environment Builder), Gallery, Campaigns and the full Library are intentionally out of scope.

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
| `npm test`           | Vitest suites (domain guards + service rules, Models + Environments) |
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
- `20260926000002_environments_domain.sql` — environments, environment_versions, environment_specs, environment_references, environment_asset_shortcuts; RLS; lock-immutability triggers; `create_next_environment_version` / `lock_environment_version` RPCs

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
- `src/domain/environments/guards.test.ts` — locked-version refusal, safe version numbering, spec copying (no source mutation), lifecycle transitions, spec schemas.
- `src/services/environmentsService.test.ts` — the six Environment product rules at the service boundary: (1) locked environment versions cannot be edited; (2) draft-from-locked copies specs + references without changing the source; (3) version numbers increment safely; (4) cross-workspace reads/updates are prevented; (5) archive is soft-archive only; (6) no model identifier or model-binding API exists anywhere in environment entities.

## Environments domain

Environments are **standalone reusable places** — rooms, sets and scenes. They are never model-specific and never classified "global" vs "model-specific"; there is no `model_id` anywhere in the environment schema and no permanent model↔environment relationship. Models and environments meet only later, through content jobs (one model in many environments, one environment with many models).

### Models vs environments

| | Models | Environments |
| --- | ------ | ------------- |
| Reusable | People (actors) | Places (rooms, sets) |
| Protected record | Character Sheet (identity traits only) | Environment Spec (defining anchors) |
| Independent versioning + locks | Yes | Yes — same lifecycle, separate tables |
| Asset shortcuts | `model_asset_shortcuts` → shared Library | `environment_asset_shortcuts` → shared Library |

Both builder systems share one vocabulary — draft / locked / superseded, `max(version_number) + 1`, one open draft at a time, soft archive only — and both reference the **single shared Library**; neither embeds a second library.

### Version & lock-level behaviour

- Version numbers start at 1 and increment by 1 (computed inside `create_next_environment_version`); only one draft version per environment (partial unique index).
- Drafts are editable; locking requires the draft → locked transition and sets `locked_at`. On lock, `environments.active_version_id` points at the newly locked version and prior locked versions become `superseded` — preserved forever, never overwritten.
- `lock_level` (`flexible | balanced | strict`) records how tightly the locked anchors bind future jobs. It is set per version, can be edited while the version is a draft, and is inherited by the next draft when copying.
- Every write path refuses locked versions twice: `refuseEnvironmentLocked` in the service layer, and Postgres triggers (`guard_environment_spec_locked`, `guard_environment_reference_locked`, `guard_locked_environment_version_transition`) at the database. Superseding a locked version is only possible inside the lock RPC (transaction-local flag `lockflow.supersede_allowed`).

### Defining anchors protected by an environment lock

An Environment Spec stores exactly one record per version; locking a version freezes its approved defining anchors:

- **Room type and layout feel** (`room_type`, `layout_feel`)
- **Hero camera / viewing angle** (`hero_angle`)
- **Lighting style** (`lighting_style`)
- **Key furniture anchors** (`furniture_anchors` JSONB)
- **Signature props** (`signature_props` JSONB)
- **Palette / material direction** (`palette_materials` JSONB)
- **Product zone / presentation area** (`product_zone` JSONB, nullable — not every environment presents products)

Plus continuity notes and lock rules for context. Any change after locking creates a new draft version via the copy-to-draft flow (spec + reference metadata copied, source never mutated).

### Environments routes

| Route | Purpose |
| ----- | ------- |
| `/environments` | Lightweight index: loading/error/empty states (empty copy: "Create your first environment"), environment cards (name, active version, status, lock state, lock level, last updated) and a **New environment** placeholder modal. The guided Environment Builder is a later milestone. |

### Development seed data

`src/mock/environmentsSeed.ts` provides one fictional environment, **Warm Bedroom Studio** (`ready`): locked v1 ("Original approved setup", lock level `balanced`) and draft v2 ("Soft evening lighting variation"), full specs for both (bedroom creator setup; warm lived-in creator corner; three-quarter hero angle facing desk and vanity; soft morning window light with warm practical lamp; bed / light oak desk / vanity mirror / upholstered chair anchors; plant / ceramic mug / notebook / skincare tray signature props; cream–beige–oak–terracotta palette; vanity/desk product zone) and three local placeholder references (wide, hero_angle, product_zone). No real places, no external URLs. A second fixture (**Glass Loft Kitchen**, `strict`) lives in another workspace for isolation tests. In demo mode the repository factory (`src/data/environmentsFactory.ts`) serves this seed under the same domain guards as production.

### Reusable assets and the shared Library

`environment_asset_shortcuts` rows are quick-access **pointers only** — `library_asset_id` is a nullable placeholder with **no foreign key yet** (the unified Library table does not exist). The future Library migration will add `references public.library_assets (id)` to both `environment_asset_shortcuts` and `model_asset_shortcuts`; until then the column must stay null in normal flows. No second environment-specific Library exists, and generated outputs belong in Gallery, not Environments.

## Roadmap beyond this milestone

1. Workspace provisioning on first sign-in (create workspace + owner membership).
2. ~~Model Builder and Environment Builder data models with version + lock tables.~~ Done — Models data foundation + interface, Environments data foundation.
3. Environment Builder UI (Content Studio) on the new Environments data layer: guided composition, lock confirmation, version comparison.
4. Library asset types backed by Supabase Storage (private bucket already provisioned) + the FK migration for asset shortcuts.
5. Content job pipeline feeding the Gallery.
