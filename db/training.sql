-- JDF Public Safety: training registration and member accounts.
-- NOT APPLIED ANYWHERE YET. Run after db/schema.sql on a Supabase project
-- that belongs to JDF. Uses Supabase Auth (auth.users) for sign-in.
-- Safe to run more than once.
--
-- How access works
--   * Anyone can read the list of training tracks (what JDF teaches).
--   * Only APPROVED members can read the schedule (dates, times, seats).
--   * A new account starts as 'pending'. Staff approve it. Approval only
--     counts once the member has confirmed their email address.
--   * The venue and address of a session are in a separate table that a
--     member can read ONLY for a scheduled session they hold a confirmed
--     seat in. Creating an account is not enough to learn where a class meets.
--   * Blocking a member cancels their seats and removes all access.
--   * Staff (role 'staff' AND status 'approved') can manage everything.
--   * Members cannot change their own status or role: there is no update
--     policy on profiles for them, only the update_my_profile() function.
--
-- Supabase Auth settings this design relies on (set in the dashboard):
--   Confirm email: ON.  Secure email change: ON.  Minimum password length: 10.
--   Custom SMTP (Resend) for auth emails.  CAPTCHA on sign-up recommended.
--   Redirect allow-list: the exact site URLs for /trainings.html and /account.html.

create extension if not exists pgcrypto;

-- ---------- Profiles ------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  status      text not null default 'pending' check (status in ('pending','approved','blocked')),
  role        text not null default 'member'  check (role in ('member','staff')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

-- Staff-only notes about a member (who vouched, concerns). Members can never read these.
create table if not exists profile_notes (
  profile_id uuid primary key references profiles(id) on delete cascade,
  note       text,
  updated_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email,
          left(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 120),
          left(nullif(trim(new.raw_user_meta_data->>'phone'), ''), 40))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Keep the email staff see in step with the address the member actually uses.
create or replace function handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function handle_user_email_change();

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'staff' and status = 'approved');
$$;

create or replace function is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join auth.users u on u.id = p.id
    where p.id = auth.uid() and p.status = 'approved' and u.email_confirmed_at is not null);
$$;

create or replace function update_my_profile(p_full_name text, p_phone text) returns void
language sql security definer set search_path = public as $$
  update profiles
  set full_name = left(nullif(trim(p_full_name), ''), 120), phone = left(nullif(trim(p_phone), ''), 40)
  where id = auth.uid();
$$;

-- Staff view of members, including whether the email address is confirmed.
create or replace function staff_members()
returns table (id uuid, email text, full_name text, phone text, status text, role text, created_at timestamptz, email_confirmed boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, p.phone, p.status, p.role, p.created_at, u.email_confirmed_at is not null
  from profiles p join auth.users u on u.id = p.id
  where is_staff()
  order by p.created_at desc;
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
  notified_at    timestamptz,              -- set when the confirmation email is claimed, so it sends once
  created_at     timestamptz not null default now(),
  unique (session_id, user_id)
);

-- Blocking a member cancels every seat they hold.
create or replace function on_profile_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'blocked' and old.status <> 'blocked' then
    update registrations set status = 'cancelled' where user_id = new.id and status <> 'cancelled';
  end if;
  return new;
end $$;

drop trigger if exists profiles_blocked on profiles;
create trigger profiles_blocked after update of status on profiles
  for each row execute function on_profile_blocked();

-- ---------- Seat counts and registration (run with definer rights) --------
create or replace function session_availability()
returns table (session_id uuid, taken integer)
language sql stable security definer set search_path = public as $$
  select s.id, count(r.id)::int
  from training_sessions s
  left join registrations r on r.session_id = s.id and r.status = 'confirmed'
  where is_approved() and s.status = 'scheduled' and s.starts_at > now() - interval '1 day'
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
  on conflict (session_id, user_id) do update
    set status = excluded.status,
        payment_status = case when registrations.payment_status = 'paid' then 'paid' else excluded.payment_status end,
        notified_at = null,
        created_at = case when registrations.status = 'cancelled' then now() else registrations.created_at end
    where registrations.status in ('cancelled','waitlist')
  returning status into v_status;

  if not found then   -- already confirmed: report the truth, change nothing
    select status into v_status from registrations where session_id = p_session and user_id = auth.uid();
  end if;
  return v_status;
end $$;

