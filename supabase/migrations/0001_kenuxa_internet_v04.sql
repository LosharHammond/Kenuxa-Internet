-- KENUXA Internet v0.4 — Supabase schema
-- Safe to run more than once. Additive only: it never drops or rewrites your existing data.
-- Works on a fresh project AND on the existing "INTERNET" project that already holds the
-- original v1.1 Semantic Graph Entity Schema (entities, relationships, attachments,
-- capabilities, embeddings, resolutions). Those tables are reused; node_id is added so
-- several KENUXA nodes (Render, Railway, Vercel, Netlify, your PC) can share one project.

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;
create extension if not exists vector;

-- ---------- original v1.1 tables (created only when missing) ----------
create table if not exists entities (
  id uuid primary key default uuid_generate_v4(),
  sge_uri text not null unique,
  type text not null check (type in ('Knowledge','Capability','Agent','Organization','Person','Location','Document','Media','Goal','Action','Event','Concept','Custom')),
  label text not null,
  description text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists relationships (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references entities(id) on delete cascade,
  target_id uuid not null references entities(id) on delete cascade,
  type text not null check (type in ('LIVES_IN','REQUIRES','HANDLED_BY','USES','CAN_EXECUTE','BELONGS_TO','CREATED_BY','CONNECTED_TO','DEPENDS_ON','ENABLES','PART_OF','SIMILAR_TO','OPPOSES','PRODUCES','CONSUMES','GOVERNS','OWNED_BY','REFERENCES','LEADS_TO','CUSTOM')),
  weight float not null default 0.8 check (weight >= 0 and weight <= 1),
  confidence float not null default 0.9 check (confidence >= 0 and confidence <= 1),
  label text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  unique (source_id, target_id, type)
);
create table if not exists attachments (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references entities(id) on delete cascade,
  category text not null check (category in ('Evidence','Trust','Context','Metadata','Reasoning','Capability','Media','Version','History','Simulation','Prediction','Custom')),
  key text not null,
  value jsonb not null,
  mime_type text,
  created_at timestamptz not null default now()
);
create table if not exists capabilities (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  description text not null,
  input_schema jsonb,
  output_schema jsonb,
  executor text,
  created_at timestamptz not null default now()
);
create table if not exists embeddings (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references entities(id) on delete cascade unique,
  embedding float[] not null,
  model text not null default 'kenuxa-core',
  created_at timestamptz not null default now()
);
create table if not exists resolutions (
  id uuid primary key default uuid_generate_v4(),
  goal text not null,
  goal_entity_id uuid references entities(id),
  reasoning text,
  entity_ids uuid[] not null default '{}',
  relationship_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- v0.4 additions to the original tables ----------
alter table entities      add column if not exists node_id text;
alter table relationships add column if not exists node_id text;
alter table attachments   add column if not exists node_id text;
alter table capabilities  add column if not exists node_id text;
alter table embeddings    add column if not exists node_id text;
alter table resolutions   add column if not exists node_id text;
alter table embeddings    add column if not exists vec vector;   -- pgvector copy of the KENUXA transformer embedding
create index if not exists entities_node_idx on entities(node_id);
create index if not exists relationships_node_idx on relationships(node_id);

-- ---------- tables the spec requires that v1.1 did not have ----------
create table if not exists outcomes (
  id uuid primary key,
  node_id text,
  type text not null,
  detail text,
  expected jsonb,
  observed jsonb,
  confidence float,
  created_at timestamptz not null default now()
);
create table if not exists agents (
  id uuid primary key,
  node_id text,
  entity_id uuid references entities(id) on delete cascade,
  kind text not null,              -- agent | expert | council-evidence | council-consistency | council-domain
  level text,                      -- basic (atom) | medium (molecule) | advanced (cell)
  specialty text,
  skills jsonb default '[]',
  development_score float default 0,
  dna_revision int default 0,
  updated_at timestamptz not null default now()
);
create table if not exists memory_logs (
  id uuid primary key,
  node_id text,
  kind text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

-- Full-fidelity graph state for each node (source of truth; the tables above are the queryable mirror).
create table if not exists kenuxa_node_state (
  node_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
-- Node registry: nodes that share this project discover one another automatically.
create table if not exists kenuxa_nodes (
  node_id text primary key,
  public_url text,
  platform text,
  protocol text,
  capabilities jsonb default '[]',
  last_seen timestamptz not null default now()
);

-- New tables are server-only: RLS on, no policies → only the service-role/secret key can use them.
alter table outcomes          enable row level security;
alter table agents            enable row level security;
alter table memory_logs       enable row level security;
alter table kenuxa_node_state enable row level security;
alter table kenuxa_nodes      enable row level security;

-- Semantic search over transformer embeddings (same-dimension vectors only).
create or replace function kenuxa_match_entities(query vector, match_count int default 10, only_node text default null)
returns table (entity_id uuid, label text, similarity float)
language sql stable as $$
  select e.id, e.label, 1 - (m.vec <=> query) as similarity
  from embeddings m join entities e on e.id = m.entity_id
  where m.vec is not null and vector_dims(m.vec) = vector_dims(query)
    and (only_node is null or m.node_id = only_node)
  order by m.vec <=> query
  limit match_count;
$$;

-- Private storage bucket for transformer checkpoints (created by the server if absent, too).
insert into storage.buckets (id, name, public) values ('kenuxa', 'kenuxa', false) on conflict (id) do nothing;
