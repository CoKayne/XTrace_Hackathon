begin;

set local transaction isolation level read committed;

do $underwriting_owner_prepare$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_underwriting_owner'
      and not rolsuper and not rolinherit and not rolcreaterole
      and not rolcreatedb and not rolcanlogin and not rolreplication
      and not rolbypassrls
  ) or exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_underwriting_owner'::pg_catalog.regrole
      or membership.member = 'vsee_underwriting_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid =
        'vsee_underwriting_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception 'vsee_underwriting_owner is not in its attested state';
  end if;
  if not executor_is_superuser then
    if not exists (
      select 1 from pg_catalog.pg_auth_members as membership
      where membership.roleid =
          'vsee_underwriting_owner'::pg_catalog.regrole
        and membership.member = (
          select oid from pg_catalog.pg_roles where rolname = executor_role
        )
        and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
        and not membership.inherit_option and not membership.set_option
    ) then
      raise exception 'The migration executor lacks the attested underwriting-owner administration grant';
    end if;
    execute pg_catalog.format(
      'grant vsee_underwriting_owner to %I with admin false, inherit true, set true',
      executor_role
    );
  end if;
end;
$underwriting_owner_prepare$;

grant create on schema public to vsee_underwriting_owner;

lock table
  public.action_drafts,
  public.scan_runs,
  public.uploaded_documents
in access exclusive mode;

do $maintenance_quiescence$
begin
  if exists (
    select 1
    from public.scan_runs
    where status in ('queued', 'running')
      or lease_expires_at is not null
  ) or exists (
    select 1
    from public.uploaded_documents
    where status in ('extracting', 'ingesting_memory')
      or lease_expires_at is not null
  ) then
    raise exception
      'Active scans or upload leases remain; production migration requires a maintenance window'
      using errcode = '55006';
  end if;
end;
$maintenance_quiescence$;

create unique index if not exists action_drafts_workspace_artifact_unique
on public.action_drafts (workspace_id, artifact_id);

create or replace function public.reject_immutable_underwriting_artifact()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and tg_table_name = 'action_drafts'
    and new.workspace_id = old.workspace_id
    and new.candidate_run_id = old.candidate_run_id
    and new.artifact_id = old.artifact_id
    and new.created_at = old.created_at
    and (new.payload - 'body' - 'updatedAt')
      = (old.payload - 'body' - 'updatedAt')
    and new.payload ->> 'id' = new.artifact_id
    and new.payload ->> 'workspaceId' = new.workspace_id
    and new.payload ->> 'candidateRunId' = new.candidate_run_id
    and btrim(coalesce(new.payload ->> 'body', '')) <> ''
    and char_length(new.payload ->> 'body') <= 100000
    and new.payload ->> 'createdAt' = old.payload ->> 'createdAt'
    and nullif(new.payload ->> 'updatedAt', '') is not null
    and (new.payload ->> 'updatedAt')::timestamptz
      >= (old.payload ->> 'updatedAt')::timestamptz
  then
    return new;
  end if;
  raise exception '% is immutable after candidate finalization', tg_table_name;
end;
$$;

create or replace function public.replace_action_draft_body(
  p_workspace_id text,
  p_draft_id text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.action_drafts%rowtype;
  next_payload jsonb;
begin
  if btrim(coalesce(p_workspace_id, '')) = ''
    or btrim(coalesce(p_draft_id, '')) = ''
  then
    raise exception 'A complete action draft identity is required';
  end if;
  if btrim(coalesce(p_body, '')) = ''
    or char_length(p_body) > 100000
  then
    raise exception
      'An action draft body must contain text and be at most 100000 characters';
  end if;

  select draft.*
  into target
  from public.action_drafts as draft
  where draft.workspace_id = p_workspace_id
    and draft.artifact_id = p_draft_id
  for update;

  if not found then
    return null;
  end if;
  if target.payload ->> 'id' <> target.artifact_id
    or target.payload ->> 'workspaceId' <> target.workspace_id
    or target.payload ->> 'candidateRunId' <> target.candidate_run_id
  then
    raise exception 'The persisted action draft identity is inconsistent';
  end if;

  next_payload := target.payload || jsonb_build_object(
    'body', p_body,
    'updatedAt',
    public.canonical_utc_iso_milliseconds(pg_catalog.clock_timestamp())
  );

  update public.action_drafts as draft
  set payload = next_payload
  where draft.workspace_id = target.workspace_id
    and draft.candidate_run_id = target.candidate_run_id
    and draft.artifact_id = target.artifact_id;

  return next_payload;
end;
$$;

alter function public.replace_action_draft_body(text, text, text)
  owner to vsee_underwriting_owner;

revoke all on function public.replace_action_draft_body(text, text, text)
  from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname
    from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    execute pg_catalog.format(
      'revoke all on function public.replace_action_draft_body(text, text, text) from %I',
      restricted_role
    );
  end loop;

  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role'
  ) then
    revoke all privileges on table public.action_drafts from service_role;
    grant select on table public.action_drafts to service_role;
    grant execute on function
      public.replace_action_draft_body(text, text, text)
      to service_role;
  end if;
end;
$$;

revoke create on schema public from vsee_underwriting_owner;

do $underwriting_owner_finish$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not executor_is_superuser then
    execute pg_catalog.format(
      'revoke vsee_underwriting_owner from %I granted by %I',
      executor_role,
      executor_role
    );
  end if;
  if exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_underwriting_owner'::pg_catalog.regrole
      or membership.member = 'vsee_underwriting_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid =
        'vsee_underwriting_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception
      'vsee_underwriting_owner did not return to its attested state';
  end if;
end;
$underwriting_owner_finish$;

commit;

notify pgrst, 'reload schema';
