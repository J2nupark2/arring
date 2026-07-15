create table if not exists public.support_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_email text not null check (char_length(contact_email) between 3 and 320),
  category text not null check (category in ('general', 'bug', 'account', 'privacy', 'partnership')),
  subject text not null check (char_length(subject) between 2 and 120),
  message text not null check (char_length(message) between 10 and 5000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_reply text check (admin_reply is null or char_length(admin_reply) between 2 and 5000),
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_inquiries_user_created_idx
  on public.support_inquiries (user_id, created_at desc);
create index if not exists support_inquiries_status_created_idx
  on public.support_inquiries (status, created_at desc);

alter table public.support_inquiries enable row level security;

revoke all on table public.support_inquiries from anon, authenticated;
grant select, insert on table public.support_inquiries to authenticated;
grant update on table public.support_inquiries to authenticated;

create policy "users can view own inquiries"
  on public.support_inquiries for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "users can create own inquiries"
  on public.support_inquiries for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'open'
    and admin_reply is null
    and answered_by is null
    and answered_at is null
  );

create policy "admins can answer inquiries"
  on public.support_inquiries for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.touch_support_inquiry_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_support_inquiry_updated_at on public.support_inquiries;
create trigger touch_support_inquiry_updated_at
before update on public.support_inquiries
for each row execute function public.touch_support_inquiry_updated_at();

