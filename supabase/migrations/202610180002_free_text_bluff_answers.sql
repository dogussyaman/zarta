alter table public.questions add column if not exists correct_answer text;

create or replace function public.normalize_answer(p_answer text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    regexp_replace(
      lower(translate(
        translate(
          regexp_replace(coalesce(p_answer, ''), '\s+', ' ', 'g'),
          '₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹',
          '01234567890123456789'
        ),
        'İıÎîŞşĞğÜüÖöÇç',
        'iiiiSsGgUuOoCc'
      )),
      '[^a-z0-9 ]', ' ', 'g'
    ),
    '\s+', ' ', 'g'
  ));
$$;

update public.questions
set correct_answer = options ->> correct_option
where correct_answer is null;

alter table public.questions alter column correct_answer set not null;

alter table public.answers add column if not exists answer_text text;
alter table public.answers add column if not exists normalized_answer text;

update public.answers a
set answer_text = coalesce(q.options ->> a.selected_option, ''),
    normalized_answer = public.normalize_answer(coalesce(q.options ->> a.selected_option, ''))
from public.questions q
where q.id = (select r.question_id from public.game_rounds r where r.id = a.round_id)
  and (a.answer_text is null or a.normalized_answer is null);

alter table public.answers alter column selected_option drop not null;
alter table public.answers alter column answer_text set default '';
alter table public.answers alter column answer_text set not null;
alter table public.answers alter column normalized_answer set default '';
alter table public.answers alter column normalized_answer set not null;

create or replace function public.fill_question_correct_answer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.correct_answer is null then
    new.correct_answer := new.options ->> new.correct_option;
  end if;
  return new;
end;
$$;

drop trigger if exists questions_fill_correct_answer on public.questions;
create trigger questions_fill_correct_answer
before insert or update of options, correct_option on public.questions
for each row execute function public.fill_question_correct_answer();

alter table public.game_rooms drop constraint if exists game_rooms_status_check;
alter table public.game_rooms add constraint game_rooms_status_check
  check (status in ('lobby', 'countdown', 'answering', 'voting', 'results', 'finished', 'closed'));

alter table public.game_rounds drop constraint if exists game_rounds_phase_check;
alter table public.game_rounds add constraint game_rounds_phase_check
  check (phase in ('answering', 'voting', 'results'));

alter table public.votes drop constraint if exists votes_round_id_voter_id_key;
create unique index if not exists votes_per_target_per_voter
  on public.votes(round_id, voter_id, target_id);
drop index if exists public.one_zarta_per_player_per_round;

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
    raise exception 'Cevabın 1–120 karakter arasında olmalı.';
  end if;
  v_normalized := public.normalize_answer(v_answer);
  if v_normalized = '' then raise exception 'Geçerli bir cevap yazmalısın.'; end if;

  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'answering'
  for update of gr;
  if not found then raise exception 'Aktif bir cevaplama turu bulunamadı.'; end if;

  select * into v_round from public.game_rounds
  where room_id = v_room.id and round_number = p_round_number and phase = 'answering'
  for update;
  if not found or v_round.ends_at <= now() then raise exception 'Cevaplama süresi doldu.'; end if;

  select public.normalize_answer(q.correct_answer) into v_correct
  from public.questions q where q.id = v_round.question_id;

  select * into v_old from public.answers
  where round_id = v_round.id and player_id = v_user;
  v_has_old := found;
  if found and v_old.normalized_answer = v_normalized then return true; end if;

  if exists (
    select 1 from public.answers a
    where a.round_id = v_round.id and a.player_id <> v_user
      and a.normalized_answer = v_normalized
  ) then
    raise exception 'Bu cevabı başka bir arkadaşın yazdı. Farklı bir cevap dene.';
  end if;

  if v_has_old then
    update public.answers
    set answer_text = v_answer, normalized_answer = v_normalized,
        is_correct = (v_normalized = v_correct), answered_at = now()
    where id = v_old.id;
  else
    insert into public.answers (room_id, round_id, player_id, selected_option, answer_text, normalized_answer, is_correct)
    values (v_room.id, v_round.id, v_user, null, v_answer, v_normalized, (v_normalized = v_correct));
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
begin
  select gr.* into v_room from public.game_rooms gr
  join public.room_players rp on rp.room_id = gr.id
  where rp.user_id = v_user and rp.left_at is null and gr.status = 'voting'
  for update of gr;
  if not found then raise exception 'Zartalama yalnızca cevaplar açıldıktan sonra yapılabilir.'; end if;

  select * into v_round from public.game_rounds
  where room_id = v_room.id and round_number = p_round_number and phase = 'voting';
  if not found or v_round.ends_at <= now() then raise exception 'Zartalama süresi doldu.'; end if;
  if p_target_id = v_user or not exists (
    select 1 from public.answers a
    where a.round_id = v_round.id and a.player_id = p_target_id
  ) then raise exception 'Yalnızca cevap göndermiş başka bir oyuncuyu Zartalayabilirsin.'; end if;

  insert into public.votes (room_id, round_id, voter_id, target_id)
  values (v_room.id, v_round.id, v_user, p_target_id);
  insert into public.game_events (room_id, event_type, payload)
  values (v_room.id, 'vote_cast', jsonb_build_object('user_id', v_user, 'round', p_round_number));
  return true;
