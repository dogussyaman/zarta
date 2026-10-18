alter table public.profiles
  add column if not exists avatar_key text not null default 'spark';

alter table public.profiles drop constraint if exists profiles_avatar_key_check;
alter table public.profiles add constraint profiles_avatar_key_check
  check (avatar_key in (
    'spark', 'panda', 'fox', 'frog', 'tiger',
    'octopus', 'unicorn', 'penguin', 'bear', 'dragon'
  ));

create or replace function public.get_my_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  select * into v_profile from public.profiles where id = v_user;
  if not found then raise exception 'Oyuncu profili bulunamadı.'; end if;
  return jsonb_build_object(
    'user_id', v_profile.id,
    'display_name', v_profile.display_name,
    'avatar_key', v_profile.avatar_key
  );
end;
$$;

create or replace function public.update_my_profile(p_display_name text, p_avatar_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_avatar_key text := coalesce(p_avatar_key, '');
  v_profile public.profiles%rowtype;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  if char_length(v_name) not between 2 and 24 then
    raise exception 'Oyuncu adı 2–24 karakter arasında olmalı.';
  end if;
  if v_avatar_key not in (
    'spark', 'panda', 'fox', 'frog', 'tiger',
    'octopus', 'unicorn', 'penguin', 'bear', 'dragon'
  ) then
    raise exception 'Seçilen karakter geçersiz.';
  end if;

  update public.profiles
  set display_name = v_name, avatar_key = v_avatar_key
  where id = v_user
  returning * into v_profile;
  if not found then raise exception 'Oyuncu profili bulunamadı.'; end if;

  insert into public.game_events (room_id, event_type, payload)
  select distinct rp.room_id, 'player_profile_updated',
    jsonb_build_object('user_id', v_user)
  from public.room_players rp
  join public.game_rooms room on room.id = rp.room_id
  where rp.user_id = v_user and rp.left_at is null and room.status <> 'closed';

  return jsonb_build_object(
    'user_id', v_profile.id,
    'display_name', v_profile.display_name,
    'avatar_key', v_profile.avatar_key
  );
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
  v_revealed boolean;
  v_normalized_correct text;
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
  v_revealed := v_round.phase in ('results', 'scoreboard', 'completed') or v_room.status = 'finished';
  select public.normalize_answer(q.correct_answer) into v_normalized_correct
  from public.questions q where q.id = v_round.question_id;

  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'status', v_room.status, 'host_id', v_room.host_id,
      'current_round', v_room.current_round, 'countdown_ends_at', v_room.countdown_ends_at,
      'total_rounds', v_room.total_rounds,
      'question_seconds', v_room.question_seconds, 'categories', v_room.categories
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', rp.user_id, 'display_name', p.display_name, 'avatar_key', p.avatar_key,
        'score', case when v_round.phase = 'results'
          then rp.score - coalesce(round_result.score_delta, 0) else rp.score end,
        'is_ready', rp.is_ready, 'is_connected', rp.is_connected, 'is_host', (rp.user_id = v_room.host_id),
        'abilities', coalesce((select jsonb_object_agg(pa.ability_key, pa.remaining)
          from public.player_abilities pa where pa.room_id = v_room.id and pa.player_id = rp.user_id), '{}'::jsonb)
      ) order by
        case when v_round.phase = 'results'
          then rp.score - coalesce(round_result.score_delta, 0) else rp.score end desc,
        rp.joined_at)
      from public.room_players rp join public.profiles p on p.id = rp.user_id
      left join public.round_player_results round_result
        on round_result.round_id = v_round.id and round_result.player_id = rp.user_id
      where rp.room_id = v_room.id and rp.left_at is null
    ), '[]'::jsonb),
    'round', case when v_round.id is null then null else jsonb_build_object(
      'round_id', v_round.id,
      'round_number', v_round.round_number, 'phase', v_round.phase,
      'starts_at', v_round.starts_at, 'ends_at', v_round.ends_at,
      'question', (select jsonb_build_object(
        'id', q.id, 'category', q.category, 'prompt', q.prompt, 'difficulty', q.difficulty,
        'correct_answer', case when v_revealed then q.correct_answer else null end
      ) from public.questions q where q.id = v_round.question_id),
      'my_answer', (select a.answer_text from public.answers a
        where a.round_id = v_round.id and a.player_id = v_user),
      'my_vote_choice', (select ballot.selected_answer_id from public.votes ballot
        where ballot.round_id = v_round.id and ballot.voter_id = v_user),
      'answer_choices', case when v_round.phase in ('answer_reveal', 'voting') then coalesce((
        select jsonb_agg(choice.choice_json order by choice.sort_key)
        from (
          select jsonb_build_object(
            'choice_id', a.id, 'answer_text', a.answer_text, 'is_mine', a.player_id = v_user
          ) as choice_json,
          md5(v_round.id::text || a.id::text) as sort_key
          from public.answers a
          where a.round_id = v_round.id and a.normalized_answer <> v_normalized_correct
          union all
          select jsonb_build_object(
            'choice_id', v_round.correct_choice_id, 'answer_text', q.correct_answer, 'is_mine', false
          ), md5(v_round.id::text || v_round.correct_choice_id::text)
          from public.questions q where q.id = v_round.question_id
        ) choice
      ), '[]'::jsonb) else '[]'::jsonb end,
      'personal_result', case when v_round.phase in ('results', 'scoreboard', 'completed') or v_room.status = 'finished'
        then (
          select jsonb_build_object(
            'has_voted', result.answered_correctly or result.selected_bluff_owner_id is not null,
            'answered_correctly', result.answered_correctly,
            'score_delta', result.score_delta,
            'fooled_players', coalesce((
              select jsonb_agg(jsonb_build_object(
                'user_id', target.id, 'display_name', target.display_name, 'avatar_key', target.avatar_key
              ) order by target.display_name)
              from unnest(result.fooled_player_ids) fooled(user_id)
              join public.profiles target on target.id = fooled.user_id
            ), '[]'::jsonb),
            'zartalandi_by', case when result.selected_bluff_owner_id is not null then coalesce((
              select jsonb_agg(jsonb_build_object(
                'user_id', owner.id, 'display_name', owner.display_name, 'avatar_key', owner.avatar_key
              ))
              from public.profiles owner where owner.id = result.selected_bluff_owner_id
            ), '[]'::jsonb) else '[]'::jsonb end
          )
          from public.round_player_results result
          where result.round_id = v_round.id and result.player_id = v_user
        ) else null end,
      'scoreboard', case when v_round.phase in ('scoreboard', 'completed') or v_room.status = 'finished'
        then coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', ranked.user_id,
            'display_name', ranked.display_name,
            'avatar_key', ranked.avatar_key,
            'rank', ranked.rank,
            'round_points', coalesce(ranked.score_delta, 0),
            'total_score', ranked.total_score,
            'has_voted', coalesce(ranked.answered_correctly, false) or ranked.selected_bluff_owner_id is not null,
            'answered_correctly', coalesce(ranked.answered_correctly, false),
            'fooled_count', coalesce(cardinality(ranked.fooled_player_ids), 0),
            'fooled_players', coalesce((
              select jsonb_agg(jsonb_build_object(
                'user_id', target.id, 'display_name', target.display_name, 'avatar_key', target.avatar_key
              ) order by target.display_name)
              from unnest(coalesce(ranked.fooled_player_ids, '{}'::uuid[])) fooled(user_id)
              join public.profiles target on target.id = fooled.user_id
            ), '[]'::jsonb),
            'zartalandi_by', case when ranked.selected_bluff_owner_id is not null then coalesce((
              select jsonb_agg(jsonb_build_object(
                'user_id', owner.id, 'display_name', owner.display_name, 'avatar_key', owner.avatar_key
              ))
              from public.profiles owner where owner.id = ranked.selected_bluff_owner_id
            ), '[]'::jsonb) else '[]'::jsonb end
          ) order by ranked.rank)
          from (
            select rp.user_id, p.display_name, p.avatar_key, rp.score as total_score,
              result.score_delta, result.answered_correctly, result.fooled_player_ids,
              result.selected_bluff_owner_id,
              row_number() over (order by rp.score desc, rp.joined_at) as rank
            from public.room_players rp
            join public.profiles p on p.id = rp.user_id
            left join public.round_player_results result
              on result.round_id = v_round.id and result.player_id = rp.user_id
            where rp.room_id = v_room.id and rp.left_at is null
          ) ranked
        ), '[]'::jsonb) else '[]'::jsonb end,
      'answers', case when v_round.phase in ('scoreboard', 'completed') or v_room.status = 'finished'
        then coalesce((
          select jsonb_agg(jsonb_build_object(
            'player_id', a.player_id, 'display_name', p.display_name, 'avatar_key', p.avatar_key,
            'answer_text', a.answer_text,
            'is_correct', false,
            'fooled_count', (select count(*) from public.votes ballot
              where ballot.round_id = v_round.id and ballot.selected_answer_id = a.id
                and ballot.voter_id <> a.player_id)
          ) order by p.display_name)
          from public.answers a join public.profiles p on p.id = a.player_id
          where a.round_id = v_round.id and a.normalized_answer <> v_normalized_correct
        ), '[]'::jsonb) else '[]'::jsonb end,
      'correct_votes', case when v_revealed then (
        select count(*) from public.votes ballot
        where ballot.round_id = v_round.id and ballot.selected_answer_id = v_round.correct_choice_id
      ) else null end,
      'answer_summary', case when v_round.phase <> 'answering' or v_room.status = 'finished'
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

revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.update_my_profile(text, text) from public, anon;
grant execute on function public.get_my_profile(), public.update_my_profile(text, text) to authenticated;
grant execute on function public.get_room_state() to authenticated;
