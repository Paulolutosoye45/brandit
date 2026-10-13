// Database schema. Plain Postgres: runs unchanged on the built-in local database (PGlite)
// and on Supabase or any hosted Postgres. Money is whole kobo. Nothing is overwritten:
// stage changes, refunds and messages are added as new rows.
import type { Q } from './db';
import { backfillCatalogContent } from './catalog-content';
import { seedGrowthContent } from './growth-content';

export const MIGRATIONS: { id: string; sql: string; after?: (q: Q) => Promise<void> }[] = [
  {
    id: '001_init',
    sql: `
create sequence order_seq start 1001;

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  email text,
  business_id uuid references businesses(id),
  created_at timestamptz not null default now()
);

create table otp_codes (
  phone text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  areas text[] not null default '{}',
  fee_kobo int not null,
  eligible_24h boolean not null default true,
  provisional boolean not null default false,
  sort int not null default 0
);

create table presses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_partner boolean not null default false
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  role text not null check (role in ('admin','production_lead','file_desk','support','dispatcher','partner_press')),
  pin_hash text not null,
  press_id uuid references presses(id),
  active boolean not null default true
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  blurb text not null default '',
  pricing_mode text not null check (pricing_mode in ('tier','area','size')),
  options jsonb not null default '[]',
  sizes jsonb not null default '[]',
  print_w_in real,
  print_h_in real,
  check_class text not null default 'print' check (check_class in ('print','photo','large')),
  active boolean not null default true,
  sort int not null default 0
);

create table price_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  config jsonb not null default '{}',
  quantity int,
  size_key text,
  price_kobo int,
  rate_per_sqft_kobo int,
  min_area_sqft real,
  provisional boolean not null default false,
  active boolean not null default true
);

create table promise_rules (
  product_id uuid primary key references products(id),
  eligible_24h boolean not null default false,
  max_quantity int,
  max_area_sqft real,
  max_size_rank int,
  excluded_choices jsonb not null default '[]',
  standard_days int not null default 3
);

create table settings (key text primary key, value jsonb not null);

create table orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  public_token text unique not null,
  customer_id uuid references customers(id),
  business_id uuid references businesses(id),
  status text not null default 'draft' check (status in ('draft','awaiting_payment','paid','in_production','delivered','cancelled','refunded')),
  subtotal_kobo int not null default 0,
  delivery_fee_kobo int not null default 0,
  design_fee_kobo int not null default 0,
  vat_kobo int not null default 0,
  total_kobo int not null default 0,
  address jsonb,
  zone_id uuid references delivery_zones(id),
  area text,
  pickup boolean not null default false,
  speed text check (speed in ('24h','standard')),
  production_day text,
  promised_at timestamptz,
  promise_reasons jsonb not null default '[]',
  hold_expires_at timestamptz,
  need_by timestamptz,
  delivery_code text,
  plain_pack boolean not null default false,
  paid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  product_id uuid not null references products(id),
  config jsonb not null default '{}',
  size_key text,
  quantity int not null default 1,
  width_ft real,
  height_ft real,
  line_total_kobo int not null,
  artwork_path text check (artwork_path in ('upload','design')),
  design_brief jsonb,
  artwork_file_id uuid,
  preview_approved_at timestamptz
);

create table files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  order_item_id uuid references order_items(id),
  kind text not null check (kind in ('artwork','preview','proof','qc_photo','claim_photo','review_photo','id_list')),
  storage_key text not null,
  original_name text,
  mime text not null,
  bytes int not null,
  width_px int,
  height_px int,
  check_result jsonb,
  delete_after timestamptz,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  order_item_id uuid unique not null references order_items(id),
  stage text not null default 'paid' check (stage in ('paid','file_check','proof','printing','quality_check','out_for_delivery','delivered')),
  press_id uuid references presses(id),
  clock_paused boolean not null default false,
  paused_reason text,
  paused_at timestamptz,
  at_risk boolean not null default false,
  reprint_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table job_events (
  id int generated always as identity primary key,
  job_id uuid not null references jobs(id),
  from_stage text,
  to_stage text not null,
  staff_id uuid references staff(id),
  note text,
  created_at timestamptz not null default now()
);

create table proofs (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  order_item_id uuid not null references order_items(id),
  version int not null,
  file_id uuid not null references files(id),
  status text not null check (status in ('sent','approved','changes_requested')),
  customer_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  provider_ref text unique not null,
  method text,
  amount_kobo int not null,
  status text not null,
  verified_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now()
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references orders(id),
  provider text,
  rider_name text,
  rider_phone text,
  tracking_url text,
  dispatched_at timestamptz,
  delivered_at timestamptz
);

create table messages (
  id int generated always as identity primary key,
  order_id uuid references orders(id),
  to_phone text,
  channel text not null default 'demo' check (channel in ('whatsapp','sms','demo')),
  template text not null,
  vars jsonb not null default '{}',
  body text not null,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references orders(id),
  rating int not null check (rating between 1 and 5),
  body text,
  photo_file_id uuid references files(id),
  staff_reply text,
  created_at timestamptz not null default now()
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  kind text not null check (kind in ('late','wrong_print','damaged','other')),
  source text not null default 'customer' check (source in ('customer','system')),
  description text,
  photo_file_id uuid references files(id),
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text check (resolution in ('reprint','refund','delivery_refund','rejected')),
  resolution_note text,
  cost_kobo int not null default 0,
  staff_id uuid references staff(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table events (
  id int generated always as identity primary key,
  name text not null,
  sid text,
  props jsonb not null default '{}',
  at timestamptz not null default now()
);

create index orders_customer_idx on orders (customer_id, created_at desc);
create index orders_promised_idx on orders (promised_at) where status in ('paid','in_production');
create index orders_production_day_idx on orders (production_day) where speed = '24h';
create index jobs_stage_idx on jobs (stage);
create index events_name_idx on events (name, at);
create index claims_order_idx on claims (order_id);
`,
  },
  {
    id: '002_accounts',
    sql: `
-- One customer, several ways in. Phone, email and Google are identities of the same account.
alter table customers alter column phone drop not null;
alter table customers add column google_sub text;
alter table customers add column email_verified boolean not null default false;
alter table customers add column whatsapp_phone text;        -- where we send order updates, if it is not the sign-in phone
alter table customers add column account_type text not null default 'personal' check (account_type in ('personal','business'));
alter table customers add column default_area text;
alter table customers add column marketing_opt_in boolean not null default false;
alter table customers add column avatar_url text;
alter table customers add column profile_completed_at timestamptz;
alter table customers add column last_sign_in_at timestamptz;
create unique index customers_google_sub_key on customers (google_sub) where google_sub is not null;
create unique index customers_email_verified_key on customers (lower(email)) where email_verified;

-- Six-digit sign-in codes for email and phone. Only a hash is stored.
create table login_codes (
  channel text not null check (channel in ('email','phone')),
  identifier text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  primary key (channel, identifier)
);

create table sign_ins (
  id int generated always as identity primary key,
  customer_id uuid references customers(id),
  method text not null check (method in ('google','email','phone')),
  at timestamptz not null default now()
);

-- Customers who already ordered as guests have what we need.
update customers set profile_completed_at = created_at where name is not null and phone is not null;
`,
  },
  {
    id: '003_indexes_and_guards',
    sql: `
-- Every column the app joins or filters by gets an index. Without them each lookup reads the whole table,
-- which is fine with a few hundred orders and slow with tens of thousands.
create index if not exists price_rules_product_idx on price_rules (product_id);
create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists order_items_product_idx on order_items (product_id);
create index if not exists jobs_order_idx on jobs (order_id);
create index if not exists jobs_press_idx on jobs (press_id) where press_id is not null;
create index if not exists job_events_job_idx on job_events (job_id);
create index if not exists payments_order_idx on payments (order_id);
create index if not exists files_order_idx on files (order_id);
create index if not exists files_item_idx on files (order_item_id);
create index if not exists messages_order_idx on messages (order_id);
create index if not exists messages_queued_idx on messages (id) where status = 'queued';
create index if not exists proofs_item_idx on proofs (order_item_id);
create index if not exists sign_ins_customer_idx on sign_ins (customer_id);
create index if not exists customers_business_idx on customers (business_id) where business_id is not null;
create index if not exists orders_business_idx on orders (business_id) where business_id is not null;

-- Money is never negative in these columns (refunds are recorded as negative payments, so payments is left alone).
-- NOT VALID checks every new or changed row without re-reading old ones, so it can never block a start.
alter table price_rules add constraint price_rules_nonneg check (coalesce(price_kobo, 0) >= 0 and coalesce(rate_per_sqft_kobo, 0) >= 0) not valid;
alter table delivery_zones add constraint delivery_zones_fee_nonneg check (fee_kobo >= 0) not valid;
alter table orders add constraint orders_amounts_nonneg check (subtotal_kobo >= 0 and delivery_fee_kobo >= 0 and design_fee_kobo >= 0 and vat_kobo >= 0 and total_kobo >= 0) not valid;
alter table order_items add constraint order_items_total_nonneg check (line_total_kobo >= 0) not valid;
alter table claims add constraint claims_cost_nonneg check (cost_kobo >= 0) not valid;

-- A last line of defence against refunding one late order twice: one automatic "late" claim per order.
create unique index if not exists claims_one_system_late_idx on claims (order_id) where kind = 'late' and source = 'system';
`,
  },
  {
    id: '004_catalog_coupons_custom',
    sql: `
-- ---- Products: words, photos, categories, and a switch for custom orders ----
alter table products add column description text not null default '';
alter table products add column highlights text[] not null default '{}';
alter table products add column category text not null default '';
alter table products add column allow_custom boolean not null default true;
alter table products add column system boolean not null default false;   -- internal rows (the "custom order" product), never shown to customers

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_key text not null,
  thumb_key text not null,
  mime text not null,
  width_px int,
  height_px int,
  alt text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on product_images (product_id, sort, created_at);

-- ---- Custom orders: a customer describes a job, we send a price, they accept and pay ----
create sequence custom_seq start 1001;
create table custom_requests (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  public_token text unique not null,
  product_id uuid references products(id),
  customer_id uuid references customers(id),
  name text not null,
  phone text not null,
  email text,
  title text not null,
  details text not null,
  quantity_text text,
  size_text text,
  budget_kobo int check (budget_kobo is null or budget_kobo >= 0),
  need_by date,
  area text,
  status text not null default 'new' check (status in ('new','quoted','accepted','declined','cancelled')),
  quote_price_kobo int check (quote_price_kobo is null or quote_price_kobo > 0),
  quote_days int check (quote_days is null or quote_days between 1 and 60),
  quote_note text,
  quote_valid_until timestamptz,
  quoted_by uuid references staff(id),
  quoted_at timestamptz,
  decline_reason text,
  order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index custom_requests_status_idx on custom_requests (status, created_at desc);
create index custom_requests_customer_idx on custom_requests (customer_id) where customer_id is not null;

alter table files drop constraint if exists files_kind_check;
alter table files add constraint files_kind_check check (kind in ('artwork','preview','proof','qc_photo','claim_photo','review_photo','id_list','custom_ref'));
alter table files add column custom_request_id uuid references custom_requests(id);
create index files_custom_idx on files (custom_request_id) where custom_request_id is not null;

alter table orders add column custom_request_id uuid references custom_requests(id);
create unique index orders_custom_request_idx on orders (custom_request_id) where custom_request_id is not null;
alter table custom_requests add constraint custom_requests_order_fk foreign key (order_id) references orders(id);
alter table order_items add column label text;   -- what to call this line when it is not simply the product name

-- ---- Coupons ----
create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text not null default '',
  kind text not null check (kind in ('percent','fixed','free_delivery')),
  percent_off int check (percent_off is null or percent_off between 1 and 100),
  amount_off_kobo int check (amount_off_kobo is null or amount_off_kobo > 0),
  max_discount_kobo int check (max_discount_kobo is null or max_discount_kobo > 0),
  min_subtotal_kobo int not null default 0 check (min_subtotal_kobo >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions int check (max_redemptions is null or max_redemptions > 0),
  max_per_customer int not null default 1 check (max_per_customer > 0),
  first_order_only boolean not null default false,
  product_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_by uuid references staff(id),
  created_at timestamptz not null default now()
);
create unique index coupons_code_key on coupons (upper(code));

create table coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons(id),
  order_id uuid not null references orders(id),
  customer_id uuid references customers(id),
  phone text,
  email text,
  discount_kobo int not null check (discount_kobo >= 0),
  created_at timestamptz not null default now(),
  unique (order_id)
);
create index coupon_redemptions_coupon_idx on coupon_redemptions (coupon_id);

alter table orders add column coupon_id uuid references coupons(id);
alter table orders add column coupon_code text;
alter table orders add column discount_kobo int not null default 0 check (discount_kobo >= 0);

`,
    // Give the products that shipped with Brandit their descriptions and categories. Done once, so a later edit in the console is never undone.
    after: backfillCatalogContent,
  },
  {
    id: '005_review_consent',
    sql: `
-- A review is shown on the website only when the customer agreed to it AND a person at Brandit chose to feature it.
alter table reviews add column public_ok boolean not null default false;
alter table reviews add column featured boolean not null default false;
`,
  },
  {
    id: '006_growth',
    sql: `
-- ---- Customers: reminders, language ----
alter table customers add column nudge_ok boolean not null default true;                       -- may we remind them once about an order they did not pay for
alter table customers add column lang text not null default 'en' check (lang in ('en','pcm'));  -- wording of the messages they receive

-- ---- Orders: abandoned-checkout nudge, delivery window, template ----
alter table orders add column checkout_saved_at timestamptz;   -- when the customer last filled in their details and could have paid
alter table orders add column nudged_at timestamptz;           -- the one reminder we sent
alter table orders add column delivery_window text check (delivery_window is null or delivery_window in ('morning','afternoon'));
create index orders_nudge_idx on orders (checkout_saved_at) where status = 'awaiting_payment' and nudged_at is null;
alter table messages add column lang text not null default 'en';

-- ---- Coupons: referral and reward codes are ordinary coupons that belong to a customer ----
alter table coupons add column source text not null default 'manual' check (source in ('manual','referral','reward'));
alter table coupons add column owner_customer_id uuid references customers(id);
create unique index coupons_referral_owner_key on coupons (owner_customer_id) where source = 'referral';
create index coupons_owner_idx on coupons (owner_customer_id) where owner_customer_id is not null;

create table referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references customers(id),
  friend_id uuid not null references customers(id),
  order_id uuid unique not null references orders(id),        -- the friend's order that earned it
  reward_coupon_id uuid references coupons(id),
  amount_kobo int not null check (amount_kobo >= 0),
  created_at timestamptz not null default now(),
  unique (referrer_id, friend_id)
);
create index referral_rewards_referrer_idx on referral_rewards (referrer_id);

-- ---- Ready-made templates ----
create table templates (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  category text not null default '',
  blurb text not null default '',
  includes text not null default '',                           -- "A5 leaflet, 100 copies"
  product_id uuid not null references products(id),
  quantity int not null default 1 check (quantity > 0),
  size_key text,
  config jsonb not null default '{}',
  width_ft real,
  height_ft real,
  fields jsonb not null default '[]',                          -- the questions we ask: [{key,label,hint,kind,required}]
  look jsonb not null default '{}',                            -- how the preview is drawn: {layout, palette, lines}
  purpose text not null default '',                            -- starts the design brief
  image_key text,
  image_thumb_key text,
  image_mime text,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index templates_active_idx on templates (active, sort);
alter table orders add column template_id uuid references templates(id);

-- ---- Plan my event: a custom request that carries a list of items ----
alter table custom_requests add column kind text not null default 'custom' check (kind in ('custom','event'));
alter table custom_requests add column event_plan jsonb;

-- ---- Seasonal pages ----
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  headline text not null,
  intro text not null default '',
  theme text not null default 'ink',
  starts_on date,
  ends_on date,
  last_order_note text not null default '',                    -- "Order by 12 December for Christmas week"
  coupon_code text,
  product_slugs text[] not null default '{}',
  template_slugs text[] not null default '{}',
  show_on_home boolean not null default true,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- ---- Rider link and live position ----
alter table deliveries add column rider_token text unique;
alter table deliveries add column started_at timestamptz;      -- the rider opened the trip
alter table deliveries add column nearby_at timestamptz;       -- "I am close" was pressed
alter table deliveries add column last_lat double precision;
alter table deliveries add column last_lng double precision;
alter table deliveries add column last_accuracy_m real;
alter table deliveries add column last_ping_at timestamptz;
alter table deliveries add column code_attempts int not null default 0;
alter table deliveries add column code_locked_until timestamptz;

-- ---- Brand kit ----
create table brand_kits (
  customer_id uuid primary key references customers(id) on delete cascade,
  display_name text,
  tagline text,
  primary_hex text,
  secondary_hex text,
  accent_hex text,
  fonts text,
  tone text,
  phone_line text,
  address_line text,
  website text,
  notes text,
  updated_at timestamptz not null default now()
);
create table brand_assets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null check (kind in ('logo','design','other')),
  title text not null,
  storage_key text not null,
  thumb_key text,
  mime text not null,
  bytes int not null,
  width_px int,
  height_px int,
  source_order_id uuid references orders(id),
  created_at timestamptz not null default now()
);
create index brand_assets_customer_idx on brand_assets (customer_id, created_at desc);

-- ---- Photo reviews: nothing is public until a person approves it ----
alter table reviews add column photo_status text not null default 'none' check (photo_status in ('none','pending','approved','rejected'));
alter table reviews add column photo_public_ok boolean not null default false;   -- agreed that the photo may be shown, separately from the words
alter table reviews add column photo_key text;
alter table reviews add column photo_thumb_key text;
alter table reviews add column photo_moderated_at timestamptz;
alter table reviews add column photo_moderated_by uuid references staff(id);
create index reviews_photo_pending_idx on reviews (created_at) where photo_status = 'pending';
`,
    // A shop that already has products gets the starting templates and seasonal pages once. A brand new one gets them after its products exist.
    after: seedGrowthContent,
  },
  {
    id: '007_studio',
    sql: `
-- ============ Brandit Studio: AI designs, checked and set by Brandit ============
-- The human design service is the top rung now. If the fee is still the old placeholder, move it to the new starting price.
update settings set value = '1200000'::jsonb where key = 'design_fee_kobo' and value = '500000'::jsonb;

alter table customers add column studio_blocked_until timestamptz;   -- Studio paused on this account after repeated blocked requests

-- Launch plan: invited people only, by phone number or email.
create table studio_invites (
  identifier text primary key,          -- +234... or a lower-case email
  note text,
  created_at timestamptz not null default now()
);

create table studio_projects (
  id uuid primary key default gen_random_uuid(),
  share_token text unique not null,       -- the login-free link for family and committees
  customer_id uuid not null references customers(id),
  title text not null default '',
  tier text check (tier in ('standard','premium')),     -- empty until the design is unlocked
  status text not null default 'draft' check (status in ('draft','active','approved','archived','purged')),
  product_slug text not null,
  size_key text,
  config jsonb not null default '{}',
  quantity int not null default 1 check (quantity > 0),
  width_ft real,
  height_ft real,
  occasion text not null default 'other',
  brief jsonb not null default '{}',      -- the words, the look, the colours: what the customer typed
  order_id uuid references orders(id),    -- the draft order this design is for, when it started from one
  shared_version_id uuid,                 -- the version shown on the share link
  liked_version_id uuid,                  -- the free sketch the customer liked, so the paid design starts from it
  approved_version_id uuid,
  approved_sha256 text,
  approved_at timestamptz,
  spelling_confirmed_at timestamptz,
  credit_kobo int not null default 0,     -- what comes off the print order
  credit_coupon_id uuid references coupons(id),
  extra_rounds int not null default 0,    -- extra revision rounds bought
  vector_paid boolean not null default false,
  check_paid boolean not null default false,
  paid_kobo int not null default 0,
  paid_at timestamptz,
  from_pack boolean not null default false,
  finishes int not null default 0,        -- print files built so far
  consent_at timestamptz,                 -- agreed that pictures and words go to the image companies
  last_activity_at timestamptz not null default now(),
  delete_after timestamptz,
  created_at timestamptz not null default now()
);
create index studio_projects_customer_idx on studio_projects (customer_id, last_activity_at desc);
create index studio_projects_delete_idx on studio_projects (delete_after) where status <> 'purged';

create table studio_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references studio_projects(id) on delete cascade,
  customer_id uuid not null references customers(id),
  kind text not null check (kind in ('photo','logo','reference','fabric')),
  title text not null default '',
  storage_key text,                       -- the original, untouched
  preview_key text,                       -- small copy for the screen
  cut_key text,                           -- the person cut out (PNG with a clear background)
  vector_key text,                        -- a logo turned into a vector (SVG)
  mime text not null,
  bytes int not null,
  width_px int,
  height_px int,
  palette jsonb,
  moderation text not null default 'ok' check (moderation in ('ok','review','blocked')),
  created_at timestamptz not null default now()
);
create index studio_assets_project_idx on studio_assets (project_id, created_at);

create table studio_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references studio_projects(id) on delete cascade,
  parent_id uuid,
  kind text not null check (kind in ('sketch','concept','draft','revision','final','edit','adapt','tweak')),
  idx int not null default 0,
  round int not null default 0,
  status text not null default 'queued' check (status in ('queued','running','ready','failed','blocked')),
  free boolean not null default false,
  seed int,
  engine text,
  model text,
  prompt text,
  note text,                              -- what the customer asked to change
  layout jsonb not null default '{}',     -- font, theme, panel: how the words are set
  payload jsonb not null default '{}',    -- extra instructions for the worker
  spec jsonb,                             -- the print size this version was built for
  art_key text,
  art_w int,
  art_h int,
  preview_key text,
  preview_w int,
  preview_h int,
  final_key text,
  final_mime text,
  final_w int,
  final_h int,
  final_bytes int,
  pdf_key text,
  svg_key text,
  sha256 text,
  check_result jsonb,
  upscale jsonb,
  finish_status text not null default 'none' check (finish_status in ('none','queued','running','done','failed')),
  finish_attempts int not null default 0,
  finish_run_after timestamptz not null default now(),
  finish_locked_at timestamptz,
  finish_error text,
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  error text,                             -- for our team
  user_error text,                        -- in plain words, for the customer
  cost_usd_micro bigint not null default 0,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  delete_after timestamptz
);
create index studio_versions_project_idx on studio_versions (project_id, created_at);
create index studio_versions_queue_idx on studio_versions (run_after) where status in ('queued','running');
create index studio_versions_finish_idx on studio_versions (finish_run_after) where finish_status in ('queued','running');

-- Every call to an image company, with what it cost. The margin report reads this.
create table studio_ledger (
  id bigint generated always as identity primary key,
  project_id uuid,
  version_id uuid,
  vendor text not null,
  model text,
  op text not null,                       -- generate, edit, upscale, vectorise, cutout, moderate
  units numeric not null default 1,       -- images, or megapixels
  cost_usd_micro bigint not null default 0,
  cost_kobo int not null default 0,
  free boolean not null default false,
  simulated boolean not null default false,
  ok boolean not null default true,
  ms int,
  at timestamptz not null default now()
);
create index studio_ledger_at_idx on studio_ledger (at);
create index studio_ledger_project_idx on studio_ledger (project_id);

create table studio_purchases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  project_id uuid references studio_projects(id),
  sku text not null check (sku in ('standard','premium','upgrade','pack3','round','vector','check')),
  amount_kobo int not null check (amount_kobo >= 0),
  provider_ref text unique not null,
  status text not null default 'pending' check (status in ('pending','paid','refunded','failed')),
  method text,
  verified_at timestamptz,
  applied_at timestamptz,
  refund_note text,
  refunded_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index studio_purchases_customer_idx on studio_purchases (customer_id, created_at desc);
create index studio_purchases_project_idx on studio_purchases (project_id);

-- Designs bought in a pack of three. They never expire.
create table studio_wallets (
  customer_id uuid primary key references customers(id),
  standard_credits int not null default 0 check (standard_credits >= 0)
);

-- Anything the content rules or a person stopped, and anything worth a second look.
create table studio_flags (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  project_id uuid references studio_projects(id) on delete set null,
  version_id uuid,
  stage text not null check (stage in ('words','look','upload','output','print')),
  category text not null,
  verdict text not null check (verdict in ('block','review')),
  excerpt text,
  status text not null default 'open' check (status in ('open','dismissed','actioned')),
  reviewed_by uuid references staff(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index studio_flags_open_idx on studio_flags (created_at desc) where status = 'open';
create index studio_flags_customer_idx on studio_flags (customer_id, created_at desc);

-- A Brandit designer looks at the design before it goes to print.
create table studio_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references studio_projects(id) on delete cascade,
  version_id uuid not null,
  status text not null default 'waiting' check (status in ('waiting','passed','changes')),
  note text,
  staff_id uuid references staff(id),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);
create index studio_reviews_waiting_idx on studio_reviews (requested_at) where status = 'waiting';

-- What the family or committee said on the share link.
create table studio_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references studio_projects(id) on delete cascade,
  version_id uuid,
  name text not null,
  verdict text not null check (verdict in ('like','changes')),
  note text,
  created_at timestamptz not null default now()
);
create index studio_feedback_project_idx on studio_feedback (project_id, created_at desc);

-- Who approved what, and when. Never edited.
create table studio_audit (
  id bigint generated always as identity primary key,
  project_id uuid,
  actor text not null,
  action text not null,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index studio_audit_project_idx on studio_audit (project_id, at);

-- Free sketches, counted by verified phone number.
create table studio_sketch_log (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers(id),
  phone text not null,
  project_id uuid,
  version_id uuid,
  cost_kobo int not null default 0,
  at timestamptz not null default now()
);
create index studio_sketch_phone_idx on studio_sketch_log (phone, at);
create index studio_sketch_at_idx on studio_sketch_log (at);

alter table orders add column studio_project_id uuid references studio_projects(id);
alter table order_items add column studio_version_id uuid;
create index orders_studio_idx on orders (studio_project_id) where studio_project_id is not null;
`,
  },
];
