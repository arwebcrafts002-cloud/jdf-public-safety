-- JDF Public Safety: giving levels, thank-you items and the Founders Club.
-- NOT APPLIED ANYWHERE YET. Run once, after db/schema.sql.
--
-- What this adds
--   * On donation_intents (what the donor typed before paying) and on
--     donations (what Square confirms was paid): the giving level, whether the
--     donor declined items, shirt size, shipping address, Founders Wall name.
--   * On donations only: founder_number (1 to 20, each used once),
--     fulfilment_status and shipped_at.
--   * assign_founder_number(): gives a completed founder-level gift the next
--     free seat. A seat exists only after payment. Nothing here, and nothing
--     on the site, holds a seat for a pledge.
--
-- Levels are placeholders pending approval: friend $180, supporter $360,
-- guardian $618, shield $1,800, founder $3,600 and up (first 20 only).
-- Until this file is run, api/intake.js stores gifts without these columns.

alter table donation_intents
  add column if not exists tier              text check (tier in ('friend','supporter','guardian','shield','founder')),
  add column if not exists merch_opt_out     boolean not null default true,
  add column if not exists shirt_size        text check (shirt_size in ('XS','S','M','L','XL','2XL','3XL')),
  add column if not exists ship_name         text,
  add column if not exists ship_address1     text,
  add column if not exists ship_address2     text,
  add column if not exists ship_city         text,
  add column if not exists ship_state        text check (ship_state ~ '^[A-Z]{2}$'),
  add column if not exists ship_postal       text,
  add column if not exists wall_display_name text;

alter table donations
  add column if not exists tier              text check (tier in ('friend','supporter','guardian','shield','founder')),
  add column if not exists merch_opt_out     boolean not null default true,
  add column if not exists shirt_size        text check (shirt_size in ('XS','S','M','L','XL','2XL','3XL')),
  add column if not exists ship_name         text,
  add column if not exists ship_address1     text,
  add column if not exists ship_address2     text,
  add column if not exists ship_city         text,
  add column if not exists ship_state        text check (ship_state ~ '^[A-Z]{2}$'),
  add column if not exists ship_postal       text,
  add column if not exists wall_display_name text,
  add column if not exists founder_number    integer check (founder_number between 1 and 20),
  add column if not exists fulfilment_status text not null default 'none'
                                             check (fulfilment_status in ('none','pending','ordered','shipped','delivered')),
  add column if not exists shipped_at        timestamptz;

-- Each seat number can be used once. Rows without a number are not affected.
create unique index if not exists donations_founder_number_key
  on donations (founder_number) where founder_number is not null;

-- Give a paid founder-level gift the next free seat.
-- Returns the seat number, the existing number if the gift already has one,
-- or null when the gift does not qualify or all 20 seats are taken.
-- The advisory lock makes two gifts completing at the same moment take turns,
-- so they cannot be handed the same number; the unique index is the backstop.
create or replace function assign_founder_number(p_donation uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_existing integer;
  v_next     integer;
begin
  perform pg_advisory_xact_lock(hashtext('jdf_founder_number'));

  select founder_number into v_existing
  from donations
  where id = p_donation
    and status = 'completed'
    and frequency = 'once'
    and amount_cents >= 360000
  for update;

  if not found then return null; end if;          -- not paid, not one-time, or below the founder level
  if v_existing is not null then return v_existing; end if;

  select n into v_next
  from generate_series(1, 20) as n
  where not exists (select 1 from donations d where d.founder_number = n)
  order by n
  limit 1;

  if v_next is null then return null; end if;     -- all 20 seats are taken

  update donations
     set founder_number = v_next,
         tier = 'founder',
         fulfilment_status = case when merch_opt_out then 'none' else 'pending' end
   where id = p_donation;

  return v_next;
end $$;

-- Only the server (service role) may assign seats.
revoke all on function assign_founder_number(uuid) from public;
revoke all on function assign_founder_number(uuid) from anon, authenticated;

-- Seats filled so far. This is the number the site's counter should show in
-- place of FOUNDERS_TAKEN in js/founders.js once the database is live.
create or replace function founders_taken() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from donations where founder_number is not null;
$$;
