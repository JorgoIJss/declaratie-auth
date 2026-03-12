
-- Complete auth + multi-user setup for the declaratie app
-- Run this in Supabase SQL editor

create extension if not exists pgcrypto;

-- 1) Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

-- 2) user_settings: make per-user
alter table if exists public.user_settings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists user_settings_user_id_key
  on public.user_settings(user_id);

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own"
on public.user_settings
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own"
on public.user_settings
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own"
on public.user_settings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own"
on public.user_settings
for delete
to authenticated
using (user_id = auth.uid());

-- 3) declarations: make per-user
alter table if exists public.declarations
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.declarations enable row level security;

drop policy if exists "declarations_select_own" on public.declarations;
create policy "declarations_select_own"
on public.declarations
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "declarations_insert_own" on public.declarations;
create policy "declarations_insert_own"
on public.declarations
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "declarations_update_own" on public.declarations;
create policy "declarations_update_own"
on public.declarations
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "declarations_delete_own" on public.declarations;
create policy "declarations_delete_own"
on public.declarations
for delete
to authenticated
using (user_id = auth.uid());

-- 4) send_history: make per-user
alter table if exists public.send_history
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.send_history enable row level security;

drop policy if exists "send_history_select_own" on public.send_history;
create policy "send_history_select_own"
on public.send_history
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "send_history_insert_own" on public.send_history;
create policy "send_history_insert_own"
on public.send_history
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "send_history_update_own" on public.send_history;
create policy "send_history_update_own"
on public.send_history
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "send_history_delete_own" on public.send_history;
create policy "send_history_delete_own"
on public.send_history
for delete
to authenticated
using (user_id = auth.uid());

-- 5) send_history_items: make per-user
alter table if exists public.send_history_items
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.send_history_items enable row level security;

drop policy if exists "send_history_items_select_own" on public.send_history_items;
create policy "send_history_items_select_own"
on public.send_history_items
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "send_history_items_insert_own" on public.send_history_items;
create policy "send_history_items_insert_own"
on public.send_history_items
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "send_history_items_update_own" on public.send_history_items;
create policy "send_history_items_update_own"
on public.send_history_items
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "send_history_items_delete_own" on public.send_history_items;
create policy "send_history_items_delete_own"
on public.send_history_items
for delete
to authenticated
using (user_id = auth.uid());

-- 6) Auto-create profile + settings when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name);

  insert into public.user_settings (
    id,
    user_id,
    from_email,
    to_email,
    from_name,
    iban,
    account_name,
    signature_name,
    send_individually_by_default,
    updated_at
  )
  values (
    gen_random_uuid(),
    new.id,
    'Declaraties <declaraties_amervallei@growth-dynamics.nl>',
    'penningmeester@amervallei.nl',
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    '',
    '',
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    false,
    now()
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 7) Storage policies for receipts bucket
insert into storage.buckets (id, name, public)
values ('declaratie-bonnen', 'declaratie-bonnen', true)
on conflict (id) do nothing;

drop policy if exists "receipts_select_own" on storage.objects;
create policy "receipts_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'declaratie-bonnen'
  and (storage.foldername(name))[1] = 'receipts'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "receipts_insert_own" on storage.objects;
create policy "receipts_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'declaratie-bonnen'
  and (storage.foldername(name))[1] = 'receipts'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "receipts_update_own" on storage.objects;
create policy "receipts_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'declaratie-bonnen'
  and (storage.foldername(name))[1] = 'receipts'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'declaratie-bonnen'
  and (storage.foldername(name))[1] = 'receipts'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "receipts_delete_own" on storage.objects;
create policy "receipts_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'declaratie-bonnen'
  and (storage.foldername(name))[1] = 'receipts'
  and (storage.foldername(name))[2] = auth.uid()::text
);
