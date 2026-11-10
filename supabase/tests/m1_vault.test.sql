begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

insert into public.grants (user_id, agent, topics, depth, duration, token_hash, expires_at, revoked_at, uses)
values
  ('00000000-0000-4000-8000-000000000001', 'Synthetic active agent', array['Work'], 'summary', 'standing', repeat('a', 64), null, null, 0),
  ('00000000-0000-4000-8000-000000000001', 'Synthetic expired agent', array['Work'], 'verbatim', 'session', repeat('b', 64), now() - interval '1 minute', null, 0),
  ('00000000-0000-4000-8000-000000000001', 'Synthetic revoked agent', array['Work'], 'summary', 'standing', repeat('c', 64), null, now(), 0),
  ('00000000-0000-4000-8000-000000000001', 'Synthetic used agent', array['Work'], 'summary', 'one-time', repeat('d', 64), now() + interval '1 hour', null, 1),
  ('00000000-0000-4000-8000-000000000002', 'Other synthetic agent', array['Family'], 'summary', 'standing', repeat('e', 64), null, null, 0);

insert into public.connector_state (user_id, source, access_token_secret_id)
values ('00000000-0000-4000-8000-000000000001', 'synthetic', vault.create_secret('fictional-test-value-not-a-token'));

select ok((select secret <> 'fictional-test-value-not-a-token' from vault.secrets
  where id = (select access_token_secret_id from public.connector_state where source = 'synthetic')),
  'connector secret is encrypted at rest');
select is((select count(*)::integer from information_schema.columns
  where table_schema = 'public' and table_name = 'grants' and column_name = 'token'), 0,
  'no raw grant token column');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('memories', 'grants', 'audit_log', 'connector_state') and c.relrowsecurity), 4,
  'all four tables have RLS');
select throws_ok($$insert into public.grants (user_id, agent, topics, depth, duration, token_hash)
  values ('00000000-0000-4000-8000-000000000001', 'invalid', array['Work'], 'summary', 'standing', 'plaintext')$$,
  '23514', null, 'raw token values fail hash format constraint');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(id)::integer from public.grants), 4, 'owner only sees own grants');
select throws_ok('select token_hash from public.grants', '42501', null, 'owner cannot read token hashes');
select throws_ok('select * from public.connector_state', '42501', null, 'connector state is not exposed');
select throws_ok('select * from vault.decrypted_secrets', '42501', null, 'owner cannot decrypt OAuth secrets');
select throws_ok('select vault.create_secret(''nope'')', '42501', null, 'owner cannot invoke Vault writes');
select is(jsonb_array_length(public.export_vault()->'grants'), 4, 'export isolates grants by owner');
select is((select count(*)::integer from jsonb_array_elements(public.export_vault()->'grants') g
  where (g->>'active')::boolean), 1, 'expired revoked and consumed grants export as inactive');
select ok(not exists (select 1 from jsonb_array_elements(public.export_vault()->'grants') g
  where g ? 'token' or g ? 'token_hash'), 'export never includes raw token or hash fields');

select throws_ok($$select public.create_memory('bad', 'Work', 'Synthetic', 'Manual', 90)$$,
  '23514', null, 'invalid memory type fails at database boundary');
select throws_ok($$select public.create_memory('fact', ' ', 'Synthetic', 'Manual', 90)$$,
  '23514', null, 'blank topic fails at database boundary');
select throws_ok($$select public.create_memory('fact', 'Work', 'Synthetic', '', 90)$$,
  '23514', null, 'provenance is mandatory');
select throws_ok($$select public.create_memory('fact', 'Work', 'Synthetic', 'Manual', 101)$$,
  '23514', null, 'confidence upper bound enforced');
select throws_ok($$select public.create_memory('fact', 'Work', 'Synthetic', 'Manual', -1)$$,
  '23514', null, 'confidence lower bound enforced');
select is((select count(*)::integer from public.audit_log), 0, 'failed writes do not leave success audit records');

select lives_ok($$select public.create_memory('idea', 'Ideas', 'Synthetic boundary fixture', 'Manual', 0)$$,
  'zero confidence accepted');
select lives_ok($$select public.create_memory('preference', 'Work', 'Synthetic boundary fixture', 'Manual', 100)$$,
  '100 confidence accepted');
select is((select count(*)::integer from public.memories), 2, 'owner reads both created memories');
select is((select count(*)::integer from public.audit_log), 2, 'successful writes append audit records');
select throws_ok('update public.audit_log set query = ''tampered''', '42501', null, 'audit cannot be updated');
select throws_ok('delete from public.audit_log', '42501', null, 'audit cannot be deleted');
select throws_ok('delete from public.grants', '42501', null, 'grant writes are reserved for later server implementation');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::integer from public.memories), 0, 'other user cannot read memories');
select is((select count(*)::integer from public.audit_log), 0, 'other user cannot read audit');
select is(jsonb_array_length(public.export_vault()->'memories'), 0, 'other user export has no memories');

set local role anon;
set local request.jwt.claims = '{}';
select throws_ok('select * from public.memories', '42501', null, 'anonymous cannot read memories');
select throws_ok('select public.export_vault()', '42501', null, 'anonymous cannot export');
select throws_ok($$select public.create_memory('fact', 'Work', 'Synthetic', 'Manual', 90)$$,
  '42501', null, 'anonymous cannot create');
set local role authenticated;
select throws_ok($$select public.create_memory('fact', 'Work', 'Synthetic', 'Manual', 90)$$,
  '42501', null, 'write RPC also rejects a missing user identity');

select * from finish();
rollback;
