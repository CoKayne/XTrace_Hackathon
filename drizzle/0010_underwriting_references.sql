begin;

create table if not exists public.benchmark_packs (
  id text primary key,
  version text not null check (btrim(version) <> ''),
  provider text not null check (btrim(provider) <> ''),
  source_url text not null check (btrim(source_url) <> ''),
  published_at date not null,
  retrieval_date date not null,
  geography text not null,
  sector text not null,
  observation_window text not null,
  sample_notes text not null,
  stale_after_days integer not null check (stale_after_days > 0),
  synthetic boolean not null default false,
  publication_status text not null check (
    publication_status in ('draft', 'published', 'retired')
  ),
  created_at timestamptz not null default now()
);

create table if not exists public.benchmark_entries (
  id text primary key,
  benchmark_pack_id text not null
    references public.benchmark_packs(id),
  stage text not null check (stage in ('seed', 'series_a')),
  metric text not null,
  value text not null,
  valuation_basis text,
  currency text,
  metric_definition text not null,
  effective_at date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.critical_evidence_profiles (
  id text primary key,
  version text not null,
  stage text not null check (stage in ('seed', 'series_a')),
  business_model text not null check (
    business_model in ('b2b_saas', 'enterprise_ai')
  ),
  required_fields jsonb not null,
  synthetic boolean not null default false,
  publication_status text not null check (
    publication_status in ('draft', 'published', 'retired')
  ),
  created_at timestamptz not null default now()
);

create table if not exists public.valuation_method_policies (
  id text primary key,
  version text not null,
  stage text not null check (stage in ('seed', 'series_a')),
  business_model text not null check (
    business_model in ('b2b_saas', 'enterprise_ai')
  ),
  methods jsonb not null,
  synthetic boolean not null default false,
  publication_status text not null check (
    publication_status in ('draft', 'published', 'retired')
  ),
  created_at timestamptz not null default now()
);

create table if not exists public.decision_policies (
  id text primary key,
  version text not null,
  stage text not null check (stage in ('seed', 'series_a')),
  business_model text not null check (
    business_model in ('b2b_saas', 'enterprise_ai')
  ),
  rules jsonb not null,
  synthetic boolean not null default false,
  publication_status text not null check (
    publication_status in ('draft', 'published', 'retired')
  ),
  created_at timestamptz not null default now()
);

create table if not exists public.framework_sources (
  id text primary key,
  version text not null,
  rights_status text not null,
  private_body text not null,
  private_object_key text,
  admin_review_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.framework_cards (
  id text primary key,
  version text not null,
  source_id text not null references public.framework_sources(id),
  title text not null,
  synthetic boolean not null default false,
  publication_status text not null check (
    publication_status in ('draft', 'published', 'retired')
  ),
  attribution text not null,
  approved_neutral_paraphrase text not null,
  locator text not null,
  limitations jsonb not null,
  rights_status text not null,
  formal_decision_weight numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint framework_cards_synthetic_weight_check
    check (not synthetic or formal_decision_weight = 0)
);

create table if not exists public.framework_packs (
  id text primary key,
  version text not null,
  title text not null,
  synthetic boolean not null default false,
  publication_status text not null check (
    publication_status in ('draft', 'published', 'retired')
  ),
  created_at timestamptz not null default now()
);

create table if not exists public.framework_pack_cards (
  framework_pack_id text not null references public.framework_packs(id),
  framework_card_id text not null references public.framework_cards(id),
  position integer not null check (position > 0),
  primary key (framework_pack_id, framework_card_id),
  unique (framework_pack_id, position)
);

create table if not exists public.underwriting_contexts (
  id text primary key,
  context_version text not null,
  stage text not null check (stage in ('seed', 'series_a')),
  business_model text not null check (
    business_model in ('b2b_saas', 'enterprise_ai')
  ),
  supported_geographies jsonb not null,
  security_type text not null check (security_type = 'preferred'),
  critical_evidence_profile_id text not null
    references public.critical_evidence_profiles(id),
  us_benchmark_pack_id text
    references public.benchmark_packs(id),
  us_benchmark_compatibility text not null check (
    us_benchmark_compatibility in (
      'exact', 'broad_compatible', 'adjacent_only', 'unavailable'
    )
  ),
  global_benchmark_compatibility text not null check (
    global_benchmark_compatibility in (
      'exact', 'broad_compatible', 'adjacent_only', 'unavailable'
    )
  ),
  valuation_method_policy_id text not null
    references public.valuation_method_policies(id),
  decision_policy_id text not null
    references public.decision_policies(id),
  framework_pack_id text not null references public.framework_packs(id),
  publication_status text not null check (
    publication_status in ('draft', 'published', 'retired')
  ),
  created_at timestamptz not null default now(),
  unique (stage, business_model, context_version)
);

create table if not exists public.fund_policy_versions (
  id text not null,
  workspace_id text not null
    references public.workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  source text not null check (
    source in ('recommended_policy', 'user_custom')
  ),
  values jsonb not null check (jsonb_typeof(values) = 'object'),
  created_by_user_id text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, version)
);

create table if not exists public.workspace_active_fund_policies (
  workspace_id text primary key
    references public.workspaces(id) on delete cascade,
  version_id text not null,
  updated_at timestamptz not null default now(),
  constraint workspace_active_fund_policy_version_fkey
    foreign key (workspace_id, version_id)
    references public.fund_policy_versions(workspace_id, id)
);

create or replace function public.reject_immutable_underwriting_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is immutable; append a new version instead', tg_table_name;
end;
$$;

drop trigger if exists fund_policy_versions_immutable
  on public.fund_policy_versions;
create trigger fund_policy_versions_immutable
before update or delete on public.fund_policy_versions
for each row execute function
  public.reject_immutable_underwriting_reference();

create or replace function public.balanced_fund_policy_values()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', 'fund_policy_balanced_us_software_v1',
    'riskPreference', 'balanced',
    'baseCurrency', 'USD',
    'stageMandate', jsonb_build_array('seed', 'series_a'),
    'businessModelMandate',
      jsonb_build_array('b2b_saas', 'enterprise_ai'),
    'geographyMandate', jsonb_build_array('global'),
    'committedFundSize', '200000000',
    'remainingDeployableCapital', '140000000',
    'initialCheckMin', '1500000',
    'initialCheckMax', '8000000',
    'targetOwnership', '0.10',
    'targetOwnershipMin', '0.075',
    'targetOwnershipMax', '0.15',
    'hardMinimumOwnership', null,
    'reserveMultipleOfInitialCheck', '1.0',
    'portfolioConcentrationLimit', '0.10',
    'returnTargets', jsonb_build_object(
      'seed', jsonb_build_object(
        'grossMoic', '5',
        'grossIrr', '0.2228445449938519',
        'horizonYears', '8'
      ),
      'series_a', jsonb_build_object(
        'grossMoic', '3',
        'grossIrr', '0.169930812758687',
        'horizonYears', '7'
      )
    ),
    'scenarioPriceMultipliers', jsonb_build_object(
      'bear', '0.75',
      'base', '1',
      'bull', '1.25'
    ),
    'valuationPremiumReviewThreshold', '0.25',
    'valuationPremiumBlockerThreshold', '0.50',
    'acceptableFutureDilution', '0.50',
    'humanFinalApproval', true,
    'externalActionMode', 'draft_only'
  )
