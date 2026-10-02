-- LockFlow — Library attachment role semantics + campaign-item targets (Prompt 23)
--
-- The unified Library's attachment records gain their first real product
-- integrations (Content Studio scenes/jobs and Campaign items):
--   * 'campaign_item' joins the polymorphic target enum so per-item
--     planning/composition attachments reference the canonical Library asset
--     (never a copy). Workspace scoping keeps working through the existing
--     workspace_id RLS policies; target existence is validated service-side
--     via the campaign bridge (item → parent campaign → workspace).
--   * Role/slot semantics (single vs multi cardinality, asset-type fit for
--     roles like "primary product") are validated context-aware in the
--     service layer; the DB keeps the text role_or_slot plus the existing
--     one-primary-per-slot partial unique index as the hard backstop.
--
-- ALTER TYPE ... ADD VALUE runs in a transaction on PG 12+ as long as the
-- new value is not used in the same transaction (it is only used by the
-- app after this migration applies).

alter type public.library_attachment_target add value if not exists 'campaign_item';
