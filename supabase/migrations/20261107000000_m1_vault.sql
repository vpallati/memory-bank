begin;

create extension if not exists supabase_vault with schema vault;
revoke all on schema vault from public, anon, authenticated;
revoke all on all tables in schema vault from public, anon, authenticated;

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('fact', 'episode', 'preference', 'idea')),
  topic text not null check (length(btrim(topic)) between 1 and 100),
  text text not null check (length(btrim(text)) between 1 and 20000),
  source text not null check (length(btrim(source)) between 1 and 2000),
  confidence integer not null check (confidence between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_by uuid,
  unique (id, user_id),
  check (superseded_by is distinct from id),
  foreign key (superseded_by, user_id) references public.memories(id, user_id)
    deferrable initially deferred
);
create index memories_owner_created on public.memories(user_id, created_at, id);
create index memories_owner_successor on public.memories(user_id, superseded_by);

create table public.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (length(btrim(agent)) between 1 and 200),
  topics text[] not null check (cardinality(topics) > 0 and array_position(topics, null) is null),
  depth text not null check (depth in ('summary', 'verbatim')),
  duration text not null check (duration in ('one-time', 'session', 'standing')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  revoked_at timestamptz,
  uses bigint not null default 0 check (uses >= 0),
  unique (id, user_id),
  check (duration = 'standing' or expires_at is not null)
);
create index grants_owner on public.grants(user_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null,
  grant_id uuid,
  -- Operation labels only in M1: never memory text, provenance, or raw queries.
  query text not null,
  result_count integer not null check (result_count >= 0),
  outcome text not null check (outcome in ('allowed', 'denied', 'import')),
  created_at timestamptz not null default now(),
  foreign key (grant_id, user_id) references public.grants(id, user_id)
);
create index audit_owner_created on public.audit_log(user_id, created_at, id);

create table public.connector_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (length(btrim(source)) between 1 and 100),
  -- Vault stores encrypted secrets; no plaintext OAuth token column exists here.
  access_token_secret_id uuid references vault.secrets(id),
  refresh_token_secret_id uuid references vault.secrets(id),
  last_sync_cursor text,
  sync_status text not null default 'idle'
    check (sync_status in ('idle', 'syncing', 'error')),
  primary key (user_id, source)
);

alter table public.memories enable row level security;
alter table public.grants enable row level security;
alter table public.audit_log enable row level security;
alter table public.connector_state enable row level security;

create policy memories_owner_read on public.memories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy grants_owner_read on public.grants for select to authenticated
  using ((select auth.uid()) = user_id);
create policy audit_owner_read on public.audit_log for select to authenticated
  using ((select auth.uid()) = user_id);
-- Connector state is server-only, including ciphertext references and cursors.
-- No policy means deny by default, even for an authenticated owner.

revoke all on public.memories, public.grants, public.audit_log, public.connector_state
  from public, anon, authenticated, service_role;
grant select on public.memories, public.audit_log to authenticated;
grant select (id, user_id, agent, topics, depth, duration, expires_at, revoked_at, uses)
  on public.grants to authenticated;

create function public.create_memory(
  p_type text, p_topic text, p_text text, p_source text, p_confidence integer
) returns public.memories
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved public.memories;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.memories (user_id, type, topic, text, source, confidence)
    values (owner_id, p_type, p_topic, p_text, p_source, p_confidence) returning * into saved;
  insert into public.audit_log (user_id, agent, query, result_count, outcome)
    values (owner_id, 'owner', 'memory.create', 1, 'allowed');
  return saved;
end;
$$;

create function public.revise_memory(
  p_id uuid, p_type text, p_topic text, p_text text, p_source text, p_confidence integer
) returns public.memories
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  original public.memories;
  saved public.memories;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Serialize revisions and deletion of a user's chains, including stale revisions.
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  select * into original from public.memories where id = p_id and user_id = owner_id;
  if not found then raise exception 'Memory not found' using errcode = 'P0002'; end if;
  if original.superseded_by is not null then
    raise exception 'Memory has a newer revision; reload before editing' using errcode = 'PT409';
  end if;
  insert into public.memories (user_id, type, topic, text, source, confidence)
    values (owner_id, p_type, p_topic, p_text, p_source, p_confidence) returning * into saved;
  update public.memories set superseded_by = saved.id, updated_at = now()
    where id = p_id and user_id = owner_id;
  insert into public.audit_log (user_id, agent, query, result_count, outcome)
    values (owner_id, 'owner', 'memory.revise', 1, 'allowed');
  return saved;
end;
$$;

create function public.delete_memory(p_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  removed integer;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  with recursive lineage as (
    select id, superseded_by from public.memories where id = p_id and user_id = owner_id
    union
    select m.id, m.superseded_by from public.memories m
      join lineage l on m.superseded_by = l.id or m.id = l.superseded_by
      where m.user_id = owner_id
  )
  delete from public.memories where user_id = owner_id and id in (select id from lineage);
  get diagnostics removed = row_count;
  if removed = 0 then raise exception 'Memory not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (user_id, agent, query, result_count, outcome)
    values (owner_id, 'owner', 'memory.delete', removed, 'allowed');
  return removed;
end;
$$;

-- One statement/snapshot; aggregation avoids the REST API's row pagination cap.
create function public.export_vault() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'app', 'memory-bank',
    'version', 'v1',
    'exported_at', now(),
    'note', 'Owner vault including revision history. Grant tokens are never exported.',
    'memories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'topic', topic, 'type', initcap(type), 'text', text,
        'source', source, 'when', created_at, 'conf', confidence,
        'created_at', created_at, 'updated_at', updated_at, 'superseded_by', superseded_by
      ) order by created_at, id) from public.memories
    ), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'agent', agent, 'topics', topics,
        'depth', initcap(depth),
        'duration', case duration when 'one-time' then 'One-time' when 'session' then 'Session'
          else case when expires_at is null then 'Permanent' else 'Standing' end end,
        'expires_at', expires_at, 'revoked_at', revoked_at, 'uses', uses,
        'active', revoked_at is null and (expires_at is null or expires_at > now())
          and (duration <> 'one-time' or uses = 0)
      ) order by id) from public.grants
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'agent', agent, 'grant_id', grant_id,
        'query', query, 'result_count', result_count, 'outcome', outcome, 'created_at', created_at,
        'kind', outcome, 'event', query,
        'meta', jsonb_build_object('agent', agent, 'grant_id', grant_id, 'result_count', result_count)::text,
        'time', created_at
      ) order by created_at, id) from public.audit_log
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.create_memory(text, text, text, text, integer),
  public.revise_memory(uuid, text, text, text, text, integer),
  public.delete_memory(uuid), public.export_vault()
  from public, anon, authenticated, service_role;
grant execute on function public.create_memory(text, text, text, text, integer),
  public.revise_memory(uuid, text, text, text, text, integer),
  public.delete_memory(uuid), public.export_vault() to authenticated;

commit;