$$;

create or replace function public.activate_fund_policy_version(
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id text := btrim(p_request ->> 'workspaceId');
  target_actor_id text := nullif(btrim(p_request ->> 'actorId'), '');
  expected_active_version_id text :=
    nullif(btrim(p_request ->> 'expectedActiveVersionId'), '');
  target_action text := btrim(p_request ->> 'action');
  restore_version_id text := nullif(btrim(p_request ->> 'versionId'), '');
  active_version_id text;
  next_version integer;
  next_id text;
  next_source text;
  next_values jsonb;
  inserted public.fund_policy_versions%rowtype;
begin
  if jsonb_typeof(p_request) <> 'object'
    or coalesce(target_workspace_id, '') = ''
    or target_action not in ('recommended', 'custom', 'restore')
  then
    raise exception 'A valid Fund Policy activation request is required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array('fund-policy', target_workspace_id)::text,
      0
    )
  );
  select version_id
  into active_version_id
  from public.workspace_active_fund_policies
  where workspace_id = target_workspace_id;

  if active_version_id is distinct from expected_active_version_id then
    raise exception 'FUND_POLICY_VERSION_CONFLICT';
  end if;

  if target_action = 'recommended' then
    next_source := 'recommended_policy';
    next_values := public.balanced_fund_policy_values();
  elsif target_action = 'custom' then
    if target_actor_id is null
      or jsonb_typeof(p_request -> 'values') <> 'object'
    then
      raise exception 'A custom Fund Policy requires an actor and values';
    end if;
    next_source := 'user_custom';
    next_values := p_request -> 'values';
  else
    if target_actor_id is null or restore_version_id is null then
      raise exception 'A restore requires an actor and version';
    end if;
    select source, values
    into next_source, next_values
    from public.fund_policy_versions
    where workspace_id = target_workspace_id
      and id = restore_version_id;
    if not found then
      raise exception 'FUND_POLICY_VERSION_NOT_FOUND';
    end if;
  end if;

  select coalesce(max(version), 0) + 1
  into next_version
  from public.fund_policy_versions
  where workspace_id = target_workspace_id;
  next_id := 'fund_policy:' || target_workspace_id || ':v'
    || next_version::text;

  insert into public.fund_policy_versions (
    id, workspace_id, version, source, values, created_by_user_id
  ) values (
    next_id, target_workspace_id, next_version, next_source, next_values,
    target_actor_id
  )
  returning * into inserted;

  insert into public.workspace_active_fund_policies (
    workspace_id, version_id, updated_at
  ) values (
    target_workspace_id, inserted.id, now()
  )
  on conflict (workspace_id) do update
  set version_id = excluded.version_id,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'id', inserted.id,
    'workspaceId', inserted.workspace_id,
    'version', inserted.version,
    'source', inserted.source,
    'values', inserted.values,
    'createdByUserId', inserted.created_by_user_id,
    'createdAt', inserted.created_at
  );
