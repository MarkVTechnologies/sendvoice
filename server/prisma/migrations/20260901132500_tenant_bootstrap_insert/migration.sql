-- A brand-new Tenant row can never match `app.tenant_id` (it doesn't exist
-- until this insert commits), so the blanket tenant_isolation policy blocks
-- all Tenant creation, including signup. This is a separate, additive
-- permissive policy scoped to INSERT only — RLS ORs permissive policies for
-- the same command, so it doesn't weaken the SELECT/UPDATE/DELETE isolation
-- already enforced by tenant_isolation on "Tenant".
--
-- The signup flow: insert Tenant (allowed by this policy) → within the same
-- transaction, set_config('app.tenant_id', <new tenant id>, true) → insert
-- the first User (allowed by the existing tenant_isolation policy on "User",
-- since app.tenant_id now equals the tenant just created).
create policy tenant_bootstrap_insert on "Tenant"
  for insert
  with check (true);
