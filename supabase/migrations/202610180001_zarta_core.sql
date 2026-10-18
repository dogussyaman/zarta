create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Oyuncu' check (char_length(display_name) between 2 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  host_id uuid not null references public.profiles(id),
  status text not null default 'lobby' check (status in ('lobby', 'countdown', 'answering', 'results', 'finished', 'closed')),
  current_round integer not null default 0,
  countdown_ends_at timestamptz,
  total_rounds integer not null default 5 check (total_rounds between 3 and 10),
  question_seconds integer not null default 20 check (question_seconds between 10 and 60),
  categories text[] not null default array['Genel kültür'],
  created_at timestamptz not null default now()
);

create table if not exists public.room_players (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null default 0,
  is_ready boolean not null default false,
  is_connected boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option smallint not null check (correct_option between 0 and 3),
  difficulty text not null check (difficulty in ('Kolay', 'Orta', 'Zor')),
  is_active boolean not null default true
);

create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  round_number integer not null check (round_number > 0),
  phase text not null check (phase in ('answering', 'results')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  resolved_at timestamptz,
  unique (room_id, round_number)
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  selected_option smallint not null check (selected_option between 0 and 3),
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  unique (round_id, player_id),
  foreign key (room_id, player_id) references public.room_players(room_id, user_id)
);

create table if not exists public.game_actions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  round_id uuid references public.game_rounds(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  action_type text not null check (action_type in ('ability', 'zarta')),
  ability_key text check (ability_key in ('shield', 'block', 'retaliation', 'joker')),
  target_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  voter_id uuid not null references public.profiles(id),
  target_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (round_id, voter_id),
  check (voter_id <> target_id)
);

create table if not exists public.player_abilities (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  ability_key text not null check (ability_key in ('shield', 'block', 'retaliation', 'joker')),
  remaining integer not null default 1 check (remaining >= 0),
  primary key (room_id, player_id, ability_key)
);

create table if not exists public.game_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.game_rooms add column if not exists countdown_ends_at timestamptz;
alter table public.game_rooms drop constraint if exists game_rooms_status_check;
alter table public.game_rooms add constraint game_rooms_status_check
  check (status in ('lobby', 'countdown', 'answering', 'results', 'finished', 'closed'));

create index if not exists room_players_user_active_idx on public.room_players(user_id, left_at);
create index if not exists game_rounds_due_idx on public.game_rounds(phase, ends_at);
create index if not exists answers_round_idx on public.answers(round_id);
create index if not exists game_events_room_id_idx on public.game_events(room_id, id desc);
create index if not exists questions_category_idx on public.questions(category) where is_active;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players rp
    where rp.room_id = p_room_id and rp.user_id = auth.uid() and rp.left_at is null
  );
$$;

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(left(new.raw_user_meta_data ->> 'display_name', 24), ''), 'Oyuncu'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();

alter table public.profiles enable row level security;
alter table public.game_rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.questions enable row level security;
alter table public.game_rounds enable row level security;
alter table public.answers enable row level security;
alter table public.game_actions enable row level security;
alter table public.votes enable row level security;
alter table public.player_abilities enable row level security;
alter table public.game_events enable row level security;

drop policy if exists "Players can read their own profile" on public.profiles;
create policy "Players can read their own profile"
  on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "Room members can read room rows" on public.game_rooms;
create policy "Room members can read room rows"
  on public.game_rooms for select to authenticated
  using (public.is_room_member(id));
drop policy if exists "Room members can read player list" on public.room_players;
create policy "Room members can read player list"
  on public.room_players for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists "Room members can receive safe event notifications" on public.game_events;
create policy "Room members can receive safe event notifications"
  on public.game_events for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists "Room members can receive room broadcasts and presence" on realtime.messages;
create policy "Room members can receive room broadcasts and presence"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.room_players rp
      where rp.user_id = (select auth.uid()) and rp.left_at is null
        and (select realtime.topic()) = 'room:' || rp.room_id::text
    )
  );