end;
$$;

insert into public.benchmark_packs (
  id, version, provider, source_url, published_at, retrieval_date,
  geography, sector, observation_window, sample_notes, stale_after_days,
  synthetic, publication_status
) values (
  'benchmark_pack_synthetic_us_software_v1',
  '1',
  'Product-owned synthetic fixture',
  'synthetic://benchmark/us-software-v1',
  date '2026-07-29',
  date '2026-07-29',
  'us',
  'software',
  'Synthetic Slice-1 observation window',
  'Synthetic values used only to exercise benchmark lineage and gating.',
  180,
  true,
  'published'
) on conflict (id) do nothing;

insert into public.benchmark_entries (
  id, benchmark_pack_id, stage, metric, value, valuation_basis, currency,
  metric_definition, effective_at
) values
  (
    'benchmark_entry_synthetic_seed_valuation_v1',
    'benchmark_pack_synthetic_us_software_v1',
    'seed', 'reported_valuation', '24000000', 'reported_unspecified', 'USD',
    'Synthetic reported valuation fixture.', date '2026-07-29'
  ),
  (
    'benchmark_entry_synthetic_series_a_valuation_v1',
    'benchmark_pack_synthetic_us_software_v1',
    'series_a', 'reported_valuation', '80000000',
    'post_money_synthetic', 'USD',
    'Synthetic reported valuation fixture.', date '2026-07-29'
  )
on conflict (id) do nothing;

insert into public.critical_evidence_profiles (
  id, version, stage, business_model, required_fields, synthetic,
  publication_status
)
select
  'critical_evidence_' || stage || '_' || business_model || '_v1',
  '1',
  stage,
  business_model,
  jsonb_build_array(
    'revenue_quality', 'customer_evidence', 'unit_economics',
    'capital_and_runway', 'valuation_ask'
  ),
  true,
  'published'
from (
  values
    ('seed', 'b2b_saas'),
    ('seed', 'enterprise_ai'),
    ('series_a', 'b2b_saas'),
    ('series_a', 'enterprise_ai')
) as profiles(stage, business_model)
on conflict (id) do nothing;

