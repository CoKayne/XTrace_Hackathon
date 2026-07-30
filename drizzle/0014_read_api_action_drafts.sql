begin;

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

commit;

notify pgrst, 'reload schema';
