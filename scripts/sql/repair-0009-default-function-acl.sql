begin;

set local transaction isolation level read committed;

-- Keep the source-registry data invariant stable while the repair is applied.
lock table
  public.scan_runs,
  public.uploaded_documents,
  public.deals,
  public.source_evidence,
  public.deal_interactions,
  public.deal_source_assignments
in access exclusive mode;

do $repair_preconditions$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
  explicit_defect_count integer;
begin
  if current_setting('server_version_num') <> '170006' then
    raise exception
      'The 0009 default-function ACL repair is pinned to PostgreSQL 17.6';
  end if;

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
      'Active scans or upload leases remain; ACL repair requires a maintenance window'
      using errcode = '55006';
  end if;

  if exists (
    select 1
    from public.deals as deal
    left join lateral (
      select array_agg(
        assignment.source_revision_id
        order by assignment.source_revision_id collate "C"
      ) as revision_ids
      from public.deal_source_assignments as assignment
      where assignment.workspace_id = deal.workspace_id
        and assignment.deal_id = deal.id
        and assignment.superseded_at is null
    ) as active on true
    where (
      (deal.analysis_eligible_at is not null)
        <> (coalesce(cardinality(active.revision_ids), 0) > 0)
    )
      or (
        deal.analysis_eligible_at is not null
        and deal.active_source_revision_fingerprint
          is distinct from
          public.source_revision_set_fingerprint(active.revision_ids)
      )
  ) or exists (
    select 1
    from public.source_evidence
    where document_id is not null
      and source_revision_id is null
  ) or exists (
    select 1
    from public.deal_interactions
    where document_id is not null
      and source_revision_id is null
  ) then
    raise exception
      'The 0009 source-registry data invariant changed before ACL repair';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'vsee_registry_owner'
      and not rolsuper
      and not rolinherit
      and not rolcreaterole
      and not rolcreatedb
      and not rolcanlogin
      and not rolreplication
      and not rolbypassrls
  ) then
    raise exception
      'The attested vsee_registry_owner role is unavailable for ACL repair';
  end if;

  if exists (
    select 1
    from (
      values ('anon'), ('authenticated'), ('service_role')
    ) as expected(role_name)
    where not exists (
      select 1
      from pg_catalog.pg_roles
      where rolname = expected.role_name
    )
  ) then
    raise exception
      'The Supabase API roles required by the reviewed ACL repair are absent';
  end if;

  with expected_grants(role_name, signature) as (
    values
      ('anon',
        'public.canonical_utc_iso_milliseconds(timestamp with time zone)'),
      ('anon', 'public.save_intelligence_report(jsonb,jsonb)'),
      ('anon', 'public.sha256_length_framed(text[])'),
      ('anon',
        'public.source_assignment_result(deals,source_revisions,text[],boolean)'),
      ('anon', 'public.source_revision_set_fingerprint(text[])'),
      ('authenticated',
        'public.canonical_utc_iso_milliseconds(timestamp with time zone)'),
      ('authenticated', 'public.save_intelligence_report(jsonb,jsonb)'),
      ('authenticated', 'public.sha256_length_framed(text[])'),
      ('authenticated',
        'public.source_assignment_result(deals,source_revisions,text[],boolean)'),
      ('authenticated', 'public.source_revision_set_fingerprint(text[])'),
      ('service_role',
        'public.canonical_utc_iso_milliseconds(timestamp with time zone)'),
      ('service_role', 'public.sha256_length_framed(text[])'),
      ('service_role', 'public.source_revision_set_fingerprint(text[])')
  )
  select count(*)
  into explicit_defect_count
  from expected_grants as expected
  join pg_catalog.pg_proc as procedure_record
    on procedure_record.oid = to_regprocedure(expected.signature)
  join pg_catalog.pg_roles as role_record
    on role_record.rolname = expected.role_name
  where exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(procedure_record.proacl, '{}'::aclitem[])
    ) as privilege_record
    where privilege_record.grantee = role_record.oid
      and privilege_record.privilege_type = 'EXECUTE'
      and not privilege_record.is_grantable
  );

  if explicit_defect_count <> 13 then
    raise exception
      'The explicit 0009 default-function ACL defect changed before repair';
  end if;

  select rolsuper
  into executor_is_superuser
  from pg_catalog.pg_roles
  where rolname = executor_role;

  if not executor_is_superuser then
    if not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      where membership.roleid =
          'vsee_registry_owner'::pg_catalog.regrole
        and membership.member = (
          select oid from pg_catalog.pg_roles where rolname = executor_role
        )
        and membership.grantor = 10
        and (
          select rolsuper
          from pg_catalog.pg_roles
          where oid = membership.grantor
        )
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
    ) then
      raise exception
        'The migration executor lacks the attested owner-role administration grant';
    end if;
    execute pg_catalog.format(
      'grant vsee_registry_owner to %I with admin false, inherit true, set true',
      executor_role
    );
  end if;
