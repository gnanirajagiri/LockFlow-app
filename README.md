# LockFlow

The AI content-creation workspace built on **continuity**: reusable models, environments and assets are versioned and independently locked before use in content jobs.

> **Status — Short-form video generation (fake provider).** The authenticated app shell, design system, the Models data foundation + interface, the Environments data foundation + Builder interface, the unified Library data foundation + functional Library UI, the Content Studio data foundation + functional planning interface, the Gallery data foundation + functional review/collection UI, and **secure private reference uploads** (Models / Environments / Library) are in place. Real AI generation, provider integrations, payments, Campaigns/Templates UI and image analysis are intentionally out of scope.

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
| `npm test`           | Vitest suites (domain guards + service rules + media/upload contracts) |
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
- `20260928000002_gallery_domain.sql` — gallery_outputs, gallery_output_reviews, gallery_output_tags, gallery_output_tag_links, gallery_collections, gallery_collection_items, gallery_output_events; RLS + consistency/append-only/state-machine triggers
- `20260928120000_reference_uploads.sql` — private `lockflow-references` / `lockflow-previews` buckets; extends the three reference tables with workspace scoping, file metadata, rights acknowledgement and `upload_status`; `upload_audit_events` (append-only by RLS); path-derived storage policies; security-definer RPCs `begin_reference_upload` / `complete_reference_upload` / `fail_reference_upload` / `soft_delete_reference` / `log_signed_url_access`; adds the missing DELETE policy on `model_references`