insert into public.valuation_method_policies (
  id, version, stage, business_model, methods, synthetic,
  publication_status
)
select
  'valuation_method_' || stage || '_' || business_model || '_v1',
  '1',
  stage,
  business_model,
  jsonb_build_array('venture_method', 'market_comps', 'ownership_return'),
  true,
  'published'
from (
  values
    ('seed', 'b2b_saas'),
    ('seed', 'enterprise_ai'),
    ('series_a', 'b2b_saas'),
    ('series_a', 'enterprise_ai')
) as policies(stage, business_model)
on conflict (id) do nothing;

insert into public.decision_policies (
  id, version, stage, business_model, rules, synthetic,
  publication_status
)
select
  'decision_policy_' || stage || '_' || business_model || '_v1',
  '1',
  stage,
  business_model,
  jsonb_build_object(
    'humanFinalApproval', true,
    'externalActionMode', 'draft_only',
    'synthetic', true
  ),
  true,
  'published'
from (
  values
    ('seed', 'b2b_saas'),
    ('seed', 'enterprise_ai'),
    ('series_a', 'b2b_saas'),
    ('series_a', 'enterprise_ai')
) as policies(stage, business_model)
on conflict (id) do nothing;

insert into public.framework_sources (
  id, version, rights_status, private_body, private_object_key,
  admin_review_note
)
select
  'framework_source_synthetic_' || ordinal || '_v1',
  '1',
  'product_owned_synthetic',
  'Product-owned synthetic fixture ' || ordinal
    || '. No third-party content.',
  null,
  'Synthetic executable-infrastructure fixture.'
from generate_series(1, 8) as series(ordinal)
on conflict (id) do nothing;

insert into public.framework_cards (
  id, version, source_id, title, synthetic, publication_status,
  attribution, approved_neutral_paraphrase, locator, limitations,
  rights_status, formal_decision_weight
)
select
  'framework_card_synthetic_' || ordinal || '_v1',
  '1',
  'framework_source_synthetic_' || ordinal || '_v1',
  title,
  true,
  'published',
  'Product-owned synthetic fixture',
  'Synthetic test lens ' || ordinal || ': evaluate '
    || lower(title) || ' using only source-grounded company evidence.',
  'synthetic://framework/' || ordinal,
  jsonb_build_array(
    'Synthetic fixture for executable infrastructure tests only.',
    'Carries no formal decision weight.'
  ),
  'product_owned_synthetic',
  0
from (
  values
    (1, 'Market Size & Why Now'),
    (2, 'Founder & Unique Insight'),
    (3, 'Product-Market Fit & Customer Evidence'),
    (4, 'Contrarian Market Structure'),
    (5, 'Durable Competitive Power'),
    (6, 'GTM & Unit Economics'),
    (7, 'Revenue Quality & Retention'),
    (8, 'Valuation & Fund Return')
) as cards(ordinal, title)
on conflict (id) do nothing;

insert into public.framework_packs (
  id, version, title, synthetic, publication_status
) values (
  'framework_pack_synthetic_universal_saas_ai_v1',
  '1',
  'Synthetic universal SaaS and Enterprise AI evaluation fixtures',
  true,
  'published'
) on conflict (id) do nothing;

insert into public.framework_pack_cards (
  framework_pack_id, framework_card_id, position
)
select
  'framework_pack_synthetic_universal_saas_ai_v1',
  'framework_card_synthetic_' || ordinal || '_v1',
  ordinal
from generate_series(1, 8) as series(ordinal)
on conflict (framework_pack_id, framework_card_id) do nothing;

insert into public.underwriting_contexts (
  id, context_version, stage, business_model, supported_geographies,
  security_type, critical_evidence_profile_id, us_benchmark_pack_id,
  us_benchmark_compatibility, global_benchmark_compatibility,
  valuation_method_policy_id, decision_policy_id, framework_pack_id,
  publication_status
)
select
  'underwriting_context_' || stage || '_' || business_model || '_v1',
  '1',
  stage,
  business_model,
  jsonb_build_array('us', 'global'),
  'preferred',
  'critical_evidence_' || stage || '_' || business_model || '_v1',
  'benchmark_pack_synthetic_us_software_v1',
  case when business_model = 'b2b_saas'
    then 'exact' else 'broad_compatible' end,
  'unavailable',
  'valuation_method_' || stage || '_' || business_model || '_v1',
  'decision_policy_' || stage || '_' || business_model || '_v1',
  'framework_pack_synthetic_universal_saas_ai_v1',
  'published'
