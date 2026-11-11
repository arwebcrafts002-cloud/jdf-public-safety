-- JDF Public Safety: columns and one table needed for embedded Square payments.
-- NOT APPLIED ANYWHERE. Untested. Run after db/schema.sql, on the same JDF
-- project, only when api/square-pay.js and api/square-webhook.js are being
-- switched on. Safe to run twice.

-- ---------- donors ----------------------------------------------------------
alter table donors add column if not exists square_customer_id text;

-- ---------- monthly gifts ---------------------------------------------------
-- One row per recurring gift. Each month's actual charge is a donations row
-- (written by the webhook) that points back here.
create table if not exists subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  donor_id                uuid references donors(id),
  donor_email             text,
  square_subscription_id  text not null unique,
  square_customer_id      text,
  amount_cents            integer not null check (amount_cents >= 100),
  status                  text not null default 'active',
  is_anonymous            boolean not null default false,
  dedication_type         text check (dedication_type in ('honor','memory')),
  dedication_name         text,
  idempotency_key         text unique,
  created_at              timestamptz not null default now(),
  canceled_at             timestamptz
);
create index if not exists subscriptions_customer_idx on subscriptions (square_customer_id);
alter table subscriptions enable row level security;
-- No policies on purpose, same as the other tables: only the server (service key) reads or writes.

-- ---------- donations -------------------------------------------------------
alter table donations add column if not exists donor_email        text;
alter table donations add column if not exists square_order_id    text;
alter table donations add column if not exists square_customer_id text;
alter table donations add column if not exists subscription_id    uuid references subscriptions(id);
alter table donations add column if not exists idempotency_key    text;
alter table donations add column if not exists receipt_url        text;        -- Square's own hosted receipt page
alter table donations add column if not exists source             text;        -- 'embedded' | 'hosted' | 'subscription'
alter table donations add column if not exists refunded_cents     integer not null default 0;
alter table donations add column if not exists refunded_at        timestamptz;

-- A retry with the same key must land on the same row, never a second one.
create unique index if not exists donations_idempotency_key_uidx on donations (idempotency_key) where idempotency_key is not null;
create index if not exists donations_order_idx on donations (square_order_id);
create index if not exists donations_email_idx on donations (donor_email, paid_at desc);

-- ---------- donation_intents -------------------------------------------------
-- A monthly pledge is matched to its subscription, not to a single payment.
alter table donation_intents add column if not exists matched_subscription uuid references subscriptions(id);
