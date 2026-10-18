create table if not exists public.round_player_continuations (
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  continued_at timestamptz not null default now(),
  primary key (round_id, player_id)
);

create index if not exists round_player_continuations_room_idx
  on public.round_player_continuations(room_id, round_id);

alter table public.round_player_continuations enable row level security;
revoke all on public.round_player_continuations from anon, authenticated;

create or replace function public.hold_scoreboard_for_players()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phase = 'scoreboard' and old.phase is distinct from 'scoreboard' then
    new.ends_at := 'infinity'::timestamptz;
  end if;
  return new;
end;
$$;

drop trigger if exists hold_scoreboard_for_players on public.game_rounds;
create trigger hold_scoreboard_for_players
before update of phase on public.game_rounds
for each row execute function public.hold_scoreboard_for_players();

update public.game_rounds
set ends_at = 'infinity'::timestamptz
where phase = 'scoreboard';

create or replace function public.get_round_progress()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_round public.game_rounds%rowtype;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;

  select room.* into v_room
  from public.game_rooms room
  join public.room_players member on member.room_id = room.id
  where member.user_id = v_user and member.left_at is null and room.status <> 'closed'
  order by member.joined_at desc
  limit 1;
  if not found then return null; end if;

  select * into v_round
  from public.game_rounds
  where room_id = v_room.id and round_number = v_room.current_round;
  if not found then return null; end if;

  return jsonb_build_object(
    'room_id', v_room.id,
    'round_number', v_round.round_number,
    'phase', v_round.phase,
    'player_ids', coalesce((
      select jsonb_agg(member.user_id order by member.joined_at)
      from public.room_players member
      where member.room_id = v_room.id and member.left_at is null
    ), '[]'::jsonb),
    'answered_player_ids', coalesce((
      select jsonb_agg(answer.player_id)
      from public.answers answer
      where answer.round_id = v_round.id
    ), '[]'::jsonb),
    'continued_player_ids', coalesce((
      select jsonb_agg(continuation.player_id)
      from public.round_player_continuations continuation
      where continuation.round_id = v_round.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.continue_after_scoreboard(p_round_number integer)
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
  if v_user is null then raise exception 'Oturum gerekli.'; end if;

  select room.* into v_room
  from public.game_rooms room
  join public.room_players member on member.room_id = room.id
  where member.user_id = v_user
    and member.left_at is null
    and room.status = 'scoreboard'
    and room.current_round = p_round_number
  for update of room;
  if not found then raise exception 'Devam edilecek skor tablosu bulunamadı.'; end if;

  select * into v_round
  from public.game_rounds
  where room_id = v_room.id and round_number = p_round_number
  for update;
  if not found or v_round.phase <> 'scoreboard' then
    raise exception 'Bu turun skor tablosu artık açık değil.';
  end if;

  insert into public.round_player_continuations (round_id, room_id, player_id)
  values (v_round.id, v_room.id, v_user)
  on conflict (round_id, player_id) do nothing;

  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'player_continued', jsonb_build_object('round', p_round_number));

  if not exists (
    select 1
    from public.room_players member
    where member.room_id = v_room.id
      and member.left_at is null
      and not exists (
        select 1
        from public.round_player_continuations continuation
        where continuation.round_id = v_round.id
          and continuation.player_id = member.user_id
      )
  ) then
    update public.game_rounds set ends_at = now() where id = v_round.id;
    perform public.tick_expired_rounds();
  end if;

  return true;
end;
$$;

revoke all on function public.hold_scoreboard_for_players() from public, anon, authenticated;
revoke all on function public.get_round_progress() from public, anon;
revoke all on function public.continue_after_scoreboard(integer) from public, anon;
grant execute on function public.get_round_progress(), public.continue_after_scoreboard(integer)
  to authenticated;
