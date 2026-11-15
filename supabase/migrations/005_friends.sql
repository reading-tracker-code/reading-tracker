-- Freunde: Freundes-Anfragen, Datenschutz-Einstellungen, Freundes-Challenges und gemeinsame Ziele.
-- Im Supabase-SQL-Editor einmal komplett ausführen (New query -> einfügen -> Run).
-- Datenschutz-Prinzip: Freunde lesen NIE direkt aus deinen Tabellen (Bücher, Sessions, Ziele bleiben privat).
-- Sie sehen nur eine kleine Zusammenfassung (friend_stats), die der Server anhand deiner Einstellungen filtert.
create extension if not exists pgcrypto;

-- ---------- Tabellen ----------
create table public.friend_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 30),
  friend_code text not null unique,
  allow_requests boolean not null default true,
  allow_challenges boolean not null default true,
  share_level boolean not null default true,
  share_streak boolean not null default true,
  share_week boolean not null default true,
  share_year_books boolean not null default true,
  share_totals boolean not null default false,
  share_current_book boolean not null default false,
  created_at timestamptz not null default now());

create table public.friend_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 4096),
  updated_at timestamptz not null default now());

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id));
create unique index friendships_pair on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index on public.friendships (requester_id, status);
create index on public.friendships (addressee_id, status);

create table public.friend_challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  kind text not null check (kind in ('versus','shared')),
  metric text not null check (metric in ('pages','minutes','days','books')),
  target numeric check (target is null or target > 0),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (kind <> 'shared' or target is not null));
create index on public.friend_challenges (creator_id);

create table public.challenge_members (
  challenge_id uuid not null references public.friend_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','joined')),
  progress numeric not null default 0 check (progress >= 0),
  progress_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id));
create index on public.challenge_members (user_id);

-- ---------- Zugriffsregeln (RLS) ----------
alter table public.friend_settings enable row level security;
alter table public.friend_stats enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_challenges enable row level security;
alter table public.challenge_members enable row level security;

-- Eigene Einstellungen: lesen und (nur bestimmte Spalten) ändern. Anlegen/Löschen laufen über Funktionen.
create policy fs_sel on public.friend_settings for select using (auth.uid() = user_id);
create policy fs_upd on public.friend_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.friend_settings from anon;
revoke update on public.friend_settings from authenticated;
grant update (nickname, allow_requests, allow_challenges, share_level, share_streak, share_week, share_year_books, share_totals, share_current_book) on public.friend_settings to authenticated;

-- Eigene Zusammenfassung: nur du selbst kannst sie lesen und schreiben. Freunde bekommen sie nur gefiltert über friends_overview().
create policy fst_sel on public.friend_stats for select using (auth.uid() = user_id);
create policy fst_ins on public.friend_stats for insert with check (auth.uid() = user_id);
create policy fst_upd on public.friend_stats for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy fst_del on public.friend_stats for delete using (auth.uid() = user_id);
revoke all on public.friend_stats from anon;

-- Freundschaften und Challenges: nur über die Funktionen unten (keine direkte Tabellen-Policy => kein direkter Zugriff).
create policy fr_sel on public.friendships for select using (auth.uid() in (requester_id, addressee_id));
revoke all on public.friendships, public.friend_challenges, public.challenge_members from anon;
revoke insert, update, delete on public.friendships from authenticated;
revoke all on public.friend_challenges, public.challenge_members from authenticated;

-- ---------- Funktionen ----------
create or replace function public.gen_friend_code() returns text language plpgsql volatile set search_path = public, extensions as $$
declare chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..8 loop c := c || substr(chars, 1 + (get_byte(gen_random_bytes(1), 0) % length(chars)), 1); end loop;
    exit when not exists (select 1 from public.friend_settings where friend_code = c);
  end loop;
  return c;
end $$;

-- Freundes-Funktion einschalten: legt Einstellungen und persönlichen Freundes-Code an.
create or replace function public.friend_enable(p_nickname text) returns text language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); c text;
begin
  if me is null then raise exception 'Bitte melde dich an.'; end if;
  select friend_code into c from public.friend_settings where user_id = me;
  if c is not null then return c; end if;
  if char_length(btrim(coalesce(p_nickname, ''))) not between 2 and 30 then raise exception 'Der Name muss 2 bis 30 Zeichen lang sein.'; end if;
  insert into public.friend_settings (user_id, nickname, friend_code) values (me, btrim(p_nickname), public.gen_friend_code()) returning friend_code into c;
  return c;
end $$;

create or replace function public.friend_new_code() returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text := public.gen_friend_code();
begin
  update public.friend_settings set friend_code = c where user_id = auth.uid();
  return c;
