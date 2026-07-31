begin;

do $migration$
declare
  digest_schema text;
begin
  select namespace.nspname
  into strict digest_schema
  from pg_catalog.pg_extension as extension_record
  join pg_catalog.pg_depend as dependency
    on dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    and dependency.refobjid = extension_record.oid
    and dependency.classid = 'pg_catalog.pg_proc'::regclass
    and dependency.deptype = 'e'
  join pg_catalog.pg_proc as procedure_record
    on procedure_record.oid = dependency.objid
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure_record.pronamespace
  where extension_record.extname = 'pgcrypto'
    and procedure_record.proname = 'digest'
    and procedure_record.proargtypes = '17 25'::oidvector;

  execute pg_catalog.format(
    'grant usage on schema %I to vsee_registry_owner',
    digest_schema
  );
end;
$migration$;

commit;
