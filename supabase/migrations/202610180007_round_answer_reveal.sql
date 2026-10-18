create or replace function public.get_round_reveal()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_round public.game_rounds%rowtype;
  v_answers jsonb;
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
  if not found or v_round.phase not in ('results', 'scoreboard', 'completed') then
    return null;
  end if;

  with revealed as (
    select
      jsonb_build_object(
        'player_id', answer.player_id,
        'display_name', owner.display_name,
        'avatar_key', owner.avatar_key,
        'answer_text', answer.answer_text,
        'is_correct', false,
        'fooled_count', count(ballot.voter_id),
        'fooled_players', coalesce(jsonb_agg(jsonb_build_object(
          'user_id', voter.id,
          'display_name', voter.display_name,
          'avatar_key', voter.avatar_key
        ) order by voter.display_name) filter (where voter.id is not null), '[]'::jsonb)
      ) as answer_json,
      count(ballot.voter_id) as fooled_count,
      false as is_correct,
      owner.display_name
    from public.answers answer
    join public.profiles owner on owner.id = answer.player_id
    left join public.votes ballot
      on ballot.round_id = v_round.id
      and ballot.selected_answer_id = answer.id
      and ballot.voter_id <> answer.player_id
    left join public.profiles voter on voter.id = ballot.voter_id
    where answer.round_id = v_round.id
    group by answer.player_id, owner.display_name, owner.avatar_key, answer.answer_text

    union all

    select
      jsonb_build_object(
        'player_id', null,
        'display_name', 'Gerçek cevap',
        'avatar_key', null,
        'answer_text', question.correct_answer,
        'is_correct', true,
        'fooled_count', count(ballot.voter_id),
        'fooled_players', coalesce(jsonb_agg(jsonb_build_object(
          'user_id', voter.id,
          'display_name', voter.display_name,
          'avatar_key', voter.avatar_key
        ) order by voter.display_name) filter (where voter.id is not null), '[]'::jsonb)
      ),
      count(ballot.voter_id),
      true,
      'Gerçek cevap'
    from public.questions question
    left join public.votes ballot
      on ballot.round_id = v_round.id
      and ballot.selected_answer_id = v_round.correct_choice_id
    left join public.profiles voter on voter.id = ballot.voter_id
    where question.id = v_round.question_id
    group by question.correct_answer
  )
  select coalesce(jsonb_agg(answer_json order by is_correct, fooled_count desc, display_name), '[]'::jsonb)
  into v_answers
  from revealed;

  return jsonb_build_object(
    'room_id', v_room.id,
    'round_number', v_round.round_number,
    'answers', v_answers
  );
end;
$$;

revoke all on function public.get_round_reveal() from public, anon;
grant execute on function public.get_round_reveal() to authenticated;