Apply with `supabase migration up` (local), let the platform apply on push (linked projects), or run `scripts/apply_migrations.sh "<session-pooler-connection-string>"` — it records history in `supabase_migrations.schema_migrations` (the platform's own tracking table) and is idempotent.

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
| `/models/:modelId/looks` | Saved Looks associated with this model, resolved from the Library; links into `/library/looks`. Looks never change the Character Sheet. |
| `/models/:modelId/closet-props` | Live Library shortcuts — the model's pointer rows resolved to canonical Library assets, linking into their `/library/:assetId` profiles. |
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
- `src/services/environmentsService.test.ts` — the six Environment product rules at the service boundary: (1) locked environment versions cannot be edited (spec saves, version-draft updates, reference metadata changes — and the same operations succeed on drafts); (2) draft-from-locked copies specs + references without changing the source; (3) version numbers increment safely; (4) cross-workspace reads/updates are prevented; (5) archive is soft-archive only; (6) no model identifier or model-binding API exists anywhere in environment entities.
- `src/features/environments/envLockReview.test.ts` — the lock-review gates: anchor completeness blocks locking (with product zone explicitly optional), lock requires explicit confirmation and the rights acknowledgement, non-drafts refuse to lock, and the two-version spec diff returns changed **and** unchanged fields.
- `src/services/libraryService.test.ts` — the Library product rules at the service boundary: (1) locked asset versions cannot be edited; (2) new drafts increment version numbers safely; (3) drafts copy details + references without mutating the source; (4) tags stay workspace-scoped (get-or-create by normalized name, no cross-workspace leaks); (5) `look_details` require the look asset type; (6) Looks link canonical records without duplicating item data (duplicate links and cross-asset pins refused); (7) shortcuts resolve to the one shared Library asset; (8) no Gallery-style output fields or generation APIs exist on Library entities; (9) locking requires the rights acknowledgement and a decided rights status (unknown-rights drafts cannot be locked); (10) `createLook` reads the model but never writes the Character Sheet (sheet stays byte-identical), and partial failures surface honestly. Plus soft-archive coverage.

- `src/features/media/media.test.ts` — upload-validation contracts: magic-byte sniffing (JPEG/PNG/WebP) and declared-MIME cross-checks, size/empty-file limits, SVG/GIF/PDF/executable refusal with human-readable errors, filename sanitization (traversal stripped, unsafe chars replaced, canonical extensions), 256–8192 px dimension limits, canonical storage-path structure + workspace-segment parsing, and the shared-service contract (one service class for all three target types, rights-acknowledgement and locked-version error mapping).
- `src/features/media/referencesMediaService.test.ts` — service contracts against a mocked Supabase client: rights acknowledgement required before any intent reaches the server; foreign-workspace and locked-version refusals propagate and never reach a storage transfer; transfer failures mark the pending upload failed via `fail_reference_upload`; the happy path runs intent → signed upload → complete in order; signed view URLs are minted only after the access-check RPC succeeds (600 s expiry) and are never persisted; demo mode fails honestly.

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
| `/environments` | Index: search by name, status filter (All/Draft/Ready/Archived), grid/list toggle, loading/error/empty states (empty copy: "Create your first environment"), environment cards (name, active version, status, lock state, lock level, updated) with Open/Archive quick actions, soft-archive confirmation, and the **Create an environment** modal (required name → creates environment + first draft v1 → redirects to the editor). |
| `/environments/:environmentId` | Profile Overview: room preview placeholder, active version + lock summary, protected-anchor summary, "How continuity works" panel, reusability note ("Selecting a model later does not change the environment."), "Generated outputs appear in Gallery." placeholder. |
| `/environments/:environmentId/edit` | Guided editor (draft versions only): Basic setting, Visual anchors, Physical anchors (ordered furniture/prop entries with add/edit/delete/reorder), Lock configuration (flexible/balanced/strict segmented selector). Locked versions render a protected read-only state whose only modification path is "Create new draft version". Explicit Save draft (no autosave), schema-validated, service-layer saves. |
| `/environments/:environmentId/references` | Reference metadata per version: type filter (wide/hero_angle/detail/layout/lighting/product_zone/other), draft add/rename/reorder/remove, locked read-only, disabled future-upload area ("Reference upload will be connected to secure storage next"). |
| `/environments/:environmentId/versions` | Version timeline (number, status, change summary, lock level, created/locked dates), status filter, inspect drawer with the version's spec, two-version comparison (changed AND unchanged fields), create-draft dialog with required change summary, lock actions deep-link to the lock review page. |
| `/environments/:environmentId/lock` | Final review: "Lock and save your environment" checklist of all defining anchors, lock-level explanation, version-rules card, required rights-confirmation checkbox, optional usage tags, and **Lock environment v[N]** — disabled until rights are acknowledged and required anchors are complete; then confirm dialog → lock → toast → redirect to the profile. |
| `/environments/:environmentId/specs` | Alias that redirects to `/edit` (one guided form covers all spec sections). |

Routes always use the real environment id from data — the seeded Warm Bedroom Studio id is never hard-coded into route logic.

### Draft, locked and superseded behaviour (environments)

- **Draft** versions are the only editable state: spec anchors, reference metadata and the version's lock level can change through the editor, validated by the domain schemas and saved via `EnvironmentsService` (which re-checks the lock guard before every write).
- **Locked** versions are permanently read-only. There is no UI or service path that edits them: the pure `refuseEnvironmentLocked` guard, the service checks, the mock repository, and the Postgres triggers all refuse independently. The only modification path is **Create new draft version**, which opens the required-change-summary dialog and uses the safe copy/increment path (spec + reference metadata duplicated; the source is never mutated). On lock, the environment's `active_version_id` points at the newly locked version and older locked versions become `superseded`, preserved forever.
- **Superseded** versions are immutable history — still inspectable and still selectable as a copy source for a new draft.

### Lock levels and protected anchors

`lock_level` lives on the version (`flexible | balanced | strict`), is editable while the version is a draft, is frozen on lock, and is inherited by the next draft when copying:

- **Flexible** — protects the key mood and setting direction.
- **Balanced** — protects defining anchors while allowing minor natural variation.
- **Strict** — protects layout, anchor placement and the core visual setup closely.

A lock freezes the version's defining anchors: room type and layout feel, hero camera angle, lighting style, key furniture anchors, signature props, palette/material direction, and the product zone when present. The `/lock` review page enforces completeness (all required anchors present) plus an explicit rights acknowledgement before the lock action enables; the pure gate is `assertEnvironmentLockAllowed` in `src/features/environments/envLockReview.ts`.

### How "create new draft version" works

1. From a locked version (profile header, versions row, or locked editor state) choose **Create new draft version**.
2. Pick the source version and enter a **required change summary** in the dialog.
3. The service calls the safe increment path (`create_next_environment_version` RPC on Supabase; the equivalent guarded mock in demo mode): `max(version_number) + 1`, refuses when a draft already exists, copies the source's Environment Spec (and its reference metadata) into the new draft, and never mutates the source.
4. You land on the new draft's editor, ready to change anchors.

### Environments stay independently reusable

Environments are standalone assets — never model-specific, never bound to a model here. Models, Looks, props, products and wardrobe are selected later in Content Studio; selecting a model never changes the environment. Reusable props and items remain in the **one shared Library**: `environment_asset_shortcuts` rows are pointers only (`library_asset_id` stays a documented nullable placeholder until the Library migration adds its foreign key). Generated media belongs in Gallery — environment pages show only a lightweight placeholder note.

### Development seed data

`src/mock/environmentsSeed.ts` provides one fictional environment, **Warm Bedroom Studio** (`ready`): locked v1 ("Original approved setup", lock level `balanced`) and draft v2 ("Soft evening lighting variation"), full specs for both (bedroom creator setup; warm lived-in creator corner; three-quarter hero angle facing desk and vanity; soft morning window light with warm practical lamp; bed / light oak desk / vanity mirror / upholstered chair anchors; plant / ceramic mug / notebook / skincare tray signature props; cream–beige–oak–terracotta palette; vanity/desk product zone) and three local placeholder references (wide, hero_angle, product_zone). No real places, no external URLs. A second fixture (**Glass Loft Kitchen**, `strict`) lives in another workspace for isolation tests. In demo mode the repository factory (`src/data/environmentsFactory.ts`) serves this seed under the same domain guards as production.

### Reusable assets and the shared Library

Both `model_asset_shortcuts` and `environment_asset_shortcuts` are quick-access **pointers only**. Since `20260926000003_library_domain.sql` their `library_asset_id` columns carry real foreign keys to the canonical `library_assets` record (nullable preserved for legacy/placeholder rows), with triggers enforcing same-workspace consistency. No second model- or environment-specific Library exists, and generated outputs belong in Gallery, not Environments or the Library.

## Library domain

LockFlow has **exactly one unified Library** — never "Global Library", "My Library", or per-builder libraries. It stores reusable workspace inputs: products, props, wardrobe, accessories, personal items, creator tools, brand assets, references, scenes and saved Looks, each with **one canonical record** reused across models, environments, content jobs and campaigns. Generated images, videos, story outputs, drafts and exports are **never** Library records — they belong to **Gallery**.

### Library vs Gallery

| Library | Gallery (future) |
| ------- | ---------------- |
| Reusable **inputs**: products, props, wardrobe, Looks, scenes, brand assets | Generated **outputs**: images, videos, story drafts, exports |
| Versioned approved configurations | Rendered jobs and review-ready work |
| Referenced by models, environments and content jobs | Produced by content jobs |

### Asset version & lock behaviour

- `library_asset_versions` follow the shared lifecycle: **draft** (editable: `structured_details`, `rights_status`, references) → **locked** (immutable forever) → **superseded** (preserved history, still copyable).
- Version numbers start at 1 and increment safely (`create_next_library_asset_version` RPC computes `max + 1`; one open draft per asset via partial unique index).
- A new draft copies the source's `structured_details` **and** reference metadata; the source is never mutated.
- `rights_status` (`unknown | confirmed | restricted`) records usage rights per approved configuration.
- Guards: `refuseAssetLocked` in the service, `guard_locked_library_version_transition` + `guard_library_reference_locked` triggers in Postgres.

### How Looks work

A **Look** is a special Library asset (`asset_type = 'look'`) — a reusable combination of wardrobe, accessories and presentation choices associated with **one model**:

- `look_details` (1:1 with look versions) carries the `model_id` and presentation notes. A DB trigger refuses `look_details` on non-look assets.
- `look_asset_items` link **canonical** Library assets (optionally pinning an exact approved version). Items never duplicate asset data; duplicates and cross-asset version pins are refused.
- A Look **never alters** the model's protected Character Sheet — it changes presentation only, and the wardrobe/accessory assets remain independently reusable.

### Shortcut relationship rules

Model and Environment asset shortcuts are convenience pointers into the one Library: they resolve to the same canonical records the Library serves (`LibraryService.resolveShortcutAssets`), never to copies. The migration added `model_asset_shortcuts.library_asset_id → library_assets(id)` and `environment_asset_shortcuts.library_asset_id → library_assets(id)` (both `ON DELETE SET NULL`, nullable), plus workspace-consistency triggers. Library assets carry **no** model- or environment-ownership columns.

### Library routes (functional Library UI)

| Route | Purpose |
| ----- | ------- |
| `/library` | Unified index: type tabs (All / Products / Props / Wardrobe / Accessories / Personal items / Creator tools / Scenes / Other + Saved Looks link), status filter, sort (Recently updated / Name A–Z), grid/list toggle, accessible filter reset, row overflow actions (**Open**, **Create new draft version** — refused when a draft is already open, **Archive** with confirm modal) and empty copy ("Your Library is ready for reusable assets."). Looks are excluded here and live under `/library/looks`. |
| `/library/new` | Manual asset add: three disabled future-choice cards (Upload images / Scan an item / Describe with AI, marked "Coming next") plus a working manual form — name, type (Looks excluded), description, workspace-scoped tags, rights status + acknowledgement, structured details. Creates the asset, first draft version, tags and details via the service, then navigates to Details. |
| `/library/:assetId` | Asset profile with tabs: **Overview** (cover placeholder, active version + lock status, tags, "Used in" Looks lookup, Model/Environment shortcut summaries), **Details** (structured-details draft editor for drafts; read-only lock banner + "Create new draft version" for locked), **References** (draft editor with reorder/remove/add; read-only for locked; uploads still disabled), **Versions** (filter, per-version actions, before/after detail diff, inspect drawer, lock modal with required rights acknowledgement, create-draft dialog with required change summary). |
| `/library/looks` | Saved Looks index: every look-type asset with model association and item count; links to the Look profile and the asset profile. |
| `/library/looks/new` | Create Look in one flow: model picker, presentation notes, and a searchable selector restricted to canonical wardrobe/accessory/personal_item/product/creator_tool assets (look/scene/brand/reference types are not eligible). Items can be reordered, removed and are refused when duplicated by the service. |
| `/library/looks/:assetId` | Look profile: model link, presentation notes, and the canonical item list — item names route to their asset profiles. Non-look ids redirect to the regular asset profile. |

Model and Environment panels read the same Library: the model's **Closet & Props** tab resolves its shortcut pointers live (canonical assets, linking to `/library/:id`), the model's **Looks** tab lists Saved Looks associated with that model, and the Environment Overview shows a **Library shortcuts** card. All are read-only shortcuts — the canonical records live only in the Library.

### Development seed data (Library)

`src/mock/librarySeed.ts` provides five fictional assets: **Luma Dew Serum Bottle** (product, v1 locked, rights confirmed, tags skincare/bottle/countertop), **Silver creator laptop** (creator tool, v1 locked), **Oversized beige blazer** (wardrobe, v1 locked), **Gold hoop earrings** (accessory, v1 locked), and **Neutral creator outfit** — a Saved Look for Aisha (v1 draft) linking the blazer (version-pinned) and earrings as canonical items with presentation notes; Aisha's Character Sheet is untouched. A sixth asset in another workspace exists for scoping tests. Local placeholder paths only.

## Content Studio domain

Content Studio **assembles approved reusable inputs into content plans and future generation jobs**. It owns nothing: Models, Environments, Library assets and Looks stay canonical and independently reusable — a plan records selections with roles, and a job pins exact versions. Generated outputs are **never** Content Studio records; they belong to Gallery.

### Content Project vs Content Job Request

| | Content Project (`content_projects`) | Content Job Request (`content_job_requests`) |
| - | ------------------------------------ | -------------------------------------------- |
| Purpose | A campaign-style **plan / working brief** | The future **generation request** |
| Edits | Draft projects are fully editable (inputs, scenes, beats) | Draft requests only; snapshots immutable after submission |
| Version policy | Draft **or** locked versions may be selected while experimenting | Execution-ready jobs require **locked** versions only |
| Structure | Scenes → Beats with explicit, unique order | `brief_snapshot` + `plan_snapshot` captured at creation |
| Outputs | None — it is not a generated-output record | None in this phase — no provider, no media |

### Version-pinning rules (and why)

- An execution-ready job must pin a specific **locked** model version, a locked environment version (when an environment is selected), and exact **locked** Library asset versions where assets are selected.
- A Look may be selected only via a **locked Look version**; its linked item versions are **resolved and pinned at job-creation time** (a pinned item uses that version; an unpinned item resolves to the asset's current locked active version).
- **Why:** reproducibility and consent. Locked versions are immutable approved configurations with acknowledged rights; silently substituting a newer version would change the model's identity, the environment's anchors, or the asset's approved configuration after the fact. `content_job_pins.resolved_details` stores a minimal immutable context snapshot (names, version numbers, `locked_at`) — never a duplicate of the source record, and no permanent model ↔ environment relationship is created.
- Human-readable readiness errors: "Select a locked Model version before preparing this job.", "The selected Environment version is still a draft.", "A Look contains an unavailable asset version."

### Scene & Beat ordering

- A project holds one or more scenes (`unique (content_project_id, scene_order)`); a scene holds one or more beats (`unique (content_scene_id, beat_order)`). Both constraints are `DEFERRABLE INITIALLY DEFERRED` so reorders are transaction-safe.
- Reorders pass the **complete** id list; the service validates it and rewrites compact 0..n-1 orders. Deletes compact sibling order. Beats cascade on scene delete.
- Scenes and beats (and project inputs) are structurally editable **only while the project is draft** — enforced by the service guard (`assertProjectDraftEditable`) and a DB trigger; executing/completed/archived jobs preserve their historic pinned inputs and plan snapshot.

### Job states and the provider boundary

```
draft → queued → processing → review → completed
              ↘ cancelled        ↘ failed → draft (future retry)
```

- Only **draft** job requests can be created in this phase. `queued`/`processing`/`review` are refused by both the service (`refuseJobStatusWithoutProvider`) and a DB trigger while no provider integration exists (`provider_name` is null).
- Transitions are strict (see `JOB_STATUS_TRANSITIONS`); `content_job_events` is an append-only audit timeline (`draft_created` is the only event written today).
- **Generated outputs will live in Gallery** — Content Studio and the Library never store or display generated media.

### Content Studio routes

| Route | Purpose |
| ----- | ------- |
| `/content-studio` | Draft-project list (title, status, selected model/environment, output-type placeholder, updated date) with loading/empty/error states and a **New content plan** modal (name required, optional campaign brief) that creates a draft project through the service layer. |
| `/content-studio/:projectId` | Lightweight plan detail placeholder: brief, audience/voice, planned inputs (canonical records with roles and exact selected versions), and the scene/beat structure. Full editing UI comes next. |

### Migrations and seed data (Content Studio)

- `supabase/migrations/20260926000004_content_studio_domain.sql` — content_projects, content_project_inputs, content_scenes, content_beats, content_job_requests, content_job_pins, content_job_events; RLS on every table (workspace membership); input-shape + workspace-consistency trigger; draft-editability trigger; job status state-machine + provider-boundary trigger; pins locked-version + immutability triggers; append-only event triggers.
- `src/mock/contentSeed.ts` — the fictional **Morning Skincare Routine** draft project (Aisha locked v1, Warm Bedroom Studio locked v1, Luma Dew Serum locked v1, Neutral creator outfit **locked** Look v2 with resolved items), three ordered scenes with two ordered beats each, and a draft **content_set** job request (3 variants) with a single `draft_created` event. The Look's locked v2 version was added to `librarySeed` for this purpose.

## Gallery domain

Gallery holds **generated content only**: output records, in-progress jobs, review-ready and approved work, plus collections that group outputs. It is strictly separate from the unified Library.

### Library vs Gallery (contractual)

- The **Library** contains reusable *inputs* — products, props, wardrobe, Looks, scenes, references, brand assets.
- **Gallery** contains generated *outputs*. An output is never stored as a Library asset and never becomes a reusable source automatically.
- An output may *reference* the immutable job pins that created it, but nothing flows back into Models, Environments or the Library from a Gallery record.

### Output status & review lifecycle

`draft → processing → ready_for_review → approved | rejected → archived`, plus `failed` from draft/processing. Only the transitions encoded in `GALLERY_OUTPUT_TRANSITIONS` (`src/domain/gallery/guards.ts`) are permitted; restore returns an archived output to its prior reviewable status explicitly. Approval/rejection are **review decisions on an output** — they never rewrite the original job, its pins or source assets. Rejection feedback is preserved for future variant/correction workflows. All archive/restore are soft-state changes; standard flows never hard-delete.

### Provenance & immutable version pins

Every output belongs to exactly one `content_job_request` and inherits its historical context from that job's `content_job_pins` and `plan_snapshot`: pinned model version, environment version, Look version (with items resolved via the Look), and shared Library asset versions. The detail view shows these as a **read-only historical record** — "Version used in this output" — and links to source profiles without offering edits. If a source later gets a newer version, the provenance still shows the exact pinned version.

### Collections

Collections group **Gallery outputs only** — never Library assets. Items are ordered (safe reorder service), removable without deleting the output, and collections soft-archive.

### Provider & storage boundary

No generation provider is connected: there is no working "Generate" action anywhere in Gallery, and normal UI cannot move an output from draft to processing (the guard refuses; dev seed data may contain non-draft statuses so the review UI is testable). Media paths (`media_storage_path`, `thumbnail_storage_path`) are **private placeholder metadata only** — no public URLs, no object-storage uploads, no service credentials in client code. Placeholder records are clearly labelled: "Placeholder preview — provider generation and secure media storage are not connected yet."

### Gallery routes

- `/gallery` — dashboard: summary counts (ready for review / approved / draft+processing / failed), search, type + status + project filters, sort, grid/list, overflow Archive; empty state: "Your generated work will appear here."
- `/gallery/:outputId` — review page: placeholder preview with dev label, metadata + tags, review history, immutable provenance panel, job timeline, guarded approve/request-changes/reject/archive/restore dialogs.
- `/gallery/collections`, `/gallery/collections/:collectionId` — collection list + ordered detail (searchable add, move up/down, remove, archive confirm).

Content Studio's job tab links back to Gallery with the note that outputs will appear there once a provider is connected.

### Migrations and seed data (Gallery)

- `supabase/migrations/20260928000002_gallery_domain.sql` — gallery_outputs, gallery_output_reviews, gallery_output_tags (unique normalized name per workspace), gallery_output_tag_links, gallery_collections, gallery_collection_items, gallery_output_events; RLS on every table via `is_workspace_member`; same-workspace consistency triggers (output↔job↔project, reviews↔output, items↔outputs↔collections); status state-machine trigger with the same transition table; review-history append-only + job-pin protection; append-only events.
- `src/mock/gallerySeed.ts` — four fictional placeholder outputs on the seeded Morning Skincare Routine job ("Morning Vanity Setup" ready_for_review, "Serum Product Moment" approved video, "Routine Wrap-up Story" rejected with feedback, "Morning Routine Variant" draft with parent link) with tags, the **Morning Skincare Campaign** collection, and output events. All records carry `metadata.placeholder: true` and local `placeholders/gallery/*.svg` paths — this is development placeholder metadata, not generated media.

## Secure reference uploads

Reference images for Models, Environments and Library assets upload to **private** Supabase Storage through one shared service (`src/features/media/`); no UI component touches storage directly and the logic is never duplicated per domain.

| Concern | Design |
| ------- | ------ |
| Buckets | `lockflow-references` (all reference images), `lockflow-previews` (reserved for a later preview/thumbnail milestone). Both **private**; no public bucket exists. |
| Paths | `workspaces/{workspaceId}/models|environments|library/{ownerId}/versions/{versionId}/references/{referenceId}/{safeFilename}` — the reference id is a server-side UUID and filenames are sanitized (`[a-z0-9._-]`, traversal stripped, canonical extension from the verified type). |
| Authorization | Storage policies derive the workspace **from the object path itself** (`split_part(name,'/',2)`), never from a client-supplied id; RPCs re-check membership, draft status, rights, MIME and size server-side (security definer, `authenticated` only). |
| Upload flow | Client preflight (magic bytes, size, dimensions) → `begin_reference_upload` (creates the **pending** reference + `upload_requested` audit event) → direct upload to the single signed URL → `complete_reference_upload` (pending → uploaded, records dimensions) or `fail_reference_upload`. Retry starts a fresh intent; pending/failed rows are never treated as available. |
| Viewing | Signed view URLs (10-minute expiry) minted **only after** `log_signed_url_access` verifies the reference row is member-visible; URLs live in memory, are never persisted, and refresh transparently on expiry. |
| Draft vs locked | Drafts may add/caption/reorder/remove. Locked and superseded versions are fully read-only — the DB immutability triggers reject every mutation, including status flips; the UI shows "References are protected in this locked version. Create a new draft version to make changes." Removal on drafts is a **soft delete** (records are never hard-deleted). |
| Rights | Every upload requires the checkbox "I confirm that I have the right to upload and use this reference in LockFlow." It is enforced in the dialog, the service and the RPC, and recorded (`rights_confirmed_at` / `rights_confirmed_by`) plus audited. |
| Formats & limits | JPEG / PNG / WebP only (verified by file signature, cross-checked against the declared MIME), ≤ 10 MB, 256×256 – 8192×8192 px, empty files and unsafe filenames rejected. SVG/GIF/HEIC/PDF/video are refused. |
| Audit trail | `upload_audit_events` records upload_requested / upload_completed / upload_failed / metadata_updated / soft_deleted / signed_url_requested per workspace — append-only (no update/delete policies). |
| Honest limitation | This stack has no server-side image-processing runtime, so file signatures and dimensions are validated **client-side preflight**; the database re-validates MIME/size declaratively. No server-side magic-byte or dimension verification is claimed, and nothing scans, recognises or analyses uploaded images. |
| Demo mode | Without Supabase env vars the upload surfaces show an honest "demo mode uses local placeholders" gate; seeded placeholder references keep rendering. |
| Physical cleanup | Deleting uploaded objects is a future **server-side** job for soft-deleted draft-only references; there is no client-side delete path. |

## Image generation (provider-agnostic, image only)

Image generation runs through a dedicated Generation domain (`src/generation/`) behind one provider-neutral adapter interface. **No real provider adapter ships yet** — the registry contains only `DevelopmentFakeImageProvider` (local dev/tests: clearly marked placeholder SVGs, zero network calls), and production **fails closed**: with no configured provider the Generate action stays unavailable with a configuration message.

| Concern | Design |
| ------- | ------ |
| Adapter boundary | `ImageGenerationProvider` (submit / status / isConfigured). UI components never import adapters; the `GenerationService` resolves the configured name from the registry and refuses unknown/unconfigured providers. |
| Server-side execution | Submission, provider calls, quota changes and ingestion are privileged server-side paths (security-definer RPCs in `20260928130000_generation_domain.sql`; the deployed worker uses the service role). No provider SDK or key ever reaches the browser. |
| Job/run state | `generation_provider_runs` records every attempt (idempotency key unique; snapshots exclude secrets and signed URLs; failures append attempts, never overwrite). Jobs follow the existing guarded state machine: draft → queued → processing → review/completed/failed (failed → draft on retry). |
| Eligibility | All pins must be locked versions; model/environment/library/look sources must not be archived; library rights must be `confirmed`; pending/failed/deleted reference uploads block submission; output type must be image-compatible (photo/content_set); quotas enforced server-side before any provider contact. |
| Quota & idempotency | `generation_quota_usage` tracks per workspace/user monthly jobs+outputs (auditable guard, not billing). One active run per job: duplicate submissions reuse it; completed runs are returned, never silently resubmitted; retry = new attempt number, same immutable pins. |
| Ingestion | Results are fetched server-side, stored in the **private** `lockflow-gallery-media` bucket (`workspaces/{ws}/jobs/{job}/runs/{run}/outputs/{output}/{file}`), and each image becomes a Gallery output (`output_type=image`, `ready_for_review`, `generation_provider_run_id` provenance). Gallery only — never the Library. Signed URLs are never persisted. |
| Safety & rights | References resolve only from exact pinned versions through short-lived signed URLs; rights-unknown/restricted sources are refused; provider safety blocks map to a safe user message with protected technical detail retained server-side only; no face-swap/impersonation features exist. |
| Observability | `generation_audit_events` records submission_requested, eligibility_failed, quota_denied, provider_run_created, provider_request_accepted, status_update_received, result_ingested, provider_error, retry_requested, output_created — workspace-scoped, read-only for members. |

### Server-only environment variables (names only)

`IMAGE_PROVIDER_NAME` · `IMAGE_PROVIDER_API_KEY` · `IMAGE_GENERATION_ENABLED` · `IMAGE_MAX_OUTPUTS_PER_JOB` · `IMAGE_MAX_JOBS_PER_USER_PER_PERIOD` · `IMAGE_MAX_JOBS_PER_WORKSPACE_PER_PERIOD` · `IMAGE_SIGNED_REFERENCE_URL_TTL_SECONDS` · `IMAGE_WORKER_CONCURRENCY`

These are read by the server-side worker only (never `VITE_`-prefixed, never in Git, logs or error messages); the worker syncs the non-secret limits into `generation_config` via `sync_generation_config`.

### Development fake provider

In demo mode the fake provider is enabled automatically (`development-fake`): the job tab shows a readiness checklist, requires the rights/allowance acknowledgement, and on Generate produces clearly marked placeholder outputs in Gallery through the exact production state machine. No real provider call is ever simulated.

## Short-form video generation (Phase 1, image architecture reused)

Video generation extends the Prompt-12 Generation domain with a provider-neutral `VideoGenerationProvider` — **no real video adapter ships yet** (`DevelopmentFakeVideoProvider` only; production fails closed). Phase-1 contract: **4/6/8-second** clips, **9:16 / 1:1 / 16:9** aspect ratios, **mp4/webm** outputs only, for Video and Story plans. No long-form timelines, audio, speech, lip sync or voice cloning exist, and overlay/dialogue text is guidance only. Multi-scene long-form studio production belongs to Phase 2.

| Concern | Design |
| ------- | ------ |
| Beat-aware runs | Each clip may target one Scene + Beat; immutable `scene_snapshot` / `beat_snapshot` are frozen at submission (later storyboard edits never change a submitted clip), stored on `generation_provider_runs` (`generation_kind='video'`) and copied into output metadata. Workspace/scene/beat consistency is DB-enforced. |
| Separate quotas | `generation_video_quota_usage` tracks jobs **and total requested seconds** per workspace/user month (auditable guard, not billing), with separate configurable limits (`VIDEO_MAX_*`). |
| Ingestion | Clips land in the private `lockflow-gallery-media` bucket under `runs/{run}/videos/{output}/`; provider-supplied thumbnails under `runs/{run}/thumbnails/{output}/`. No transcoding/FFmpeg infrastructure. Gallery outputs carry `output_type=video\|story`, `ready_for_review`, duration/dimensions/mime and scene/beat provenance columns. |
| Env vars (names only) | `VIDEO_PROVIDER_NAME` · `VIDEO_PROVIDER_API_KEY` · `VIDEO_PROVIDER_WEBHOOK_SECRET` (callback-capable providers only) · `VIDEO_GENERATION_ENABLED` · `VIDEO_MAX_OUTPUTS_PER_JOB` · `VIDEO_MAX_JOBS_PER_USER_PER_PERIOD` · `VIDEO_MAX_JOBS_PER_WORKSPACE_PER_PERIOD` · `VIDEO_MAX_SECONDS_PER_USER_PER_PERIOD` · `VIDEO_MAX_SECONDS_PER_WORKSPACE_PER_PERIOD` · `VIDEO_SIGNED_REFERENCE_URL_TTL_SECONDS` · `VIDEO_WORKER_CONCURRENCY` |
| UI | The job tab's video panel offers scene/beat/duration/aspect/count selection, the video allowance acknowledgement, live status and safe retry; Gallery detail marks generated clips and links exact pinned versions. |

## Continuity quality reviews & correction requests (human review, provider-agnostic)

The Quality domain (`src/quality/`) adds **review records only** — it never edits source modules, job pins or output media, never calls providers, and never changes a Gallery output's approval status. A review evaluates an output against the **exact pinned inputs** used to create it ("Version used in this output"), resolved from the output's immutable job pins and frozen run snapshots at review-creation time; later Model/Environment/Library updates never alter historic review context. Findings use 19 workspace-safe categories (model_identity … continuity/other) with pass/warning/fail/not_checked results and low/medium/high severity; they are editable **only while the parent review is a draft** — completed reviews are read-only (append-only except safe archival). Automated analysis does not exist: review is human and manual.

| Concern | Design |
| ------- | ------ |
| Correction requests | Controlled derivative jobs from a Gallery output: requested change + scope (composition/framing/camera/lighting/product_framing/motion/continuity/prompt_direction/other) + optional linked findings. `source_snapshot` / `pin_snapshot` are built **server-side** from the parent output's historical provenance and freeze the moment the request leaves draft — no asset/version selectors exist, so newer versions can never be silently substituted. The parent output is never overwritten. |
| Source-change classifier | Transparent rules: identity/face/hairstyle/skin/body findings require a new **Model version**; room-layout/furniture-anchor findings require a new **Environment version**; product/wardrobe/accessory redesign text requires a new **Library Asset/Look version**. Permitted corrections: placement/framing, camera/crop, composition, minor lighting mood that doesn't contradict the locked environment, prompt clarity, motion direction, text-overlay placement, continuity retaining exact pins. The UI shows the matched rule plus read-only links to the pinned source profiles; versions are never auto-created and locked sources are never edited from the correction screen. |
| Recurring-issue escalation | Advisory only. Issue key = category + deterministic FNV-1a hash of the pinned version IDs (never contents/media). Occurrences recorded server-side (RPC `record_quality_issue_occurrence`) at review completion: 1st → "Add clearer direction…", 2nd → "Consider adding stronger or more specific approved references…", 3rd → "Consider constrained provider settings or a provider-specific workflow review…", 4th+ → "This issue is recurring. Review the source references and provider workflow before further generation." Nothing changes providers, prompts or versions automatically; no cross-workspace aggregates. |
| Provider boundary | The Quality module has **no provider imports**. Submission goes only through the injected `CorrectionGenerationBoundary` typed to the existing Generation service interface — **intentionally unwired**; ready requests show "Correction generation will become available when your configured provider supports it." When later enabled: new provider run + NEW Gallery output with `parent_gallery_output_id`, retaining the exact original pins/snapshots, under existing quota/idempotency/private-storage rules. |
| Gallery vs Library | Reviews/findings/corrections attach to Gallery outputs and generation jobs only; they never create or modify Library assets. Corrected outputs are Gallery derivatives, never Library records. |
| Data & RLS | Migration `20260928150000_quality_corrections.sql`: `quality_reviews` (partial unique index = one active draft per reviewer/output), `quality_findings`, `correction_requests`, `correction_request_findings` (composite unique, same workspace+output), append-only `correction_request_events` (no UPDATE/DELETE policies; no secrets/signed URLs/raw media), `recurring_quality_issues` (select-only for members; writes via RPC). All tables RLS-enabled with `is_workspace_member` policies; same-workspace FKs throughout. |
| UI | `/gallery/:outputId/quality` (sectioned checklist with expected-from-pins rows, save draft / complete, completed = read-only), `/gallery/:outputId/corrections` (create flow with "What LockFlow will preserve" + source-change warning), `/corrections` (search/filter/sort list), `/corrections/:id` (status badge, event timeline, immutable pins, escalation recommendation, per-status actions). Gallery detail gains "Review continuity" / "Create correction" actions and a compact quality summary — the existing approve/reject flow is untouched. |

## Roadmap beyond this milestone

1. Workspace provisioning on first sign-in (create workspace + owner membership).
2. ~~Model Builder and Environment Builder data models with version + lock tables.~~ Done — Models data foundation + interface, Environments data foundation.
3. ~~Environment Builder UI~~ Done — the Environment Builder interface (index, profile, editor, references, versions, lock review) ships on the Environments data layer; AI-assisted composition remains out of scope.
4. Library asset types backed by Supabase Storage (private bucket already provisioned) — ~~reference uploads to secure storage~~ **Done** — private, workspace-scoped reference uploads ship on the `lockflow-references` bucket; remaining: preview/thumbnail generation into `lockflow-previews` and the server-side cleanup job for soft-deleted objects.
5. Content job pipeline feeding the Gallery — data layer + functional UI done; ~~secure media storage~~ done; provider integration: **image + short-form video abstractions and development fake providers shipped, production adapters pending selection**.
