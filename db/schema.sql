-- JDF Public Safety: first-pass database (Postgres / Supabase).
-- NOT APPLIED ANYWHERE YET. Review, then run once against a new project.
--
-- Design notes
--   * The browser never talks to the database. Only /api/intake does, with the
--     service-role key, so every table has row level security ON and no
--     public policies. Staff read through the Supabase dashboard (or a small
--     admin page later).
--   * donation_intents is what the donor typed BEFORE paying. donations is
--     what Square says was actually paid (filled by a Square webhook once
--     API access exists). The two are matched on email + amount + time.
--   * Concern reports can contain sensitive information about real people.
--     Keep access to that table narrow.

create extension if not exists pgcrypto;

create table if not exists donors (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  first_name    text,
  last_name     text,
  phone         text,
  sms_consent   boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists donations (
  id                 uuid primary key default gen_random_uuid(),
  donor_id           uuid references donors(id),
  square_payment_id  text unique,
  amount_cents       integer not null,
  currency           text not null default 'USD',
  frequency          text not null default 'once',
  status             text not null default 'completed',
  is_anonymous       boolean not null default false,
  dedication_type    text,
  dedication_name    text,
  receipt_sent_at    timestamptz,
  paid_at            timestamptz not null default now()
);

create table if not exists donation_intents (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  first_name        text,
  last_name         text,
  email             text not null,
  phone             text,
  amount_cents      integer not null check (amount_cents >= 100),
  frequency         text not null default 'once' check (frequency in ('once','monthly')),
  dedication_type   text check (dedication_type in ('honor','memory')),
  dedication_name   text,
  is_anonymous      boolean not null default false,
  newsletter_opt_in boolean not null default false,
  sms_consent       boolean not null default false,
  page              text,
  user_agent        text,
  matched_donation  uuid references donations(id)
);
create index if not exists donation_intents_email_idx on donation_intents (email, created_at desc);

create table if not exists subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  first_name      text,
  source          text,
  page            text,
  user_agent      text,
  confirmed_at    timestamptz,          -- set when they click the double opt-in link
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists concern_reports (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  reporter_name     text,
  reporter_email    text,
  reporter_phone    text,
  concern_type      text,
  location          text,
  incident_datetime text,
  description       text not null,
  status            text not null default 'new' check (status in ('new','reviewing','escalated','closed')),
  handled_by        text,
  page              text,
  user_agent        text
);

create table if not exists contact_messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text,
  email       text,
  phone       text,
  message     text,
  payload     jsonb,
  page        text,
  user_agent  text
);

alter table donors            enable row level security;
alter table donation_intents  enable row level security;
alter table donations         enable row level security;
alter table subscribers       enable row level security;
alter table concern_reports   enable row level security;
alter table contact_messages  enable row level security;
-- No policies on purpose: anon and authenticated roles get nothing.
