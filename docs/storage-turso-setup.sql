-- REVIEWED SETUP TEMPLATE ONLY. No automatic provisioning/migration.
create table if not exists kenuxa_federated_records (
  namespace text not null,
  record_key text not null,
  payload text not null check (length(cast(payload as blob)) <= 131072),
  primary key(namespace,record_key)
);
