-- JDF Public Safety: training registration and member accounts.
-- NOT APPLIED ANYWHERE YET. Run after db/schema.sql on a Supabase project
-- that belongs to JDF. Uses Supabase Auth (auth.users) for sign-in.
--
-- How access works
--   * Anyone can read the list of training tracks (what JDF teaches).
--   * Only signed-in members can read the schedule (dates, times, seats).
--   * A new account starts as 'pending'. Staff approve it. Only approved
--     members can register.
--   * The venue and address of a session are in a separate table that a
--     member can read ONLY for sessions they hold a confirmed seat in.
--     Creating an account is not enough to learn where a class meets.
--   * Staff (profiles.role = 'staff') can read and manage everything.
--   * Members cannot change their own status or role: there is no update
--     policy on profiles for them, only the update_my_profile() function.

create extension if not exists pgcrypto;

-- ---------- Profiles ------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  status      text not null default 'pending' check (status in ('pending','approved','blocked')),
  role        text not null default 'member'  check (role in ('member','staff')),
  note        text,                       -- staff-only note, e.g. who vouched
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email,
          nullif(new.raw_user_meta_data->>'full_name', ''),
          nullif(new.raw_user_meta_data->>'phone', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'staff');
$$;

create or replace function is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'approved');
$$;

create or replace function update_my_profile(p_full_name text, p_phone text) returns void
language sql security definer set search_path = public as $$
  update profiles set full_name = nullif(trim(p_full_name), ''), phone = nullif(trim(p_phone), '')
  where id = auth.uid();
$$;

-- ---------- Tracks, sessions, locations -----------------------------------
create table if not exists training_tracks (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  audience    text,
  description text,
  sort        integer not null default 0
);

create table if not exists training_sessions (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid not null references training_tracks(id),
  title       text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  capacity    integer not null default 12 check (capacity > 0),
  price_cents integer not null default 0 check (price_cents >= 0),
  status      text not null default 'scheduled' check (status in ('draft','scheduled','cancelled')),
  area        text,                        -- coarse only, e.g. 'Pico-Robertson'. Never an address.
  created_at  timestamptz not null default now()
);
create index if not exists training_sessions_starts_idx on training_sessions (starts_at);

create table if not exists session_locations (
  session_id    uuid primary key references training_sessions(id) on delete cascade,
  venue         text,
  address       text,
  arrival_notes text
);

create table if not exists registrations (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references training_sessions(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  status         text not null default 'confirmed' check (status in ('confirmed','waitlist','cancelled')),
  payment_status text not null default 'not_required' check (payment_status in ('not_required','unpaid','paid','refunded')),
  square_payment_id text,
  created_at     timestamptz not null default now(),
  unique (session_id, user_id)
);

-- ---------- Seat counts and registration (run with definer rights) --------
create or replace function session_availability()
returns table (session_id uuid, taken integer)
language sql stable security definer set search_path = public as $$
  select s.id, count(r.id)::int
  from training_sessions s
  left join registrations r on r.session_id = s.id and r.status = 'confirmed'
  where auth.uid() is not null
  group by s.id;
$$;

create or replace function register_for_session(p_session uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_cap integer; v_price integer; v_taken integer; v_status text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not is_approved() then raise exception 'not_approved'; end if;

  select capacity, price_cents into v_cap, v_price
  from training_sessions
  where id = p_session and status = 'scheduled' and starts_at > now()
  for update;
  if not found then raise exception 'session_unavailable'; end if;

  select count(*) into v_taken from registrations where session_id = p_session and status = 'confirmed';
  v_status := case when v_taken < v_cap then 'confirmed' else 'waitlist' end;

  insert into registrations (session_id, user_id, status, payment_status)
  values (p_session, auth.uid(), v_status, case when v_price > 0 then 'unpaid' else 'not_required' end)
  on conflict (session_id, user_id)
  do update set status = excluded.status, created_at = now()
  where registrations.status = 'cancelled';

  return v_status;
end $$;

create or replace function cancel_registration(p_session uuid) returns void
language sql security definer set search_path = public as $$
  update registrations set status = 'cancelled'
  where session_id = p_session and user_id = auth.uid() and status <> 'cancelled';
$$;

-- ---------- Row level security --------------------------------------------
alter table profiles          enable row level security;
alter table training_tracks   enable row level security;
alter table training_sessions enable row level security;
alter table session_locations enable row level security;
alter table registrations     enable row level security;

create policy profiles_read_own   on profiles for select to authenticated using (id = auth.uid() or is_staff());
create policy profiles_staff_edit on profiles for update to authenticated using (is_staff()) with check (is_staff());

create policy tracks_read_all     on training_tracks for select to anon, authenticated using (true);
create policy tracks_staff_write  on training_tracks for all to authenticated using (is_staff()) with check (is_staff());

create policy sessions_read_members on training_sessions for select to authenticated
  using ((status = 'scheduled' and starts_at > now() - interval '1 day') or is_staff());
create policy sessions_staff_write  on training_sessions for all to authenticated using (is_staff()) with check (is_staff());

create policy locations_read_registered on session_locations for select to authenticated
  using (is_staff() or (is_approved() and exists (
    select 1 from registrations r
    where r.session_id = session_locations.session_id and r.user_id = auth.uid() and r.status = 'confirmed')));
create policy locations_staff_write on session_locations for all to authenticated using (is_staff()) with check (is_staff());

create policy registrations_read_own on registrations for select to authenticated using (user_id = auth.uid() or is_staff());
create policy registrations_staff_write on registrations for all to authenticated using (is_staff()) with check (is_staff());
-- Members insert and cancel only through register_for_session() and cancel_registration().

revoke execute on function register_for_session(uuid), cancel_registration(uuid), session_availability(), update_my_profile(text, text) from anon;

-- ---------- Starting data: the tracks from the training page --------------
insert into training_tracks (slug, name, audience, description, sort) values
  ('self-defense',  'Self-defense',          'Adults',            'Practical skills to protect yourself and your family.', 1),
  ('martial-arts',  'Martial arts',          'Kids and women',    'Dedicated sessions built around each group.',           2),
  ('awareness',     'Awareness',             'Everyone',          'Spotting surveillance and threats early.',               3),
  ('firearms',      'Firearms safety',       'Adults',            'Responsible handling and safety training.',              4),
  ('ongoing',       'Ongoing training',      'Members and JDF personnel', 'Regular sessions led by current and former special forces operators.', 5)
on conflict (slug) do nothing;

-- To make the first staff account, sign up on the site, then run once:
--   update profiles set role = 'staff', status = 'approved', approved_at = now() where email = 'you@example.org';