from (
  values
    ('seed', 'b2b_saas'),
    ('seed', 'enterprise_ai'),
    ('series_a', 'b2b_saas'),
    ('series_a', 'enterprise_ai')
) as contexts(stage, business_model)
on conflict (id) do nothing;

alter table public.fund_policy_versions enable row level security;
alter table public.workspace_active_fund_policies enable row level security;

grant usage on schema public to vsee_registry_owner;
grant select, insert on public.fund_policy_versions
  to vsee_registry_owner;
grant select, insert, update on public.workspace_active_fund_policies
  to vsee_registry_owner;

create policy fund_policy_versions_registry_owner
  on public.fund_policy_versions for all to vsee_registry_owner
  using (true) with check (true);
create policy active_fund_policy_registry_owner
  on public.workspace_active_fund_policies for all to vsee_registry_owner
  using (true) with check (true);

alter function public.activate_fund_policy_version(jsonb)
  owner to vsee_registry_owner;
alter function public.balanced_fund_policy_values()
  owner to vsee_registry_owner;

revoke all privileges on table public.benchmark_packs from public;
revoke all privileges on table public.benchmark_entries from public;
revoke all privileges on table public.fund_policy_versions from public;
revoke all privileges on table public.workspace_active_fund_policies
  from public;
revoke all privileges on table public.underwriting_contexts from public;
revoke all privileges on table public.critical_evidence_profiles from public;
revoke all privileges on table public.valuation_method_policies from public;
revoke all privileges on table public.decision_policies from public;
revoke all privileges on table public.framework_sources from public;
revoke all privileges on table public.framework_cards from public;
revoke all privileges on table public.framework_packs from public;
revoke all privileges on table public.framework_pack_cards from public;
revoke all on function public.activate_fund_policy_version(jsonb) from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname from pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    execute format(
      'revoke all privileges on table public.benchmark_packs, public.benchmark_entries, public.fund_policy_versions, public.workspace_active_fund_policies, public.underwriting_contexts, public.critical_evidence_profiles, public.valuation_method_policies, public.decision_policies, public.framework_sources, public.framework_cards, public.framework_packs, public.framework_pack_cards from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.activate_fund_policy_version(jsonb) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    revoke all privileges on table public.benchmark_packs from service_role;
    revoke all privileges on table public.benchmark_entries from service_role;
    revoke all privileges on table public.fund_policy_versions
      from service_role;
    revoke all privileges on table public.workspace_active_fund_policies
      from service_role;
    revoke all privileges on table public.underwriting_contexts
      from service_role;
    revoke all privileges on table public.critical_evidence_profiles
      from service_role;
    revoke all privileges on table public.valuation_method_policies
      from service_role;
    revoke all privileges on table public.decision_policies
      from service_role;
    revoke all privileges on table public.framework_sources from service_role;
    revoke all privileges on table public.framework_cards from service_role;
    revoke all privileges on table public.framework_packs from service_role;
    revoke all privileges on table public.framework_pack_cards
      from service_role;

    grant select on table public.benchmark_packs to service_role;
    grant select on table public.benchmark_entries to service_role;
    grant select on table public.fund_policy_versions to service_role;
    grant select on table public.workspace_active_fund_policies
      to service_role;
    grant select on table public.underwriting_contexts to service_role;
    grant select on table public.critical_evidence_profiles to service_role;
    grant select on table public.valuation_method_policies to service_role;
    grant select on table public.decision_policies to service_role;
    grant select on table public.framework_cards to service_role;
    grant select on table public.framework_packs to service_role;
    grant select on table public.framework_pack_cards to service_role;
    grant execute on function public.activate_fund_policy_version(jsonb)
      to service_role;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
