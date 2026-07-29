begin;

-- User uploads are staged outside the fixed corpus and do not become Deals or
-- XTrace memory until an explicit confirmation flow assigns them later.

create table if not exists public.uploaded_documents (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  filename text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size > 0),
  checksum text not null,
  object_key text not null,
  status text not null default 'queued' check (
    status in (
      'queued', 'extracting', 'awaiting_confirmation', 'confirmed',
      'ingesting_memory', 'ready', 'failed'
    )
  ),
  failure_reason text,
  extraction_preview jsonb,
  lease_expires_at timestamptz,
  worker_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, checksum)
);

create index if not exists uploaded_documents_workspace_created
  on public.uploaded_documents (workspace_id, created_at desc);

create index if not exists uploaded_documents_claimable
  on public.uploaded_documents (status, lease_expires_at);

alter table public.uploaded_documents enable row level security;
revoke all privileges on table public.uploaded_documents from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname from pg_roles where rolname in ('anon', 'authenticated')
  loop
    execute format(
      'revoke all privileges on table public.uploaded_documents from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all privileges on table public.uploaded_documents to service_role;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
