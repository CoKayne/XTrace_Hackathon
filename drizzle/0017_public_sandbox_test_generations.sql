begin;

create table if not exists public.workspace_test_generations (
  workspace_id text primary key
    references public.workspaces(id) on delete cascade,
  reset_at timestamptz not null default now(),
  updated_by text not null,
  constraint workspace_test_generations_updated_by_check
    check (btrim(updated_by) <> '')
);

alter table public.market_events
  add column if not exists observed_at timestamptz not null default now();

create or replace function public.reset_test_view(
  p_workspace_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker timestamptz := clock_timestamp();
begin
  if exists (
    select 1 from public.scan_runs
    where workspace_id = p_workspace_id
      and status in ('queued', 'running')
  ) then
    return jsonb_build_object(
      'reset', false,
      'reason', 'active_scan'
    );
  end if;
  insert into public.workspace_test_generations (
    workspace_id, reset_at, updated_by
  ) values (p_workspace_id, marker, p_actor_id)
  on conflict (workspace_id) do update
    set reset_at = excluded.reset_at,
        updated_by = excluded.updated_by;
  return jsonb_build_object(
    'reset', true,
    'resetAt', public.canonical_utc_iso_milliseconds(marker)
  );
end;
$$;

revoke all on table public.workspace_test_generations from public;
revoke all on table public.workspace_test_generations from anon;
revoke all on table public.workspace_test_generations from authenticated;
grant select on table public.workspace_test_generations to service_role;

revoke all on function public.reset_test_view(text, text) from public;
revoke all on function public.reset_test_view(text, text) from anon;
revoke all on function public.reset_test_view(text, text) from authenticated;
grant execute on function public.reset_test_view(text, text) to service_role;

commit;
