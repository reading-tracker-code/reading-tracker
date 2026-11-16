-- Benutzername: Anmeldung mit Benutzername oder E-Mail, automatische Erkennung neuer Nutzer.
-- Im Supabase-SQL-Editor einmal komplett ausführen (New query -> einfügen -> Run).
alter table public.profiles add column if not exists username text check (username is null or username ~ '^[A-Za-z0-9_.-]{3,20}$');
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- Neue Konten: Benutzername aus der Registrierung übernehmen (wenn gültig und frei).
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare u text := nullif(btrim(new.raw_user_meta_data ->> 'username'), '');
begin
  if u is not null and (u !~ '^[A-Za-z0-9_.-]{3,20}$' or exists (select 1 from public.profiles where lower(username) = lower(u))) then u := null; end if;
  insert into public.profiles (id, display_name, username) values (new.id, coalesce(u, split_part(new.email, '@', 1)), u) on conflict do nothing;
  return new;
end $$;

-- Gibt es schon ein Konto mit dieser E-Mail oder diesem Benutzernamen? ('exists' oder 'new')
create or replace function public.auth_identify(p_ident text) returns text language plpgsql stable security definer set search_path = public, auth as $$
declare i text := lower(btrim(coalesce(p_ident, '')));
begin
  if i = '' then return 'new'; end if;
  if exists (select 1 from auth.users where lower(email) = i) or exists (select 1 from public.profiles where lower(username) = i) then return 'exists'; end if;
  return 'new';
end $$;

-- E-Mail zu einem Benutzernamen (für die Anmeldung und das Zurücksetzen des Passworts).
create or replace function public.auth_login_email(p_ident text) returns text language sql stable security definer set search_path = public, auth as $$
  select u.email::text from public.profiles p join auth.users u on u.id = p.id where lower(p.username) = lower(btrim(coalesce(p_ident, ''))) limit 1
$$;

-- Ist der Benutzername noch frei?
create or replace function public.username_free(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(btrim(coalesce(p_name, ''))))
$$;

do $$ declare f text; begin
  foreach f in array array['auth_identify(text)', 'auth_login_email(text)', 'username_free(text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
notify pgrst, 'reload schema';
