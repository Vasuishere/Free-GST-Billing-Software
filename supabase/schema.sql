-- ============================================================================
-- Free GST Billing Software - Multi-Employee Cloud Schema (Supabase Postgres)
-- Run this in Supabase Dashboard -> SQL Editor
-- ============================================================================

create extension if not exists "pgcrypto";

-- 1. Shared updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Companies & Employee Memberships
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'staff' check (role in ('admin', 'staff', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create trigger trg_company_members_updated_at
  before update on public.company_members
  for each row execute function public.set_updated_at();

-- Helper functions for RLS
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = p_company_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = p_company_id and user_id = auth.uid() and role = 'admin'
  );
$$;

-- 3. Company Settings (replaces localStorage profile, meta, local-prefs)
create table if not exists public.app_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  local_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- 4. Clients (with billing + multiple shipping addresses)
create table if not exists public.clients (
  id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  gstin text not null default '',
  email text not null default '',
  phone text not null default '',
  billing_address jsonb not null default '{}'::jsonb,
  shipping_addresses jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- 5. Vendors / Suppliers (bank_details stored as jsonb; sensitive fields masked in UI)
create table if not exists public.vendors (
  id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  contact_person text not null default '',
  gstin text not null default '',
  email text not null default '',
  phone text not null default '',
  payment_terms_days integer,
  bank_details jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create trigger trg_vendors_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- 6. Products
create table if not exists public.products (
  id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  hsn text not null default '',
  purchase_price numeric(14,2) not null default 0,
  selling_price numeric(14,2) not null default 0,
  tax_percent numeric(6,2) not null default 0,
  stock numeric(14,3) not null default 0,
  unit text not null default 'Nos',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- 7. Sales Bills / Invoices
create table if not exists public.bills (
  id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id text,
  invoice_number text not null default '',
  invoice_type text not null default 'tax-invoice',
  invoice_date date,
  total_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  status text not null default 'unpaid',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id),
  foreign key (company_id, client_id) references public.clients(company_id, id) on delete set null
);
create index if not exists idx_bills_company_date on public.bills(company_id, invoice_date desc);
create trigger trg_bills_updated_at
  before update on public.bills
  for each row execute function public.set_updated_at();

-- 8. Purchase Bills
create table if not exists public.purchases (
  id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id text,
  supplier_name text not null default '',
  invoice_number text not null default '',
  bill_date date,
  due_date date,
  total_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  payment_status text not null default 'Unpaid',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id),
  foreign key (company_id, vendor_id) references public.vendors(company_id, id) on delete set null
);
create index if not exists idx_purchases_company_date on public.purchases(company_id, bill_date desc);
create trigger trg_purchases_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();

-- 9. Purchase Orders
create table if not exists public.purchase_orders (
  id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id text,
  po_number text not null default '',
  po_date date,
  total_amount numeric(14,2) not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id),
  foreign key (company_id, vendor_id) references public.vendors(company_id, id) on delete set null
);
create trigger trg_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

-- 10. Expenses & Receipts
create table if not exists public.expenses (
  id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  expense_date date,
  amount numeric(14,2) not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create trigger trg_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create table if not exists public.receipts (
  id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_date date,
  amount numeric(14,2) not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create trigger trg_receipts_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

-- 11. Secondary Collections (templates, recurring, profiles, productions, cash-book, debit-notes, bank-statements, stock-adjustments)
create table if not exists public.company_documents (
  company_id uuid not null references public.companies(id) on delete cascade,
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, collection, id)
);
create index if not exists idx_company_docs_col on public.company_documents(company_id, collection);
create trigger trg_company_documents_updated_at
  before update on public.company_documents
  for each row execute function public.set_updated_at();

-- 12. Atomic counter increment RPC (multi-device safe invoice/PO/DN numbering)
create or replace function public.increment_meta_counter(p_company_id uuid, p_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.app_settings (company_id, meta)
  values (p_company_id, jsonb_build_object(p_key, 1))
  on conflict (company_id) do update
    set meta = jsonb_set(
      coalesce(app_settings.meta, '{}'::jsonb),
      array[p_key],
      to_jsonb(coalesce((app_settings.meta->>p_key)::integer, 0) + 1),
      true
    )
  returning (meta->>p_key)::integer into v_next;
  return v_next;
end;
$$;

-- 13. Seed default shared company (no employee login required)
insert into public.companies (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Default Company')
on conflict (id) do nothing;

insert into public.app_settings (company_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (company_id) do nothing;

-- ============================================================================
-- 14. Row Level Security (RLS) Policies & Grants (Direct / No-Auth Cloud Mode)
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.companies,
  public.app_settings,
  public.clients,
  public.vendors,
  public.products,
  public.bills,
  public.purchases,
  public.purchase_orders,
  public.expenses,
  public.receipts,
  public.company_documents
to anon, authenticated;
grant execute on function public.increment_meta_counter(uuid, text) to anon, authenticated;

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.app_settings enable row level security;
alter table public.clients enable row level security;
alter table public.vendors enable row level security;
alter table public.products enable row level security;
alter table public.bills enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.expenses enable row level security;
alter table public.receipts enable row level security;
alter table public.company_documents enable row level security;

-- Drop old auth-based policies if re-running on an existing database
drop policy if exists "companies_select_member" on public.companies;
drop policy if exists "companies_update_admin" on public.companies;
drop policy if exists "companies_public_all" on public.companies;
create policy "companies_public_all" on public.companies
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "settings_select_member" on public.app_settings;
drop policy if exists "settings_insert_member" on public.app_settings;
drop policy if exists "settings_update_member" on public.app_settings;
drop policy if exists "settings_public_all" on public.app_settings;
create policy "settings_public_all" on public.app_settings
  for all to anon, authenticated using (true) with check (true);

-- Open shared-workspace policies for all business tables (no login required)
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'clients', 'vendors', 'products', 'bills', 'purchases',
    'purchase_orders', 'expenses', 'receipts', 'company_documents'
  ] loop
    execute format('drop policy if exists "%s_select_member" on public.%I', tbl, tbl);
    execute format('drop policy if exists "%s_insert_member" on public.%I', tbl, tbl);
    execute format('drop policy if exists "%s_update_member" on public.%I', tbl, tbl);
    execute format('drop policy if exists "%s_delete_admin" on public.%I', tbl, tbl);
    execute format('drop policy if exists "%s_public_all" on public.%I', tbl, tbl);
    execute format('create policy "%s_public_all" on public.%I for all to anon, authenticated using (true) with check (true)', tbl, tbl);
  end loop;
end $$;
