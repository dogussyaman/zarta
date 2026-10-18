alter table public.game_rooms drop constraint if exists game_rooms_status_check;
alter table public.game_rooms add constraint game_rooms_status_check
  check (status in ('lobby', 'countdown', 'answering', 'answer_reveal', 'voting', 'results', 'scoreboard', 'finished', 'closed'));

alter table public.game_rounds drop constraint if exists game_rounds_phase_check;
alter table public.game_rounds add constraint game_rounds_phase_check
  check (phase in ('answering', 'answer_reveal', 'voting', 'results', 'scoreboard', 'completed'));

create table if not exists public.round_player_results (
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  answered_correctly boolean not null,
  selected_bluff_owner_id uuid references public.profiles(id),
  fooled_player_ids uuid[] not null default '{}',
  score_delta integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (round_id, player_id)
);

create index if not exists round_player_results_room_idx
  on public.round_player_results(room_id, round_id);
alter table public.round_player_results enable row level security;
revoke all on public.round_player_results from anon, authenticated;

create or replace function public.resolve_round_zarta(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with calculated as (
    select
      rp.room_id,
      rp.user_id as player_id,
      exists (
        select 1
        from public.votes ballot
        join public.game_rounds game_round on game_round.id = ballot.round_id
        where ballot.round_id = p_round_id
          and ballot.voter_id = rp.user_id
          and ballot.selected_answer_id = game_round.correct_choice_id
      ) as answered_correctly,
      (
        select answer.player_id
        from public.votes ballot
        join public.answers answer
          on answer.id = ballot.selected_answer_id and answer.round_id = ballot.round_id
        where ballot.round_id = p_round_id and ballot.voter_id = rp.user_id
      ) as selected_bluff_owner_id,
      coalesce((
        select array_agg(ballot.voter_id order by ballot.voter_id)
        from public.votes ballot
        join public.answers answer
          on answer.id = ballot.selected_answer_id and answer.round_id = ballot.round_id
        where ballot.round_id = p_round_id
          and answer.player_id = rp.user_id
          and ballot.voter_id <> rp.user_id
      ), '{}'::uuid[]) as fooled_player_ids
    from public.room_players rp
    where rp.room_id = p_room_id
  ), inserted as (
    insert into public.round_player_results (
      round_id, room_id, player_id, answered_correctly, selected_bluff_owner_id,
      fooled_player_ids, score_delta
    )
    select
      p_round_id, calculated.room_id, calculated.player_id, calculated.answered_correctly,
      calculated.selected_bluff_owner_id, calculated.fooled_player_ids,
      (case when calculated.answered_correctly then 1 else 0 end)
        + cardinality(calculated.fooled_player_ids) * 2
    from calculated
    on conflict (round_id, player_id) do nothing
    returning room_id, player_id, score_delta
  )
  update public.room_players rp
  set score = rp.score + inserted.score_delta
  from inserted
  where rp.room_id = inserted.room_id and rp.user_id = inserted.player_id;
end;
$$;

with calculated as (
  select
    game_round.id as round_id,
    game_round.room_id,
    rp.user_id as player_id,
    exists (
      select 1 from public.votes ballot
      where ballot.round_id = game_round.id
        and ballot.voter_id = rp.user_id
        and ballot.selected_answer_id = game_round.correct_choice_id
    ) as answered_correctly,
    (
      select answer.player_id
      from public.votes ballot
      join public.answers answer
        on answer.id = ballot.selected_answer_id and answer.round_id = ballot.round_id
      where ballot.round_id = game_round.id and ballot.voter_id = rp.user_id
    ) as selected_bluff_owner_id,
    coalesce((
      select array_agg(ballot.voter_id order by ballot.voter_id)
      from public.votes ballot
      join public.answers answer
        on answer.id = ballot.selected_answer_id and answer.round_id = ballot.round_id
      where ballot.round_id = game_round.id
        and answer.player_id = rp.user_id
        and ballot.voter_id <> rp.user_id
    ), '{}'::uuid[]) as fooled_player_ids
  from public.game_rounds game_round
  join public.game_rooms room
    on room.id = game_round.room_id and room.status = 'results'
  join public.room_players rp on rp.room_id = game_round.room_id
  where game_round.phase = 'results'
)
insert into public.round_player_results (
  round_id, room_id, player_id, answered_correctly, selected_bluff_owner_id,
  fooled_player_ids, score_delta
)
select
  calculated.round_id, calculated.room_id, calculated.player_id,
  calculated.answered_correctly, calculated.selected_bluff_owner_id,
  calculated.fooled_player_ids,
  (case when calculated.answered_correctly then 1 else 0 end)
    + cardinality(calculated.fooled_player_ids) * 2
from calculated
on conflict (round_id, player_id) do nothing;

create or replace function public.submit_answer(p_round_number integer, p_answer text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.game_rooms%rowtype;
  v_round public.game_rounds%rowtype;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_normalized text;
  v_correct text;
  v_old public.answers%rowtype;
  v_has_old boolean;
  v_answered integer;
  v_players integer;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  if char_length(v_answer) not between 1 and 120 then
    raise exception 'Blöfün 1–120 karakter arasında olmalı.';
  end if;
  v_normalized := public.normalize_answer(v_answer);
  if v_normalized = '' then raise exception 'Geçerli bir blöf yazmalısın.'; end if;

  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'answering'
  for update of gr;
  if not found then raise exception 'Aktif bir cevaplama turu bulunamadı.'; end if;

  select * into v_round from public.game_rounds
  where room_id = v_room.id and round_number = p_round_number and phase = 'answering'
  for update;
  if not found or v_round.ends_at <= now() then raise exception 'Blöf yazma süresi doldu.'; end if;

  select public.normalize_answer(q.correct_answer) into v_correct
  from public.questions q where q.id = v_round.question_id;
  if v_normalized = v_correct then
    raise exception 'Bu gerçek cevap. Zarta turunda inandırıcı ama yanlış bir cevap yazmalısın.';
  end if;

  select * into v_old from public.answers
  where round_id = v_round.id and player_id = v_user;
  v_has_old := found;
  if v_has_old and v_old.normalized_answer = v_normalized then return true; end if;

  if exists (
    select 1 from public.answers a
    where a.round_id = v_round.id and a.player_id <> v_user
      and a.normalized_answer = v_normalized
  ) then
    raise exception 'Bu blöfü başka biri yazdı. Farklı bir blöf dene.';
  end if;

  if v_has_old then
    update public.answers
    set answer_text = v_answer, normalized_answer = v_normalized,
        is_correct = false, answered_at = now()
    where id = v_old.id;
  else
    insert into public.answers (room_id, round_id, player_id, selected_option, answer_text, normalized_answer, is_correct)
    values (v_room.id, v_round.id, v_user, null, v_answer, v_normalized, false);
  end if;

  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'answer_submitted', jsonb_build_object('user_id', v_user, 'round', p_round_number));

  select count(*) into v_answered
  from public.answers where round_id = v_round.id;
  select count(*) into v_players
  from public.room_players where room_id = v_room.id and left_at is null;
  if v_answered >= v_players then
    update public.game_rounds
    set phase = 'answer_reveal', ends_at = now() + interval '2 seconds'
    where id = v_round.id and phase = 'answering';
    update public.game_rooms set status = 'answer_reveal' where id = v_room.id;
    insert into public.game_events (room_id, event_type, payload)
    values (v_room.id, 'answers_revealed', jsonb_build_object('round', p_round_number));
  end if;
  return true;
end;
$$;

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
  v_owner uuid;
  v_votes integer;
  v_players integer;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'voting'
  for update of gr;
  if not found then raise exception 'Cevap seçimi yalnızca Zartalama aşamasında yapılabilir.'; end if;

  select * into v_round from public.game_rounds
  where room_id = v_room.id and round_number = p_round_number and phase = 'voting'
  for update;
  if not found or v_round.ends_at <= now() then raise exception 'Cevap seçme süresi doldu.'; end if;
  if p_target_id is null then raise exception 'Bir cevap seçmelisin.'; end if;

  if p_target_id <> v_round.correct_choice_id then
    select a.player_id into v_owner from public.answers a
    where a.id = p_target_id and a.round_id = v_round.id;
    if not found then raise exception 'Seçtiğin cevap bu turda bulunamadı.'; end if;
    if v_owner = v_user then raise exception 'Kendi blöfünü seçemezsin.'; end if;
  end if;

  insert into public.votes (room_id, round_id, voter_id, target_id, selected_answer_id)
  values (v_room.id, v_round.id, v_user, v_owner, p_target_id);
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'vote_cast', jsonb_build_object('user_id', v_user, 'round', p_round_number));

  select count(*) into v_votes from public.votes where round_id = v_round.id;
  select count(*) into v_players
  from public.room_players where room_id = v_room.id and left_at is null;
  if v_votes >= v_players then
    perform public.resolve_round_zarta(v_room.id, v_round.id);
    update public.game_rounds
    set phase = 'results', resolved_at = now(), ends_at = now() + interval '6 seconds'
    where id = v_round.id and phase = 'voting';
    update public.game_rooms set status = 'results' where id = v_room.id;
    insert into public.game_events (room_id, event_type, payload)
    values (v_room.id, 'results_revealed', jsonb_build_object('round', p_round_number));
  end if;
  return true;