exception when unique_violation then
  raise exception 'Bu oyuncuya bu turda zaten Zarta gönderdin.';
end;
$$;

create or replace function public.resolve_round_zarta(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correct text;
  v_vote record;
  v_protection_id uuid;
begin
  select public.normalize_answer(q.correct_answer) into v_correct
  from public.game_rounds r
  join public.questions q on q.id = r.question_id
  where r.id = p_round_id;

  for v_vote in
    select ballot.voter_id, ballot.target_id
    from public.votes ballot
    join public.answers target_answer
      on target_answer.round_id = ballot.round_id and target_answer.player_id = ballot.target_id
    where ballot.round_id = p_round_id and target_answer.normalized_answer <> v_correct
    order by ballot.created_at, ballot.voter_id
  loop
    select ga.id into v_protection_id from public.game_actions ga
    where ga.round_id = p_round_id and ga.player_id = v_vote.target_id
      and ga.action_type = 'ability' and ga.ability_key in ('shield', 'block')
    order by ga.created_at, ga.id limit 1 for update;
    if found then
      delete from public.game_actions where id = v_protection_id;
      continue;
    end if;
    update public.room_players
    set score = score + 2
    where room_id = p_room_id and user_id = v_vote.voter_id;
    insert into public.game_actions (room_id, round_id, player_id, action_type, target_id)
    values (p_room_id, p_round_id, v_vote.voter_id, 'zarta', v_vote.target_id);
  end loop;
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
    if not found or v_round.ends_at > now() then continue; end if;
    if v_round.phase = 'answering' then
      update public.game_rounds set phase = 'voting', ends_at = now() + interval '10 seconds'
      where id = v_round.id;
      update public.game_rooms set status = 'voting' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'answers_revealed', jsonb_build_object('round', v_round.round_number));
    elsif v_round.phase = 'voting' then
      update public.room_players rp set score = rp.score + 1
      from public.answers a where a.round_id = v_round.id and a.player_id = rp.user_id
        and a.room_id = rp.room_id and a.is_correct;
      perform public.resolve_round_zarta(v_room.id, v_round.id);
      update public.game_rounds
      set phase = 'results', resolved_at = now(), ends_at = now() + interval '8 seconds'
      where id = v_round.id;
      update public.game_rooms set status = 'results' where id = v_room.id;
      insert into public.game_events (room_id, event_type, payload)
      values (v_room.id, 'results_revealed', jsonb_build_object('round', v_round.round_number));
    elsif v_round.round_number >= v_room.total_rounds then
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
      if not found then
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
  v_revealed := v_round.phase = 'results' or v_room.status = 'finished';

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
      'my_answer', (select a.answer_text from public.answers a where a.round_id = v_round.id and a.player_id = v_user),
      'my_voted_targets', coalesce((select jsonb_agg(ballot.target_id)
        from public.votes ballot where ballot.round_id = v_round.id and ballot.voter_id = v_user), '[]'::jsonb),
      'my_successful_targets', coalesce((select jsonb_agg(ga.target_id)
        from public.game_actions ga where ga.round_id = v_round.id
          and ga.player_id = v_user and ga.action_type = 'zarta'), '[]'::jsonb),
      'answers', case when v_round.phase in ('voting', 'results') or v_room.status = 'finished' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', a.player_id, 'display_name', p.display_name, 'answer_text', a.answer_text,
          'is_correct', case when v_revealed then a.is_correct else null end
        ) order by p.display_name)
        from public.answers a join public.profiles p on p.id = a.player_id
        where a.round_id = v_round.id
      ), '[]'::jsonb) else '[]'::jsonb end,
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

revoke all on function public.fill_question_correct_answer() from public, anon, authenticated;
revoke all on function public.normalize_answer(text) from public, anon, authenticated;
revoke all on function public.submit_answer(integer, smallint) from public, anon, authenticated;
revoke all on function public.submit_answer(integer, text) from public, anon;
revoke all on function public.cast_vote(integer, uuid) from public, anon;
revoke all on function public.resolve_round_zarta(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.tick_expired_rounds() from public, anon, authenticated;
grant execute on function public.submit_answer(integer, text), public.cast_vote(integer, uuid),
  public.get_room_state() to authenticated;
grant execute on function public.tick_expired_rounds() to postgres, service_role;
