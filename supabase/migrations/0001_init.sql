create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'standard_user' check (role in ('admin', 'standard_user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.baselines (
  id uuid primary key default gen_random_uuid(),
  angle text not null check (angle in ('front', 'back', 'side', 'top')),
  label text not null,
  pose jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  active boolean not null default true
);

create table if not exists public.session_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_json jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.baselines enable row level security;
alter table public.session_results enable row level security;

create policy "profiles read own" on public.profiles
for select using (auth.uid() = id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "profiles update own" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "baselines read active" on public.baselines
for select using (active = true);

create policy "baselines admin write" on public.baselines
for insert with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "baselines admin update" on public.baselines
for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')) with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "results own insert" on public.session_results
for insert with check (auth.uid() = user_id or auth.uid() is null);

create policy "results own read" on public.session_results
for select using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
