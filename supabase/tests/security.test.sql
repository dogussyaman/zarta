create extension if not exists pgtap with schema extensions;

begin;
select extensions.plan(33);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.game_rooms'::regclass),
  'room table has row-level security enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.room_players'::regclass),
  'player table has row-level security enabled'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.answers', 'select'),
  'clients cannot read answer rows or their correctness'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.questions', 'select'),
  'clients cannot read question answer keys'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.room_players', 'update'),
  'clients cannot directly change player scores or readiness'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.player_abilities', 'update'),
  'clients cannot grant themselves ability uses'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.start_game()', 'execute'),
  'unauthenticated clients cannot start a game'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.submit_answer(integer,text)', 'execute'),
  'authenticated players submit answers only through the validating RPC'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.submit_answer(integer,smallint)', 'execute'),
  'the old multiple-choice answer RPC is no longer callable'
);
select extensions.ok(
  public.normalize_answer('İstanbul!') = public.normalize_answer('istanbul'),
  'answer comparison ignores Turkish case and punctuation'
);
select extensions.ok(
  public.normalize_answer('H₂O') = public.normalize_answer('H2O'),
  'answer comparison treats subscript digits as regular digits'
);
select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.game_rounds'::regclass and conname = 'game_rounds_phase_check'
      and pg_get_constraintdef(oid) like '%completed%'
  ),
  'a completed round cannot be processed as an active results phase'
);
select extensions.ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'votes_one_choice_per_player'
  ),
  'each player can submit at most one answer choice per round'
);
select extensions.ok(
  (select count(*) = 2 from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'
     and policyname in (
       'Room members can receive room broadcasts and presence',
       'Room members can send room broadcasts and presence'
     )),
  'Realtime private channels are scoped to each authenticated room member'
);
select extensions.ok(
  exists (select 1 from cron.job where jobname = 'zarta-round-timer'),
  'server-side round timer is scheduled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.round_player_results'::regclass),
  'per-player round result ledger has row-level security enabled'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.round_player_results', 'select'),
  'clients cannot read the private result ledger directly'
);
select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.round_player_results'::regclass
      and contype = 'p' and pg_get_constraintdef(oid) like '%(round_id, player_id)%'
  ),
  'each player has at most one result row per round'
);
select extensions.ok(
  position('on conflict (round_id, player_id) do nothing' in lower(
    pg_get_functiondef('public.resolve_round_zarta(uuid,uuid)'::regprocedure)
  )) > 0,
  'round scoring is idempotent for each round and player'
);
select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.game_rounds'::regclass and conname = 'game_rounds_phase_check'
      and pg_get_constraintdef(oid) like '%answer_reveal%'
      and pg_get_constraintdef(oid) like '%scoreboard%'
  ),
  'round phase constraint supports answer reveal and shared scoreboard'
);
select extensions.ok(
  position('v_answered >= v_players' in lower(
    pg_get_functiondef('public.submit_answer(integer,text)'::regprocedure)
  )) > 0,
  'answer submission advances as soon as all active players are locked'
);
select extensions.ok(
  position('v_votes >= v_players' in lower(
    pg_get_functiondef('public.cast_vote(integer,uuid)'::regprocedure)
  )) > 0,
  'choice submission resolves early after all active players vote'
);
select extensions.ok(
  position('scoreboard' in lower(
    pg_get_functiondef('public.tick_expired_rounds()'::regprocedure)
  )) > 0,
  'server deadline worker owns scoreboard and next-round transitions'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_my_profile()', 'execute')
    and has_function_privilege('authenticated', 'public.update_my_profile(text,text)', 'execute')
    and not has_function_privilege('anon', 'public.get_my_profile()', 'execute')
    and not has_function_privilege('anon', 'public.update_my_profile(text,text)', 'execute'),
  'profile RPCs are available to authenticated players only'
);
select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_avatar_key_check'
      and pg_get_constraintdef(oid) like '%dragon%'
  ),
  'profiles accept only the supported character keys'
);
select extensions.ok(
  position('avatar_key' in lower(pg_get_functiondef('public.get_room_state()'::regprocedure))) > 0,
  'room state includes persistent character selections'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.round_player_continuations'::regclass),
  'round continuation records have row-level security enabled'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.round_player_continuations', 'select')
    and not has_table_privilege('authenticated', 'public.round_player_continuations', 'insert'),
  'clients cannot read or write continuation records directly'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_round_progress()', 'execute')
    and has_function_privilege('authenticated', 'public.continue_after_scoreboard(integer)', 'execute')
    and not has_function_privilege('anon', 'public.get_round_progress()', 'execute')
    and not has_function_privilege('anon', 'public.continue_after_scoreboard(integer)', 'execute'),
  'round progress and continue RPCs are restricted to authenticated players'
);
select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.game_rounds'::regclass and tgname = 'hold_scoreboard_for_players'
      and not tgisinternal
  ) and position('infinity' in lower(
    pg_get_functiondef('public.hold_scoreboard_for_players()'::regprocedure)
  )) > 0,
  'scoreboard remains open until all active players continue'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_round_reveal()', 'execute')
    and not has_function_privilege('anon', 'public.get_round_reveal()', 'execute'),
  'round answer reveal is restricted to authenticated players'
);
select extensions.ok(
  position('v_round.phase not in' in lower(
    pg_get_functiondef('public.get_round_reveal()'::regprocedure)
  )) > 0,
  'answer reveal is unavailable until voting results are resolved'
);
select extensions.ok(
  position('fooled_players' in lower(
    pg_get_functiondef('public.get_round_reveal()'::regprocedure)
  )) > 0 and position('correct_choice_id' in lower(
    pg_get_functiondef('public.get_round_reveal()'::regprocedure)
  )) > 0,
  'answer reveal includes selected bluff players and the real-answer choice'
);

select * from extensions.finish();
rollback;