end;
$repair_preconditions$;

revoke execute on function
  public.canonical_utc_iso_milliseconds(timestamptz)
  from anon, authenticated, service_role;
revoke execute on function public.save_intelligence_report(jsonb, jsonb)
  from anon, authenticated;
revoke execute on function public.sha256_length_framed(text[])
  from anon, authenticated, service_role;
revoke execute on function public.source_assignment_result(
  public.deals, public.source_revisions, text[], boolean
) from anon, authenticated;
revoke execute on function public.source_revision_set_fingerprint(text[])
  from anon, authenticated, service_role;

do $repair_postconditions$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper
  into executor_is_superuser
  from pg_catalog.pg_roles
  where rolname = executor_role;

  if not executor_is_superuser then
    execute pg_catalog.format(
      'revoke vsee_registry_owner from %I granted by %I',
      executor_role,
      executor_role
    );
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles as role_record
    cross join lateral (
      values
        ('public.canonical_utc_iso_milliseconds(timestamp with time zone)'),
        ('public.save_intelligence_report(jsonb,jsonb)'),
        ('public.sha256_length_framed(text[])'),
        ('public.source_assignment_result(deals,source_revisions,text[],boolean)'),
        ('public.source_revision_set_fingerprint(text[])')
    ) as target(signature)
    join pg_catalog.pg_proc as procedure_record
      on procedure_record.oid = to_regprocedure(target.signature)
    where role_record.rolname in ('anon', 'authenticated')
      and exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(procedure_record.proacl, '{}'::aclitem[])
        ) as privilege_record
        where privilege_record.grantee = role_record.oid
          and privilege_record.privilege_type = 'EXECUTE'
      )
  ) or exists (
    select 1
    from (
      values
        ('public.canonical_utc_iso_milliseconds(timestamp with time zone)'),
        ('public.sha256_length_framed(text[])'),
        ('public.source_revision_set_fingerprint(text[])')
    ) as target(signature)
    join pg_catalog.pg_proc as procedure_record
      on procedure_record.oid = to_regprocedure(target.signature)
    where exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(procedure_record.proacl, '{}'::aclitem[])
      ) as privilege_record
      where privilege_record.grantee = (
        select oid from pg_catalog.pg_roles where rolname = 'service_role'
      )
        and privilege_record.privilege_type = 'EXECUTE'
    )
  ) then
    raise exception
      'The 0009 default-function ACL repair did not remove every explicit grant';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.canonical_utc_iso_milliseconds(timestamp with time zone)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_intelligence_report(jsonb,jsonb)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.canonical_utc_iso_milliseconds(timestamp with time zone)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_intelligence_report(jsonb,jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.source_assignment_result(deals,source_revisions,text[],boolean)',
    'EXECUTE'
  ) then
    raise exception
      'The effective 0009 function privilege contract is not satisfied';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      or membership.member = 'vsee_registry_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (
        select rolsuper
        from pg_catalog.pg_roles
        where oid = membership.grantor
      )
      and membership.admin_option
      and not membership.inherit_option
      and not membership.set_option
    )
  ) then
    raise exception
      'vsee_registry_owner did not return to its attested isolated state';
  end if;
end;
$repair_postconditions$;

commit;

notify pgrst, 'reload schema';
