# ZARTA ONLINE

Zarta Online is a Turkish, real-time party trivia game. It uses anonymous Supabase Auth identities, Postgres RPCs for trusted game operations, Supabase Realtime for room updates and Presence, and a server-side `pg_cron` job for round deadlines.

## Run locally

Requirements: Node.js 20.19+ (or 22.12+), npm, and a Supabase project.

1. Copy `.env.example` to `.env` and fill in the project URL and **publishable/anon key**:

   ```powershell
   Copy-Item .env.example .env
   ```

   Never put a Supabase `service_role` secret in a `VITE_*` variable. Vite embeds those variables in the browser bundle.

2. In Supabase Dashboard:
   - Enable **Authentication → Sign In / Providers → Anonymous Sign-Ins**.
   - Enable the `pg_cron` database extension before applying the migration if it is not already enabled.
   - Confirm Database → Publications contains `supabase_realtime`. The migration adds the safe `game_events` table to it.
   - In Realtime Settings, disable **Allow public access** so the migration's room-membership policies protect private Presence/Broadcast channels.
   - Add the local and deployed app URLs to Authentication → URL Configuration.

3. Apply the database schema and seed the Turkish question bank. With the Supabase CLI linked to the project:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   Run `supabase/seed.sql` once in the Supabase SQL Editor after the migration. It contains 27 reusable questions across all nine categories.

   If you previously pasted migrations into the SQL Editor, use the idempotent migrations in `supabase/migrations/` in order. They keep existing tables/data and do not drop the existing `profiles` table. Migration `202610180003` fixes repeated round creation and changes the answer phase to the official bluff-and-pick flow. Migration `202610180004` adds private player results, idempotent score records, early phase completion, and a shared scoreboard phase. Migration `202610180005` adds persistent player names and character selection. Migration `202610180006` adds answer/continue waiting lists, player nudges, and a scoreboard that waits until every active player continues. Migration `202610180007` exposes the completed round's answers and who was fooled for the answer reveal screen. If you applied migrations manually, apply migrations `202610180001` through `202610180007` in order, then synchronize Supabase CLI migration history before using `db push`:

   ```powershell
   npx supabase migration repair --status applied 202610180001
   npx supabase migration repair --status applied 202610180002
   npx supabase migration repair --status applied 202610180003
   npx supabase migration repair --status applied 202610180004
   npx supabase migration repair --status applied 202610180005
   npx supabase migration repair --status applied 202610180006
   npx supabase migration repair --status applied 202610180007
   ```

4. Start the app:

   ```powershell
   npm install
   npm run dev
   ```

   Validate production output with `npm run build`; run rule tests with `npm test`. Database privilege/RLS/timer smoke assertions are in `supabase/tests/security.test.sql` and can be run with `npx supabase test db` against a local Supabase stack.

For a local Supabase stack, run `npx supabase start` and then `npx supabase db reset` to apply the migration and load the seed questions before running `npx supabase test db`. Docker is required by the local Supabase CLI.

### Database and security

The migrations in `supabase/migrations/` create and upgrade the profile, room, player, question, round, answer, action, vote, ability, and event tables with foreign keys, constraints, and indexes. State changes are performed by `SECURITY DEFINER` RPCs that derive the player identity from `auth.uid()`. The browser cannot write scores, answers, abilities, votes, or room state directly. RLS restricts room/player/event reads to current members; answer and correct-answer columns have no client table grants. Bluffs stay private until all players can choose from the shuffled answers; the correct-choice marker and answer key remain hidden until scoring is complete.

The anonymous Supabase session is persisted by the official Supabase client so a refresh on the same browser/device restores the same player identity. Anonymous accounts are not recoverable after browser storage is cleared and are not portable to a different device.

`pg_cron` invokes `tick_expired_rounds()` every 10 seconds, so round transitions do not depend on the host keeping a tab open. Clients also ask the database to reconcile state when a deadline is reached and resync after Realtime reconnects. Check Dashboard → Integrations → Cron and `cron.job_run_details` if timer transitions are delayed. If a hosted Postgres environment does not provide `pg_cron`, configure an equivalent trusted scheduled invocation of `public.tick_expired_rounds()` before using the game; do not expose that function to browser roles.