end $$;

-- Freundes-Funktion ausschalten und alle Freundesdaten löschen.
create or replace function public.friend_disable() returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  delete from public.friend_challenges where creator_id = me;
  delete from public.challenge_members where user_id = me;
  delete from public.friendships where me in (requester_id, addressee_id);
  delete from public.friend_stats where user_id = me;
  delete from public.friend_settings where user_id = me;
end $$;

-- Anfrage per Freundes-Code senden. Antworten: sent, accepted, already_friends, already_sent, not_found, self, not_enabled, too_many
create or replace function public.send_friend_request(p_code text) returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t uuid; ex public.friendships;
begin
  if me is null then return 'auth'; end if;
  if not exists (select 1 from public.friend_settings where user_id = me) then return 'not_enabled'; end if;
  select user_id into t from public.friend_settings where friend_code = upper(btrim(coalesce(p_code, ''))) and allow_requests;
  if t is null then return 'not_found'; end if;
  if t = me then return 'self'; end if;
  select * into ex from public.friendships where (requester_id = me and addressee_id = t) or (requester_id = t and addressee_id = me);
  if found then
    if ex.status = 'accepted' then return 'already_friends'; end if;
    if ex.requester_id = t then update public.friendships set status = 'accepted', responded_at = now() where id = ex.id; return 'accepted'; end if;
    return 'already_sent';
  end if;
  if (select count(*) from public.friendships where requester_id = me and status = 'pending') >= 30 then return 'too_many'; end if;
  insert into public.friendships (requester_id, addressee_id) values (me, t);
  return 'sent';
end $$;

