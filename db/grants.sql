-- JDF Public Safety: table privileges. Run last, after schema, training, founders and square. Safe to re-run.
--
-- The Supabase project was created with "Automatically expose new tables" OFF, so a new table starts with
-- no privileges for any API role. That is deliberate: nothing is reachable until it is granted here.
-- Row level security (policies in schema.sql and training.sql) still decides which ROWS a signed-in member
-- may touch; these grants only decide which roles may reach each table at all.

-- The site's back end (the secret key) reads and writes everything. It bypasses row level security.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- Signed-in members (the publishable key plus their own login). The policies in training.sql limit the rows:
-- members see only their own profile and registrations, and a location only for a seat they hold.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  profiles, profile_notes, training_sessions, session_locations, registrations, training_tracks
  to authenticated;

-- Visitors who are not signed in can read the list of training tracks, nothing else.
grant usage on schema public to anon;
grant select on training_tracks to anon;

-- Everything else (donors, donations, donation_intents, subscribers, subscriptions, concern_reports,
-- contact_messages) is reachable only by the secret key, through the site's own functions.