drop policy if exists "Room members can send room broadcasts and presence" on realtime.messages;
create policy "Room members can send room broadcasts and presence"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.room_players rp
      where rp.user_id = (select auth.uid()) and rp.left_at is null
        and (select realtime.topic()) = 'room:' || rp.room_id::text
    )
  );

revoke all on public.questions, public.answers, public.game_rounds, public.game_actions, public.votes,
  public.player_abilities, public.game_events, public.game_rooms, public.room_players, public.profiles
  from anon, authenticated;
grant select on public.game_rooms, public.room_players, public.game_events, public.profiles to authenticated;

create or replace function public.set_display_name(p_display_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(p_display_name);
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 24 then
    raise exception 'İsim 2-24 karakter arasında olmalı.';
  end if;
  insert into public.profiles (id, display_name) values (v_user, v_name)
  on conflict (id) do update set display_name = excluded.display_name;
  return true;
end;
$$;

create or replace function public.create_room(
  p_display_name text,
  p_total_rounds integer default 5,
  p_question_seconds integer default 20,
  p_categories text[] default array['Genel kültür']
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_code text;
  v_i integer;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  if p_total_rounds not between 3 and 10 or p_question_seconds not between 10 and 60 then
    raise exception 'Oyun ayarları geçersiz.';
  end if;
  if cardinality(p_categories) = 0 or exists (
    select 1 from unnest(p_categories) c where c not in (
      'Genel kültür', 'Hayvanlar âlemi', 'Moda ve stil', 'Film ve dizi', 'Müzik',
      'Bilim ve teknoloji', 'Tarih ve coğrafya', 'Spor', 'Yemek ve lezzet'
    )
  ) then raise exception 'Kategori seçimi geçersiz.'; end if;
  insert into public.profiles (id, display_name)
  values (v_user, btrim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name;
  perform public.leave_room();
  loop
    v_code := '';
    for v_i in 1..6 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.game_rooms where code = v_code);
  end loop;
  insert into public.game_rooms (code, host_id, total_rounds, question_seconds, categories)
  values (v_code, v_user, p_total_rounds, p_question_seconds, p_categories)
  returning * into v_room;
  insert into public.room_players (room_id, user_id, is_ready) values (v_room.id, v_user, true);
  insert into public.player_abilities (room_id, player_id, ability_key)
  select v_room.id, v_user, k from unnest(array['shield','block','retaliation','joker']) k;
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'player_joined', jsonb_build_object('user_id', v_user));
  return v_code;
end;
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_count integer;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  if char_length(btrim(p_display_name)) < 2 or char_length(btrim(p_display_name)) > 24 then
    raise exception 'İsim 2-24 karakter arasında olmalı.';
  end if;
  select * into v_room from public.game_rooms where code = upper(btrim(p_code)) and status = 'lobby' for update;
  if not found then raise exception 'Oda bulunamadı veya oyun başlamış.'; end if;
  insert into public.profiles (id, display_name) values (v_user, btrim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name;
  select count(*) into v_count from public.room_players where room_id = v_room.id and left_at is null;
  if v_count >= 10 and not exists (
    select 1 from public.room_players where room_id = v_room.id and user_id = v_user and left_at is null
  ) then raise exception 'Oda dolu (en fazla 10 oyuncu).'; end if;
  if exists (select 1 from public.room_players where user_id = v_user and left_at is null and room_id <> v_room.id) then
    perform public.leave_room();
  end if;
  insert into public.room_players (room_id, user_id, is_ready)
  values (v_room.id, v_user, false)
  on conflict (room_id, user_id) do update set left_at = null, is_ready = false, is_connected = true, joined_at = now();
  insert into public.player_abilities (room_id, player_id, ability_key)
  select v_room.id, v_user, k from unnest(array['shield','block','retaliation','joker']) k
  on conflict (room_id, player_id, ability_key) do nothing;
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'player_joined', jsonb_build_object('user_id', v_user));
  return v_room.id;
end;
$$;

create or replace function public.set_ready(p_ready boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room uuid;
begin
  select rp.room_id into v_room from public.room_players rp
  join public.game_rooms gr on gr.id = rp.room_id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'lobby' limit 1;
  if v_room is null then raise exception 'Lobide değilsin.'; end if;
  update public.room_players set is_ready = p_ready, is_connected = true
  where room_id = v_room and user_id = v_user and left_at is null;
  insert into public.game_events (room_id, event_type, payload)
  values (v_room, 'player_ready', jsonb_build_object('user_id', v_user, 'ready', p_ready));
  return true;
end;
$$;

create or replace function public.start_game()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_question public.questions%rowtype;
begin
  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'lobby'
  for update of gr;
  if not found or v_room.host_id <> v_user then raise exception 'Yalnızca oda sahibi oyunu başlatabilir.'; end if;
  if (select count(*) from public.room_players where room_id = v_room.id and left_at is null) < 2
    or exists (select 1 from public.room_players where room_id = v_room.id and left_at is null and not is_ready) then
    raise exception 'En az 2 oyuncu olmalı ve herkes hazır olmalı.';
  end if;
  select * into v_question from public.questions
  where is_active and category = any(v_room.categories) order by random() limit 1;
  if not found then raise exception 'Seçili kategorilerde soru yok. Migration seed verilerini yükleyin.'; end if;
  update public.game_rooms set status = 'countdown', current_round = 0,
    countdown_ends_at = now() + interval '3 seconds' where id = v_room.id;
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'countdown_started', jsonb_build_object('seconds', 3));
  return true;
end;
$$;

create or replace function public.submit_answer(p_round_number integer, p_option smallint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_round public.game_rounds%rowtype;
  v_correct smallint;
  v_old public.answers%rowtype;
begin
  if p_option not between 0 and 3 then raise exception 'Cevap seçeneği geçersiz.'; end if;
  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'answering' for update of gr;
  if not found then raise exception 'Aktif bir oyun bulunamadı.'; end if;
  select * into v_round from public.game_rounds
  where room_id = v_room.id and round_number = p_round_number and phase = 'answering' for update;
  if not found or v_round.ends_at <= now() then raise exception 'Cevaplama süresi doldu.'; end if;
  select correct_option into v_correct from public.questions where id = v_round.question_id;
  select * into v_old from public.answers where round_id = v_round.id and player_id = v_user;
  if found then
    if exists (select 1 from public.game_actions where round_id = v_round.id and player_id = v_user
      and action_type = 'ability' and ability_key = 'joker') then
      update public.answers set selected_option = p_option, is_correct = (p_option = v_correct), answered_at = now()
      where id = v_old.id;
      delete from public.game_actions where round_id = v_round.id and player_id = v_user
        and action_type = 'ability' and ability_key = 'joker';
    elsif v_old.selected_option = p_option then return true;
    else raise exception 'Bu turda zaten cevap verdin.'; end if;
  else
    insert into public.answers (room_id, round_id, player_id, selected_option, is_correct)
    values (v_room.id, v_round.id, v_user, p_option, p_option = v_correct);
  end if;
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'answer_submitted', jsonb_build_object('user_id', v_user, 'round', p_round_number));
  return true;
end;
$$;

create or replace function public.use_ability(p_ability text, p_target_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_round public.game_rounds%rowtype;
begin
  if p_ability not in ('shield', 'block', 'retaliation', 'joker') then raise exception 'Yetenek geçersiz.'; end if;
  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'answering' for update of gr;
  if not found then raise exception 'Yetenek yalnızca cevaplama turunda kullanılabilir.'; end if;
  select * into v_round from public.game_rounds where room_id = v_room.id and phase = 'answering';
  if v_round.ends_at <= now() then raise exception 'Turun süresi doldu.'; end if;
  if p_ability = 'joker' and not exists (
    select 1 from public.answers where round_id = v_round.id and player_id = v_user
  ) then raise exception 'Jokeri kullanmak için önce bir cevap vermelisin.'; end if;
  if p_ability in ('shield', 'block', 'retaliation') and exists (
    select 1 from public.game_actions where round_id = v_round.id and player_id = v_user
      and action_type = 'ability' and ability_key in ('shield', 'block', 'retaliation')
  ) then raise exception 'Bu turda zaten bir savunma yeteneği kullandın.'; end if;
  update public.player_abilities set remaining = remaining - 1
  where room_id = v_room.id and player_id = v_user and ability_key = p_ability and remaining > 0;
  if not found then raise exception 'Bu yetenek hakkın kalmadı.'; end if;
  insert into public.game_actions (room_id, round_id, player_id, action_type, ability_key, target_id)
  values (v_room.id, v_round.id, v_user, 'ability', p_ability, p_target_id);
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'ability_used', jsonb_build_object('user_id', v_user, 'ability', p_ability));
  return true;
end;
$$;

create unique index if not exists one_zarta_per_player_per_round
  on public.game_actions(round_id, player_id) where action_type = 'zarta';

create or replace function public.cast_vote(p_round_number integer, p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_round public.game_rounds%rowtype;
begin
  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'results' for update of gr;
  if not found then raise exception 'Oylama yalnızca tur sonuçlarında yapılabilir.'; end if;
  select * into v_round from public.game_rounds where room_id = v_room.id
    and round_number = p_round_number and phase = 'results';
  if not found or v_round.resolved_at + interval '8 seconds' <= now() then
    raise exception 'Oylama süresi doldu.';
  end if;
  if p_target_id = v_user or not exists (
    select 1 from public.room_players where room_id = v_room.id and user_id = p_target_id and left_at is null
  ) then raise exception 'Hedef oyuncu geçersiz.'; end if;
  insert into public.votes (room_id, round_id, voter_id, target_id)
  values (v_room.id, v_round.id, v_user, p_target_id);
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'vote_cast', jsonb_build_object('user_id', v_user, 'round', p_round_number));
  return true;
exception when unique_violation then
  raise exception 'Bu turda zaten oy kullandın.';
end;
$$;

create or replace function public.resolve_round_zarta(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
  v_attacker uuid;
  v_votes integer;
  v_blocked boolean;
  v_retaliates boolean;
begin
  select ballot.target_id, count(*)
  into v_target, v_votes
  from public.votes ballot
  where ballot.round_id = p_round_id
  group by ballot.target_id
  order by count(*) desc, min(ballot.created_at), ballot.target_id
  limit 1;
  if v_target is null then return; end if;
  select ballot.voter_id into v_attacker from public.votes ballot
  where ballot.round_id = p_round_id and ballot.target_id = v_target
  order by ballot.created_at, ballot.voter_id limit 1;
  select exists (select 1 from public.game_actions where round_id = p_round_id and player_id = v_target
    and action_type = 'ability' and ability_key in ('shield', 'block')) into v_blocked;
  select exists (select 1 from public.game_actions where round_id = p_round_id and player_id = v_target
    and action_type = 'ability' and ability_key = 'retaliation') into v_retaliates;
  if v_blocked then
    delete from public.game_actions where round_id = p_round_id and player_id = v_target
      and action_type = 'ability' and ability_key in ('shield', 'block');
  else
    update public.room_players set score = score - 50 where room_id = p_room_id and user_id = v_target;
    if v_retaliates then
      update public.room_players set score = score - 50 where room_id = p_room_id and user_id = v_attacker;
      delete from public.game_actions where round_id = p_round_id and player_id = v_target
        and action_type = 'ability' and ability_key = 'retaliation';
    end if;
  end if;
  insert into public.game_actions (room_id, round_id, player_id, action_type, target_id)
  values (p_room_id, p_round_id, v_attacker, 'zarta', v_target);
  insert into public.game_events (room_id, event_type, payload)
  values (p_room_id, 'zarta_resolved', jsonb_build_object(
    'target_id', v_target, 'blocked', v_blocked, 'vote_count', v_votes
  ));
end;
$$;

create or replace function public.tick_expired_rounds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_countdown record;
  v_round record;
  v_room public.game_rooms%rowtype;
  v_question public.questions%rowtype;
  v_count integer := 0;
begin
  for v_countdown in
    select gr.id, gr.question_seconds, gr.categories
    from public.game_rooms gr
    where gr.status = 'countdown' and gr.countdown_ends_at <= now()
    for update of gr skip locked
  loop
    select * into v_question from public.questions
    where is_active and category = any(v_countdown.categories)
    order by random() limit 1;
    if found then
      insert into public.game_rounds (room_id, question_id, round_number, phase, ends_at)
      values (v_countdown.id, v_question.id, 1, 'answering',
        now() + make_interval(secs => v_countdown.question_seconds));
      update public.game_rooms set status = 'answering', current_round = 1, countdown_ends_at = null
      where id = v_countdown.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_countdown.id, 'question_opened', jsonb_build_object('round', 1));
    else
      update public.game_rooms set status = 'finished', countdown_ends_at = null
      where id = v_countdown.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_countdown.id, 'game_finished', jsonb_build_object('reason', 'no_questions'));
    end if;
    v_count := v_count + 1;
  end loop;
  for v_round in
    select r.id, r.room_id, r.round_number, r.phase, r.ends_at, r.resolved_at
    from public.game_rounds r
    join public.game_rooms gr on gr.id = r.room_id
    where (r.phase = 'answering' and r.ends_at <= now())
      or (r.phase = 'results' and r.resolved_at <= now() - interval '8 seconds')
    order by r.ends_at
    for update of r skip locked
  loop
    select * into v_room from public.game_rooms where id = v_round.room_id for update;
    if v_round.phase = 'answering' then
      update public.game_rounds set phase = 'results', resolved_at = now() where id = v_round.id;
      update public.game_rooms set status = 'results' where id = v_room.id;
      update public.room_players rp set score = score + 100
      from public.answers a where a.round_id = v_round.id and a.player_id = rp.user_id
        and a.room_id = rp.room_id and a.is_correct;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'results_revealed', jsonb_build_object('round', v_round.round_number));
    elsif v_round.round_number >= v_room.total_rounds then
      perform public.resolve_round_zarta(v_room.id, v_round.id);
      update public.game_rooms set status = 'finished' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'game_finished', jsonb_build_object('round', v_round.round_number));
    else
      perform public.resolve_round_zarta(v_room.id, v_round.id);
      select * into v_question from public.questions
      where is_active and category = any(v_room.categories)
        and not exists (
          select 1 from public.game_rounds played
          where played.room_id = v_room.id and played.question_id = questions.id
        )
      order by random() limit 1;
      if not found then
        select * into v_question from public.questions
        where is_active and category = any(v_room.categories)
        order by random() limit 1;
      end if;
      if not found then
        update public.game_rooms set status = 'finished' where id = v_room.id;
        insert into public.game_events (room_id, event_type, payload)
        values (v_room.id, 'game_finished', jsonb_build_object('reason', 'no_questions'));
      else
        insert into public.game_rounds (room_id, question_id, round_number, phase, ends_at)
        values (v_room.id, v_question.id, v_round.round_number + 1, 'answering',
          now() + make_interval(secs => v_room.question_seconds));
        update public.game_rooms set status = 'answering', current_round = v_round.round_number + 1 where id = v_room.id;
        insert into public.game_events (room_id, event_type, payload)
        values (v_room.id, 'round_started', jsonb_build_object('round', v_round.round_number + 1));
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.get_room_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_round public.game_rounds%rowtype;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  perform public.tick_expired_rounds();
  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status <> 'closed'
  order by rp.joined_at desc limit 1;
  if not found then return null; end if;
  select * into v_round from public.game_rounds
  where room_id = v_room.id and round_number = v_room.current_round;
  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'status', v_room.status, 'host_id', v_room.host_id,
      'current_round', v_room.current_round, 'countdown_ends_at', v_room.countdown_ends_at,
      'total_rounds', v_room.total_rounds,
      'question_seconds', v_room.question_seconds, 'categories', v_room.categories
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', rp.user_id, 'display_name', p.display_name, 'score', rp.score,
        'is_ready', rp.is_ready, 'is_connected', rp.is_connected, 'is_host', (rp.user_id = v_room.host_id),
        'abilities', coalesce((select jsonb_object_agg(pa.ability_key, pa.remaining)
          from public.player_abilities pa where pa.room_id = v_room.id and pa.player_id = rp.user_id), '{}'::jsonb)
      ) order by rp.score desc, rp.joined_at)
      from public.room_players rp join public.profiles p on p.id = rp.user_id
      where rp.room_id = v_room.id and rp.left_at is null
    ), '[]'::jsonb),
    'round', case when v_round.id is null then null else jsonb_build_object(
      'round_number', v_round.round_number, 'phase', v_round.phase,
      'starts_at', v_round.starts_at, 'ends_at', v_round.ends_at,
      'question', (select jsonb_build_object(
        'id', q.id, 'category', q.category, 'prompt', q.prompt, 'options', q.options, 'difficulty', q.difficulty
      ) from public.questions q where q.id = v_round.question_id),
      'my_answer', (select a.selected_option from public.answers a where a.round_id = v_round.id and a.player_id = v_user),
      'my_vote', (select ballot.target_id from public.votes ballot where ballot.round_id = v_round.id and ballot.voter_id = v_user),
      'revealed_answer', case when v_round.phase = 'results' or v_room.status = 'finished'
        then (select q.correct_option from public.questions q where q.id = v_round.question_id) else null end,
      'answer_summary', case when v_round.phase = 'results' or v_room.status = 'finished'
        then jsonb_build_object(
          'answered', (select count(*) from public.answers a where a.round_id = v_round.id),
          'total', (select count(*) from public.room_players rp where rp.room_id = v_room.id and rp.left_at is null)
        ) else null end
    ) end,
    'viewer_id', v_user
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.leave_room()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room uuid;
  v_host uuid;
  v_next_host uuid;
