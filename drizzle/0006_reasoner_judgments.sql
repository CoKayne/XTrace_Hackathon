begin;

-- Deterministic replay of matching judgments: one row per unique evidence
-- fingerprint (deal bundles + selected market events + recalled memory +
-- source catalog + prompt + model). Identical evidence replays the stored
-- judgment instead of re-sampling the model, so repeated scans over an
-- unchanged evidence window produce identical reports.

create table if not exists public.reasoner_judgments (
  fingerprint text primary key,
  model text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reasoner_judgments enable row level security;
revoke all privileges on table public.reasoner_judgments from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname
    from pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    execute format(
      'revoke all privileges on table public.reasoner_judgments from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all privileges on table public.reasoner_judgments to service_role;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
