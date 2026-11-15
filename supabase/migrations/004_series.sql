-- Serien und Reihen: zwei neue Felder an den Büchern.
-- Im Supabase-SQL-Editor einmal komplett ausführen (New query -> einfügen -> Run).
alter table public.books add column if not exists series_name text;
alter table public.books add column if not exists series_number numeric check (series_number is null or series_number > 0);
create index if not exists books_series_idx on public.books (user_id, series_name);
notify pgrst, 'reload schema';
