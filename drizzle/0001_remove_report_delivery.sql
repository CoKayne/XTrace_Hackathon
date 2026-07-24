begin;
drop function if exists public.claim_report_delivery(text, text);
alter table public.intelligence_reports drop column if exists delivery;
commit;
