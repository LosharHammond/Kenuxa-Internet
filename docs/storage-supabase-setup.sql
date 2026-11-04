-- REVIEWED SETUP TEMPLATE ONLY. Not executed by startup, tests, or this delivery.
-- Apply only to an authorized isolated/new database after reviewing existing objects.
create table if not exists public.kenuxa_federated_records (
  namespace text not null,
  record_key text not null,
  payload text not null check (octet_length(payload) <= 131072),
  created_at timestamptz not null default now(),
  primary key (namespace, record_key)
);
alter table public.kenuxa_federated_records enable row level security;
revoke all on public.kenuxa_federated_records from public, anon, authenticated;
grant select, insert on public.kenuxa_federated_records to service_role;
-- No public read/write policy; privileged server credentials only.
-- Immutable inserts use conflict DO NOTHING; no update/delete privilege is required.
