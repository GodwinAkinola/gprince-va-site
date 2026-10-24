-- Gprince | Administrative Virtual Assistant: core schema + security
-- Run in Supabase > SQL Editor.

create extension if not exists "pgcrypto";

-- ADMIN ALLOW-LIST: only users listed here are administrators.
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- SITE SETTINGS (key/value text: headline, about text, footer, socials, SEO)
create table public.site_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  title text not null check (char_length(title) between 2 and 120),
  summary text not null default '',
  value_statement text not null default '',
  deliverables text[] not null default '{}',
  cta_label text not null default 'Discuss Your Needs',
  sort_order int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  kind text not null check (kind in ('skill','tool')),
  sort_order int not null default 0,
  is_published boolean not null default true
);

create table public.portfolio_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  sort_order int not null default 0
);

create table public.portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  title text not null check (char_length(title) between 2 and 150),
  category_id uuid references public.portfolio_categories(id) on delete set null,
  description text not null default '',
  skills_demonstrated text[] not null default '{}',
  tools_used text[] not null default '{}',
  image_path text,            -- path inside the 'portfolio' storage bucket
  document_path text,         -- optional downloadable file
  external_url text check (external_url is null or external_url ~ '^https?://'),
  project_date date,
  is_sample boolean not null default true,  -- sample/practice label
  status text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blog_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  slug text unique not null check (slug ~ '^[a-z0-9-]+$')
);

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  title text not null check (char_length(title) between 2 and 200),
  excerpt text not null default '',
  content text not null default '',
  featured_image_path text,
  category_id uuid references public.blog_categories(id) on delete set null,
  tags text[] not null default '{}',
  author text not null default 'Gprince',
  seo_title text,
  meta_description text check (meta_description is null or char_length(meta_description) <= 200),
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  company text check (char_length(company) <= 150),
  service text check (char_length(service) <= 150),
  message text not null check (char_length(message) between 10 and 4000),
  preferred_contact text check (char_length(preferred_contact) <= 50),
  budget_range text check (char_length(budget_range) <= 80),
  status text not null default 'new' check (status in ('new','in_progress','resolved')),
  ip_hash text,               -- hashed, for rate limiting only
  created_at timestamptz not null default now()
);

create table public.inquiry_notes (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.contact_inquiries(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index on public.contact_inquiries (status, created_at desc);
create index on public.contact_inquiries (ip_hash, created_at);
create index on public.blog_posts (status, published_at desc);

create trigger t_services_u before update on public.services for each row execute function public.set_updated_at();
create trigger t_projects_u before update on public.portfolio_projects for each row execute function public.set_updated_at();
create trigger t_posts_u before update on public.blog_posts for each row execute function public.set_updated_at();

-- ROW LEVEL SECURITY: switch on everywhere, then grant narrowly.
alter table public.admin_users enable row level security;
alter table public.site_settings enable row level security;
alter table public.services enable row level security;
alter table public.skills enable row level security;
alter table public.portfolio_categories enable row level security;
alter table public.portfolio_projects enable row level security;
alter table public.blog_categories enable row level security;
alter table public.blog_posts enable row level security;
alter table public.contact_inquiries enable row level security;
alter table public.inquiry_notes enable row level security;

-- Admins can do everything on every content table.
do $$ declare t text; begin
  foreach t in array array['site_settings','services','skills','portfolio_categories',
    'portfolio_projects','blog_categories','blog_posts','contact_inquiries','inquiry_notes'] loop
    execute format('create policy "admin all" on public.%I for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Admins may see the allow-list; nobody can edit it from the website.
create policy "admin read list" on public.admin_users for select using (public.is_admin());

-- Visitors: read PUBLISHED content only.
create policy "public read settings" on public.site_settings for select using (true);
create policy "public read services" on public.services for select using (is_published);
create policy "public read skills" on public.skills for select using (is_published);
create policy "public read pcats" on public.portfolio_categories for select using (true);
create policy "public read projects" on public.portfolio_projects for select using (status = 'published');
create policy "public read bcats" on public.blog_categories for select using (true);
create policy "public read posts" on public.blog_posts for select
  using (status = 'published' and published_at <= now());

-- Inquiries: NO public policy at all. Visitors cannot read, insert, edit or delete.
-- Submissions go through the 'submit-inquiry' Edge Function, which validates,
-- rate-limits, stores, and emails you using a server-side secret.

-- STORAGE: public-read buckets, admin-only writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('portfolio','portfolio',true, 5242880, array['image/jpeg','image/png','image/webp','application/pdf']),
 ('blog','blog',true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "public read files" on storage.objects for select using (bucket_id in ('portfolio','blog'));
create policy "admin write files" on storage.objects for insert with check (bucket_id in ('portfolio','blog') and public.is_admin());
create policy "admin update files" on storage.objects for update using (bucket_id in ('portfolio','blog') and public.is_admin());
create policy "admin delete files" on storage.objects for delete using (bucket_id in ('portfolio','blog') and public.is_admin());

-- Starter data: your seven services (editable later in the dashboard).
insert into public.services (slug,title,summary,deliverables,sort_order) values
('administrative-support','Administrative Support','Keep your files, records and routine tasks organised so your day runs smoothly.',array['Organised digital files and documents','Well-kept records','Routine administrative assistance','Document organisation and formatting'],1),
('email-management','Email Management','A tidier inbox and fewer missed messages.',array['Inbox organisation','Sorting and labelling','Draft replies for your approval','Tracking of important messages and follow-ups'],2),
('calendar-scheduling','Calendar and Scheduling Management','A calendar that reflects your priorities.',array['Organised calendars','Appointment scheduling','Meeting coordination','Reminders and schedule updates'],3),
('data-entry-records','Data Entry and Record Management','Accurate, clean and up-to-date information.',array['Entering and updating information','Spreadsheet maintenance','Error and duplicate checks','Organised business information'],4),
('document-preparation','Document Preparation','Consistent, professional-looking documents.',array['Document formatting','Meeting notes','Organised reports and files','Consistent layouts'],5),
('customer-support','Customer Support Assistance','Organised handling of customer enquiries through agreed channels.',array['Responses via agreed channels','Organised incoming requests','Enquiry records','Follow-up tracking and escalation'],6),
('business-admin-assistance','General Business Administrative Assistance','Flexible help with everyday business operations.',array['Task tracking','Administrative checklists','Basic operational coordination','Support for routine processes'],7)
on conflict do nothing;

insert into public.portfolio_categories (name,slug,sort_order) values
('Administrative Support','administrative-support',1),('Email Management','email-management',2),
('Calendar Management','calendar-management',3),('Data Entry','data-entry',4),
('Spreadsheet Organization','spreadsheet-organization',5),('Document Preparation','document-preparation',6),
('Customer Support','customer-support',7) on conflict do nothing;

insert into public.blog_categories (name,slug) values
('Productivity','productivity'),('Email & Calendar','email-calendar'),('Data & Documents','data-documents') on conflict do nothing;

insert into public.site_settings (key,value) values
('hero_headline','Reliable administrative support, so you can focus on your business'),
('hero_intro','I help entrepreneurs, small businesses and remote teams stay organised with email, scheduling, records and documents.'),
('footer_text','Remote administrative support for local and international clients.'),
('contact_email','akinolagod10@gmail.com')
on conflict do nothing;

-- AFTER creating your admin login (see README), authorise it with:
-- insert into public.admin_users (user_id) select id from auth.users where email = 'akinolagod10@gmail.com';