Realtime uses a room-scoped channel. Postgres `game_events` rows carry only safe notification data; clients reload authoritative state through the RPC rather than trusting event payloads. Presence reports online players, and channel failures are displayed rather than represented as a successful connection.

## Game rules

The shared rule definitions are in `src/lib/rules.ts`; database functions enforce the same values server-side:

- 2–10 players; only the host can start after every player is ready. A three-second server-timed countdown begins the first round.
- A player writes an in-character, incorrect bluff. The server rejects the real answer, blank/overlong entries, and bluffs that normalize to another player's answer. Players may revise their own bluff until the timer expires.
- When everyone has submitted a bluff, answers lock immediately; otherwise the answer timer locks the set. A short reveal phase precedes the 15-second choice phase. Players choose the real answer once and cannot select their own bluff.
- Choosing the real answer awards one point. Each player fooled by a bluff awards its author two points. Each player first receives a private result; the common scoreboard then shows round points, total points, rank, successful bluffs, and who fooled whom.
- The server advances through answering, answer reveal, choice, personal results, scoreboard, and next question/game over. Everyone finishing early advances immediately; timeouts use the same server-side resolution path.
- A private result ledger has one `(round_id, player_id)` row, and score changes are applied only when that row is first inserted. Completed rounds are marked terminal before the next round is inserted, preventing duplicate scoring and duplicate `(room_id, round_number)` conflicts.
- Questions are shuffled without repeats until the selected pool is exhausted.

The intended four-step flow follows [Zarta's official Turkish how-to-play page](https://www.zartaapp.com/tr/): join a room, read the question, write a convincing bluff, then choose the real answer to score.

## Design research

Dribbble search/tag pages were attempted (`https://dribbble.com/search/party%20game%20ui` and `https://dribbble.com/tags/trivia-game`) but returned an AWS WAF verification page, not inspectable designs. They were not treated as visual references. The following accessible official game/product pages were used as alternative product-flow references; the fetched pages exposed text/content, not a full inspectable design-gallery screenshot:

| Reference | Design cue applied |
| --- | --- |
| [Jackbox Party Pack](https://www.jackboxgames.com/games/packs/the-jackbox-party-pack-1) | Playful party tone and a clear mix of trivia, social, and strategy moments. |
| [Gartic Phone](https://garticphone.com/) | Lightweight friend-group setup and keeping social play at the center. |
| [Codenames Online](https://codenames.game/) | Nickname-first entry, visible room setup, and shareable room invitation. |
| [Blooket](https://www.blooket.com/) | Fast live-game setup and visible post-answer feedback. |
| [skribbl.io](https://skribbl.io/) | Casual multiplayer settings and compact controls suited to a party lobby. |
| [Quiplash](https://www.jackboxgames.com/games/quiplash) | Short rounds followed by a clear audience voting phase. |

The visual system is a mobile-first, arcade-inspired blue game interface with responsive lobby/player cards, a compact timer badge, glossy bluff and answer-choice cards, animated personal results, celebratory scoreboards, reduced-motion handling, and safe-area padding. The room setup uses shadcn-inspired cards, selects, focus rings, and shadows; category artwork is served locally and exactly one category is selected per new room. Players can update their display name and select one of ten persistent characters from the profile dialog; selected characters appear in the lobby and scoreboards.

## Known environment-dependent checks

Supabase CLI, Docker, and `psql` are not available in this workspace, so migrations `202610180004_round_results_scoreboard.sql` through `202610180007_round_answer_reveal.sql` and their database assertions could not be executed here. Apply all pending migrations in order to the linked Supabase project before testing the updated multiplayer flow. Frontend tests cover delayed snapshots being rejected; the two-client database scenarios still require a Supabase test stack or the linked project.

Public matchmaking and long-term player statistics are not part of this initial game loop; private rooms, category selection, bluff scoring, and the timed answer-selection phase are implemented.