create or replace function public.friend_respond(p_id uuid, p_accept boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_accept then update public.friendships set status = 'accepted', responded_at = now() where id = p_id and addressee_id = auth.uid() and status = 'pending';
  else delete from public.friendships where id = p_id and addressee_id = auth.uid() and status = 'pending'; end if;
end $$;

-- Freund entfernen bzw. eigene Anfrage zurückziehen
create or replace function public.friend_remove(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.friendships where id = p_id and auth.uid() in (requester_id, addressee_id);
end $$;

-- Übersicht: Anfragen und Freunde. Die Werte der Freunde werden hier nach deren Datenschutz-Einstellungen gefiltert.
create or replace function public.friends_overview()
returns table (friendship_id uuid, other_id uuid, nickname text, state text, since timestamptz, stats jsonb)
language sql stable security definer set search_path = public as $$
  select f.id, o.id, coalesce(os.nickname, 'Leser*in'),
    case when f.status = 'accepted' then 'friend' when f.addressee_id = auth.uid() then 'incoming' else 'outgoing' end,
    coalesce(f.responded_at, f.created_at),
    case when f.status = 'accepted' and st.user_id is not null then jsonb_strip_nulls(jsonb_build_object(
      'updated_at', st.data -> 'updated_at',
      'level', case when os.share_level then st.data -> 'level' end,
      'title', case when os.share_level then st.data -> 'title' end,
      'xp', case when os.share_level then st.data -> 'xp' end,
      'streak', case when os.share_streak then st.data -> 'streak' end,
      'week_pages', case when os.share_week then st.data -> 'week_pages' end,
      'week_minutes', case when os.share_week then st.data -> 'week_minutes' end,
      'week_days', case when os.share_week then st.data -> 'week_days' end,
      'year_books', case when os.share_year_books then st.data -> 'year_books' end,
      'total_pages', case when os.share_totals then st.data -> 'total_pages' end,
      'current_book', case when os.share_current_book then st.data -> 'current_book' end)) end
  from public.friendships f
  cross join lateral (select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as id) o
  left join public.friend_settings os on os.user_id = o.id
  left join public.friend_stats st on st.user_id = o.id
  where auth.uid() in (f.requester_id, f.addressee_id)
$$;

-- Challenge erstellen und Freunde einladen. kind: versus (Wettbewerb) oder shared (gemeinsames Ziel). metric: pages, minutes, days, books.
create or replace function public.create_challenge(p_title text, p_kind text, p_metric text, p_target numeric, p_start date, p_end date, p_invitees uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid; u uuid; n int := 0;
begin
  if me is null or not exists (select 1 from public.friend_settings where user_id = me) then raise exception 'Bitte aktiviere zuerst die Freundes-Funktion.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 60 then raise exception 'Der Titel muss 1 bis 60 Zeichen lang sein.'; end if;
  if p_kind not in ('versus', 'shared') or p_metric not in ('pages', 'minutes', 'days', 'books') then raise exception 'Ungültige Challenge-Art.'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365 then raise exception 'Der Zeitraum ist ungültig (höchstens 366 Tage).'; end if;
  if p_kind = 'shared' and (p_target is null or p_target <= 0) then raise exception 'Ein gemeinsames Ziel braucht einen Zielwert.'; end if;
  if coalesce(array_length(p_invitees, 1), 0) > 20 then raise exception 'Du kannst höchstens 20 Personen einladen.'; end if;
  if (select count(*) from public.friend_challenges where creator_id = me and end_date >= current_date) >= 20 then raise exception 'Du hast bereits 20 aktive Challenges.'; end if;
  insert into public.friend_challenges (creator_id, title, kind, metric, target, start_date, end_date)
    values (me, btrim(p_title), p_kind, p_metric, case when p_kind = 'shared' then p_target end, p_start, p_end) returning id into cid;
  insert into public.challenge_members (challenge_id, user_id, status) values (cid, me, 'joined');
  foreach u in array coalesce(p_invitees, '{}'::uuid[]) loop
    if exists (select 1 from public.friendships f where f.status = 'accepted' and ((f.requester_id = me and f.addressee_id = u) or (f.requester_id = u and f.addressee_id = me)))
       and exists (select 1 from public.friend_settings s where s.user_id = u and s.allow_challenges) then
      insert into public.challenge_members (challenge_id, user_id, status) values (cid, u, 'invited') on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  if n = 0 then raise exception 'Keine der gewählten Personen kann eingeladen werden (Challenge-Einladungen sind evtl. ausgeschaltet).'; end if;
  return cid;
end $$;

create or replace function public.challenge_respond(p_id uuid, p_accept boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_accept then update public.challenge_members set status = 'joined' where challenge_id = p_id and user_id = auth.uid() and status = 'invited';
  else delete from public.challenge_members where challenge_id = p_id and user_id = auth.uid() and status = 'invited'; end if;
end $$;

-- Ersteller: Challenge für alle löschen. Andere: austreten.
create or replace function public.challenge_leave(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.friend_challenges where id = p_id and creator_id = auth.uid()) then delete from public.friend_challenges where id = p_id;
  else delete from public.challenge_members where challenge_id = p_id and user_id = auth.uid(); end if;
end $$;

-- Eigenen Fortschritt melden (bis 2 Tage nach Ende; danach ist das Ergebnis eingefroren).
create or replace function public.challenge_progress(p_id uuid, p_value numeric) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.challenge_members m set progress = greatest(0, least(coalesce(p_value, 0), 1000000)), progress_at = now()
  from public.friend_challenges c
  where c.id = m.challenge_id and m.challenge_id = p_id and m.user_id = auth.uid() and m.status = 'joined' and current_date <= c.end_date + 2;
end $$;

-- Meine Challenges samt Mitgliedern. Eingeladene sehen erst nach dem Beitritt, wie die anderen liegen.
create or replace function public.challenges_overview() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(q.j order by q.e desc), '[]'::jsonb) from (
    select c.end_date as e, jsonb_build_object(
      'id', c.id, 'title', c.title, 'kind', c.kind, 'metric', c.metric, 'target', c.target,
      'start_date', c.start_date, 'end_date', c.end_date, 'creator_id', c.creator_id, 'my_status', me.status,
      'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nickname', coalesce(s.nickname, 'Leser*in'), 'status', m.status,
                    'progress', case when m.status = 'joined' and me.status = 'joined' then m.progress end, 'progress_at', m.progress_at) order by m.created_at), '[]'::jsonb)
                  from public.challenge_members m left join public.friend_settings s on s.user_id = m.user_id
                  where m.challenge_id = c.id and (me.status = 'joined' or m.user_id = auth.uid() or m.user_id = c.creator_id))) as j
    from public.friend_challenges c join public.challenge_members me on me.challenge_id = c.id and me.user_id = auth.uid()
  ) q
$$;

-- Nur angemeldete Nutzer dürfen die Funktionen aufrufen.
do $$ declare f text; begin
  foreach f in array array[
    'friend_enable(text)', 'friend_new_code()', 'friend_disable()', 'send_friend_request(text)', 'friend_respond(uuid,boolean)', 'friend_remove(uuid)', 'friends_overview()',
    'create_challenge(text,text,text,numeric,date,date,uuid[])', 'challenge_respond(uuid,boolean)', 'challenge_leave(uuid)', 'challenge_progress(uuid,numeric)', 'challenges_overview()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.gen_friend_code() from public, anon, authenticated;
end $$;

notify pgrst, 'reload schema';