exception when unique_violation then
  raise exception 'Bu turda cevabını zaten seçtin.';
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
  v_due record;
  v_round public.game_rounds%rowtype;
  v_room public.game_rooms%rowtype;
  v_question public.questions%rowtype;
  v_count integer := 0;
  v_has_question boolean;
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

  for v_due in
    select r.id, r.room_id
    from public.game_rounds r
    join public.game_rooms gr on gr.id = r.room_id
    where r.ends_at <= now()
      and r.phase in ('answering', 'answer_reveal', 'voting', 'results', 'scoreboard')
      and gr.status in ('answering', 'answer_reveal', 'voting', 'results', 'scoreboard')
    order by r.ends_at
  loop
    select * into v_room from public.game_rooms
    where id = v_due.room_id for update skip locked;
    if not found then continue; end if;

    select * into v_round from public.game_rounds
    where id = v_due.id for update;
    if not found or v_round.ends_at > now()
      or v_round.phase not in ('answering', 'answer_reveal', 'voting', 'results', 'scoreboard') then
      continue;
    end if;

    if v_round.phase = 'answering' then
      update public.game_rounds set phase = 'answer_reveal', ends_at = now() + interval '2 seconds'
      where id = v_round.id;
      update public.game_rooms set status = 'answer_reveal' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'answers_revealed', jsonb_build_object('round', v_round.round_number));
    elsif v_round.phase = 'answer_reveal' then
      update public.game_rounds set phase = 'voting', ends_at = now() + interval '15 seconds'
      where id = v_round.id;
      update public.game_rooms set status = 'voting' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'zarta_started', jsonb_build_object('round', v_round.round_number));
    elsif v_round.phase = 'voting' then
      perform public.resolve_round_zarta(v_room.id, v_round.id);
      update public.game_rounds
      set phase = 'results', resolved_at = now(), ends_at = now() + interval '6 seconds'
      where id = v_round.id;
      update public.game_rooms set status = 'results' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'results_revealed', jsonb_build_object('round', v_round.round_number));
    elsif v_round.phase = 'results' then
      update public.game_rounds set phase = 'scoreboard', ends_at = now() + interval '8 seconds'
      where id = v_round.id;
      update public.game_rooms set status = 'scoreboard' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'scoreboard_opened', jsonb_build_object('round', v_round.round_number));
    elsif v_round.round_number >= v_room.total_rounds then
      update public.game_rounds set phase = 'completed' where id = v_round.id;
      update public.game_rooms set status = 'finished' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'game_finished', jsonb_build_object('round', v_round.round_number));
    else
      select * into v_question from public.questions
      where is_active and category = any(v_room.categories)
        and not exists (
          select 1 from public.game_rounds played
          where played.room_id = v_room.id and played.question_id = public.questions.id
        )
      order by random() limit 1;
      if not found then
        select * into v_question from public.questions
        where is_active and category = any(v_room.categories)
        order by random() limit 1;
      end if;
      v_has_question := found;

      update public.game_rounds set phase = 'completed' where id = v_round.id;
      if not v_has_question then
        update public.game_rooms set status = 'finished' where id = v_room.id;
        insert into public.game_events (room_id, event_type, payload)
        values (v_room.id, 'game_finished', jsonb_build_object('reason', 'no_questions'));
      else
        insert into public.game_rounds (room_id, question_id, round_number, phase, ends_at)
        values (v_room.id, v_question.id, v_round.round_number + 1, 'answering',
          now() + make_interval(secs => v_room.question_seconds));
        update public.game_rooms set status = 'answering', current_round = v_round.round_number + 1
        where id = v_room.id;
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
        'user_id', rp.user_id, 'display_name', p.display_name,
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
              select jsonb_agg(jsonb_build_object('user_id', target.id, 'display_name', target.display_name)
                order by target.display_name)
              from unnest(result.fooled_player_ids) fooled(user_id)
              join public.profiles target on target.id = fooled.user_id
            ), '[]'::jsonb),
            'zartalandi_by', case when result.selected_bluff_owner_id is not null then coalesce((
              select jsonb_agg(jsonb_build_object('user_id', owner.id, 'display_name', owner.display_name))
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
            'rank', ranked.rank,
            'round_points', coalesce(ranked.score_delta, 0),
            'total_score', ranked.total_score,
            'has_voted', coalesce(ranked.answered_correctly, false) or ranked.selected_bluff_owner_id is not null,
            'answered_correctly', coalesce(ranked.answered_correctly, false),
            'fooled_count', coalesce(cardinality(ranked.fooled_player_ids), 0),
            'fooled_players', coalesce((
              select jsonb_agg(jsonb_build_object('user_id', target.id, 'display_name', target.display_name)
                order by target.display_name)
              from unnest(coalesce(ranked.fooled_player_ids, '{}'::uuid[])) fooled(user_id)
              join public.profiles target on target.id = fooled.user_id
            ), '[]'::jsonb),
            'zartalandi_by', case when ranked.selected_bluff_owner_id is not null then coalesce((
              select jsonb_agg(jsonb_build_object('user_id', owner.id, 'display_name', owner.display_name))
              from public.profiles owner where owner.id = ranked.selected_bluff_owner_id
            ), '[]'::jsonb) else '[]'::jsonb end
          ) order by ranked.rank)
          from (
            select rp.user_id, p.display_name, rp.score as total_score,
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
            'player_id', a.player_id, 'display_name', p.display_name, 'answer_text', a.answer_text,
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

revoke all on function public.resolve_round_zarta(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.tick_expired_rounds() from public, anon, authenticated;
grant execute on function public.submit_answer(integer, text), public.cast_vote(integer, uuid),
  public.get_room_state() to authenticated;
grant execute on function public.tick_expired_rounds() to postgres, service_role;