-- Cancelling frees a seat and promotes the member who has waited longest.
create or replace function cancel_registration(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_was text; v_cap integer; v_taken integer;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select capacity into v_cap from training_sessions where id = p_session for update;
  if not found then return; end if;

  select status into v_was from registrations where session_id = p_session and user_id = auth.uid();
  if v_was is null or v_was = 'cancelled' then return; end if;
  update registrations set status = 'cancelled' where session_id = p_session and user_id = auth.uid();

  select count(*) into v_taken from registrations where session_id = p_session and status = 'confirmed';
  if v_was = 'confirmed' and v_taken < v_cap then
    update registrations set status = 'confirmed', notified_at = null
    where id = (
      select r.id from registrations r join profiles p on p.id = r.user_id
      where r.session_id = p_session and r.status = 'waitlist' and p.status = 'approved'
      order by r.created_at limit 1);
  end if;
end $$;

-- ---------- Row level security --------------------------------------------
alter table profiles          enable row level security;
alter table profile_notes     enable row level security;
alter table training_tracks   enable row level security;
alter table training_sessions enable row level security;
alter table session_locations enable row level security;
alter table registrations     enable row level security;

drop policy if exists profiles_read_own   on profiles;
drop policy if exists profiles_staff_edit on profiles;
create policy profiles_read_own   on profiles for select to authenticated using (id = auth.uid() or is_staff());
create policy profiles_staff_edit on profiles for update to authenticated using (is_staff()) with check (is_staff());

drop policy if exists notes_staff on profile_notes;
create policy notes_staff on profile_notes for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists tracks_read_all    on training_tracks;
drop policy if exists tracks_staff_write on training_tracks;
create policy tracks_read_all    on training_tracks for select to anon, authenticated using (true);
create policy tracks_staff_write on training_tracks for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists sessions_read_members on training_sessions;
drop policy if exists sessions_staff_write  on training_sessions;
create policy sessions_read_members on training_sessions for select to authenticated
  using (is_staff() or (is_approved() and status = 'scheduled' and starts_at > now() - interval '1 day'));
create policy sessions_staff_write  on training_sessions for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists locations_read_registered on session_locations;
drop policy if exists locations_staff_write     on session_locations;
create policy locations_read_registered on session_locations for select to authenticated
  using (is_staff() or (is_approved() and exists (
    select 1 from registrations r join training_sessions s on s.id = r.session_id
    where r.session_id = session_locations.session_id and r.user_id = auth.uid()
      and r.status = 'confirmed' and s.status = 'scheduled' and s.starts_at > now() - interval '1 day')));
create policy locations_staff_write on session_locations for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists registrations_read_own    on registrations;
drop policy if exists registrations_staff_write on registrations;
create policy registrations_read_own    on registrations for select to authenticated using (user_id = auth.uid() or is_staff());
create policy registrations_staff_write on registrations for all to authenticated using (is_staff()) with check (is_staff());
-- Members insert and cancel only through register_for_session() and cancel_registration().

-- ---------- Grants: nothing is callable or readable by default -------------
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
grant execute on function is_staff(), is_approved(), session_availability(), staff_members(),
  register_for_session(uuid), cancel_registration(uuid), update_my_profile(text, text) to authenticated;
revoke execute on function handle_new_user(), handle_user_email_change(), on_profile_blocked() from authenticated;

revoke all on profiles, profile_notes, training_sessions, session_locations, registrations from anon;
grant select on training_tracks to anon;

-- ---------- Starting data: the tracks from the training page --------------
insert into training_tracks (slug, name, audience, description, sort) values
  ('self-defense',  'Self-defense',          'Adults',            'Practical skills to protect yourself and your family.', 1),
  ('martial-arts',  'Martial arts',          'Kids and women',    'Dedicated sessions built around each group.',           2),
  ('awareness',     'Awareness',             'Everyone',          'Spotting surveillance and threats early.',               3),
  ('firearms',      'Firearms safety',       'Adults',            'Responsible handling and safety training.',              4),
  ('ongoing',       'Ongoing training',      'Members and JDF personnel', 'Regular sessions led by current and former special forces operators.', 5)
on conflict (slug) do nothing;

-- To make the first staff account, sign up on the site, confirm the email, then run once:
--   update profiles set role = 'staff', status = 'approved', approved_at = now() where email = 'you@example.org';