begin
  select rp.room_id into v_room from public.room_players rp
  where rp.user_id = v_user and rp.left_at is null order by rp.joined_at desc limit 1;
  if v_room is null then return true; end if;
  update public.room_players set left_at = now(), is_connected = false
  where room_id = v_room and user_id = v_user;
  select host_id into v_host from public.game_rooms where id = v_room for update;
  if v_host = v_user then
    select user_id into v_next_host from public.room_players
    where room_id = v_room and left_at is null order by joined_at limit 1;
    if v_next_host is null then
      update public.game_rooms set status = 'closed' where id = v_room;
    else
      update public.game_rooms set host_id = v_next_host where id = v_room;
    end if;
  end if;
  insert into public.game_events (room_id, event_type, payload)
  values (v_room, 'player_left', jsonb_build_object('user_id', v_user));
  return true;
end;
$$;

revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;
revoke all on function public.is_room_member(uuid) from public, anon;
revoke all on function public.set_display_name(text) from public, anon;
revoke all on function public.create_room(text, integer, integer, text[]) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
revoke all on function public.set_ready(boolean) from public, anon;
revoke all on function public.start_game() from public, anon;
revoke all on function public.submit_answer(integer, smallint) from public, anon;
revoke all on function public.use_ability(text, uuid) from public, anon;
revoke all on function public.cast_vote(integer, uuid) from public, anon;
revoke all on function public.resolve_round_zarta(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_round_zarta(uuid, uuid) from service_role;
revoke all on function public.get_room_state() from public, anon;
revoke all on function public.leave_room() from public, anon;
grant execute on function public.set_display_name(text), public.create_room(text, integer, integer, text[]),
  public.join_room(text, text), public.set_ready(boolean), public.start_game(),
  public.submit_answer(integer, smallint), public.use_ability(text, uuid), public.cast_vote(integer, uuid),
  public.get_room_state(), public.leave_room() to authenticated;
grant execute on function public.is_room_member(uuid) to authenticated;
revoke all on function public.tick_expired_rounds() from public, anon, authenticated;
grant execute on function public.tick_expired_rounds() to postgres, service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'zarta-round-timer') then
    perform cron.schedule('zarta-round-timer', '10 seconds', 'select public.tick_expired_rounds()');
  end if;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.game_events;
exception when duplicate_object then null;
end;
$$;
