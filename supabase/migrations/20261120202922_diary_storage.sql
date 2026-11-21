create table public.diary_days (
    owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
    id text not null check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
    summary jsonb not null check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 360000),
    revision uuid not null,
    parts integer not null check (parts between 1 and 19),
    primary key (owner, id)
);

alter table public.diary_days enable row level security;
revoke all on public.diary_days from anon, authenticated;
grant select, insert, update, delete on public.diary_days to authenticated;

create policy "Read own days" on public.diary_days for select to authenticated using ((select auth.uid()) = owner);
create policy "Create own days" on public.diary_days for insert to authenticated with check ((select auth.uid()) = owner);
create policy "Edit own days" on public.diary_days for update to authenticated
    using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "Delete own days" on public.diary_days for delete to authenticated using ((select auth.uid()) = owner);

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('diary-copies', 'diary-copies', false, array['application/json'], 4194304);

create policy "Read own copies" on storage.objects for select to authenticated
    using (bucket_id = 'diary-copies' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Upload own copies" on storage.objects for insert to authenticated
    with check (bucket_id = 'diary-copies' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Delete own copies" on storage.objects for delete to authenticated
    using (bucket_id = 'diary-copies' and (storage.foldername(name))[1] = (select auth.uid())::text);
