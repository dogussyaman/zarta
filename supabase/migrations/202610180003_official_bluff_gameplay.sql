alter table public.game_rounds add column if not exists correct_choice_id uuid default gen_random_uuid();
update public.game_rounds set correct_choice_id = gen_random_uuid() where correct_choice_id is null;
alter table public.game_rounds alter column correct_choice_id set default gen_random_uuid();
alter table public.game_rounds alter column correct_choice_id set not null;

alter table public.game_rounds drop constraint if exists game_rounds_phase_check;
alter table public.game_rounds add constraint game_rounds_phase_check
  check (phase in ('answering', 'voting', 'results', 'completed'));

update public.game_rounds previous
set phase = 'completed'
where previous.phase = 'results'
  and exists (
    select 1 from public.game_rounds later
    where later.room_id = previous.room_id and later.round_number > previous.round_number
  );

alter table public.votes add column if not exists selected_answer_id uuid;
update public.votes ballot
set selected_answer_id = answer.id
from public.answers answer
where ballot.round_id = answer.round_id
  and ballot.target_id = answer.player_id
  and ballot.selected_answer_id is null;
alter table public.votes alter column target_id drop not null;

delete from public.votes ballot
using (
  select ctid, row_number() over (
    partition by round_id, voter_id order by created_at, id
  ) as ballot_number
  from public.votes
) duplicate
where ballot.ctid = duplicate.ctid and duplicate.ballot_number > 1;

drop index if exists public.votes_per_target_per_voter;
create unique index if not exists votes_one_choice_per_player
  on public.votes(round_id, voter_id);

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
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'voting'
  for update of gr;
  if not found then raise exception 'Cevap seçimi yalnızca cevaplar açıldıktan sonra yapılabilir.'; end if;

  select * into v_round from public.game_rounds
  where room_id = v_room.id and round_number = p_round_number and phase = 'voting'
  for update;
  if not found or v_round.ends_at <= now() then raise exception 'Cevap seçme süresi doldu.'; end if;
  if p_target_id is null then
    raise exception 'Bir cevap seçmelisin.';
  end if;

  if p_target_id = v_round.correct_choice_id then
    v_owner := null;
  else
    select a.player_id into v_owner from public.answers a
    where a.id = p_target_id and a.round_id = v_round.id;
    if not found then raise exception 'Seçtiğin cevap bu turda bulunamadı.'; end if;
    if v_owner = v_user then raise exception 'Kendi blöfünü seçemezsin.'; end if;
  end if;

  insert into public.votes (room_id, round_id, voter_id, target_id, selected_answer_id)
  values (v_room.id, v_round.id, v_user, v_owner, p_target_id);
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'vote_cast', jsonb_build_object('user_id', v_user, 'round', p_round_number));
  return true;
exception when unique_violation then
  raise exception 'Bu turda cevabını zaten seçtin.';
end;
$$;

create or replace function public.resolve_round_zarta(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correct_choice_id uuid;
  v_correct text;
begin
  select r.correct_choice_id, public.normalize_answer(q.correct_answer)
  into v_correct_choice_id, v_correct
  from public.game_rounds r
  join public.questions q on q.id = r.question_id
  where r.id = p_round_id and r.room_id = p_room_id;
  if not found then raise exception 'Tur bulunamadı.'; end if;

  update public.room_players rp
  set score = rp.score + 1
  from public.votes ballot
  where ballot.round_id = p_round_id and ballot.room_id = p_room_id
    and ballot.voter_id = rp.user_id and rp.room_id = p_room_id
    and ballot.selected_answer_id = v_correct_choice_id;

  update public.room_players rp
  set score = rp.score + fooled.vote_count * 2
  from (
    select answer.player_id, count(*)::integer as vote_count
    from public.answers answer
    join public.votes ballot on ballot.selected_answer_id = answer.id
    where answer.round_id = p_round_id and ballot.round_id = p_round_id
      and ballot.voter_id <> answer.player_id
      and answer.normalized_answer <> v_correct
    group by answer.player_id
  ) fooled
  where rp.room_id = p_room_id and rp.user_id = fooled.player_id;
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

  for v_round in
    select r.id, r.room_id, r.round_number, r.phase, r.ends_at
    from public.game_rounds r
    join public.game_rooms gr on gr.id = r.room_id
    where r.ends_at <= now() and r.phase in ('answering', 'voting', 'results')
      and gr.status in ('answering', 'voting', 'results')
    order by r.ends_at
  loop
    select * into v_room from public.game_rooms
    where id = v_round.room_id for update skip locked;
    if not found then continue; end if;

    select * into v_round from public.game_rounds
    where id = v_round.id for update;
    if not found or v_round.phase not in ('answering', 'voting', 'results')
      or v_round.ends_at > now() then
      continue;
    end if;

    if v_round.phase = 'answering' then
      update public.game_rounds set phase = 'voting', ends_at = now() + interval '15 seconds'
      where id = v_round.id;
      update public.game_rooms set status = 'voting' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'answers_revealed', jsonb_build_object('round', v_round.round_number));
    elsif v_round.phase = 'voting' then
      perform public.resolve_round_zarta(v_room.id, v_round.id);
      update public.game_rounds
      set phase = 'results', resolved_at = now(), ends_at = now() + interval '8 seconds'
      where id = v_round.id;
      update public.game_rooms set status = 'results' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'results_revealed', jsonb_build_object('round', v_round.round_number));
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
          where played.room_id = v_room.id and played.question_id = questions.id
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
  v_revealed := v_round.phase in ('results', 'completed') or v_room.status = 'finished';
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
        'id', q.id, 'category', q.category, 'prompt', q.prompt, 'difficulty', q.difficulty,
        'correct_answer', case when v_revealed then q.correct_answer else null end
      ) from public.questions q where q.id = v_round.question_id),
      'my_answer', (select a.answer_text from public.answers a
        where a.round_id = v_round.id and a.player_id = v_user),
      'my_vote_choice', (select ballot.selected_answer_id from public.votes ballot
        where ballot.round_id = v_round.id and ballot.voter_id = v_user),
      'answer_choices', case when v_round.phase = 'voting' then coalesce((
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
      'answers', case when v_round.phase in ('results', 'completed') or v_room.status = 'finished'
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

revoke all on function public.submit_answer(integer, smallint) from public, anon, authenticated;
revoke all on function public.submit_answer(integer, text) from public, anon;
revoke all on function public.cast_vote(integer, uuid) from public, anon;
revoke all on function public.resolve_round_zarta(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.tick_expired_rounds() from public, anon, authenticated;
grant execute on function public.submit_answer(integer, text), public.cast_vote(integer, uuid),
  public.get_room_state() to authenticated;
grant execute on function public.tick_expired_rounds() to postgres, service_role;
