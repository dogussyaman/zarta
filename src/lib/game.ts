import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { PlayerCharacterKey } from './profile'
import type { AbilityKey } from './rules'

type RoomPresence = { user_id: string; online_at: string }
const roomChannels = new Map<string, RealtimeChannel>()

export type Player = {
  user_id: string
  display_name: string
  avatar_key: PlayerCharacterKey
  score: number
  is_ready: boolean
  is_connected: boolean
  is_host: boolean
  abilities: Record<AbilityKey, number>
}

export type Round = {
  round_id: string
  round_number: number
  phase: 'answering' | 'answer_reveal' | 'voting' | 'results' | 'scoreboard' | 'completed'
  starts_at: string
  ends_at: string
  question: { id: string; category: string; prompt: string; difficulty: string; correct_answer: string | null } | null
  my_answer: string | null
  my_vote_choice: string | null
  answer_choices: { choice_id: string; answer_text: string; is_mine: boolean }[]
  answers: { player_id: string; display_name: string; avatar_key: PlayerCharacterKey; answer_text: string; is_correct: boolean; fooled_count: number }[]
  personal_result: {
    has_voted: boolean
    answered_correctly: boolean
    score_delta: number
    fooled_players: { user_id: string; display_name: string; avatar_key: PlayerCharacterKey }[]
    zartalandi_by: { user_id: string; display_name: string; avatar_key: PlayerCharacterKey }[]
  } | null
  scoreboard: {
    user_id: string
    display_name: string
    avatar_key: PlayerCharacterKey
    rank: number
    round_points: number
    total_score: number
    has_voted: boolean
    answered_correctly: boolean
    fooled_count: number
    fooled_players: { user_id: string; display_name: string; avatar_key: PlayerCharacterKey }[]
    zartalandi_by: { user_id: string; display_name: string; avatar_key: PlayerCharacterKey }[]
  }[]
  correct_votes: number | null
  answer_summary: { answered: number; total: number } | null
}

export type RoomState = {
  room: {
    id: string
    code: string
    status: string
    host_id: string
    current_round: number
    countdown_ends_at: string | null
    total_rounds: number
    question_seconds: number
    categories: string[]
  }
  players: Player[]
  round: Round | null
  viewer_id: string
}

export type RoundProgress = {
  room_id: string
  round_number: number
  phase: Round['phase']
  player_ids: string[]
  answered_player_ids: string[]
  continued_player_ids: string[]
}

export type RevealedAnswer = {
  player_id: string | null
  display_name: string
  avatar_key: PlayerCharacterKey | null
  answer_text: string
  is_correct: boolean
  fooled_count: number
  fooled_players: { user_id: string; display_name: string; avatar_key: PlayerCharacterKey }[]
}

export type RoundReveal = {
  room_id: string
  round_number: number
  answers: RevealedAnswer[]
}

type RoomStateMarker = {
  room: Pick<RoomState['room'], 'id' | 'status' | 'current_round'>
  round: Pick<Round, 'phase' | 'round_number'> | null
}

export function isStateAtLeastAsNew(current: RoomStateMarker | null, next: RoomStateMarker | null): boolean {
  if (!current || !next || current.room.id !== next.room.id) return true
  if (next.room.current_round !== current.room.current_round) {
    return next.room.current_round > current.room.current_round
  }
  const ranks: Record<string, number> = {
    lobby: 0,
    countdown: 1,
    answering: 2,
    answer_reveal: 3,
    voting: 4,
    results: 5,
    scoreboard: 6,
    completed: 7,
    finished: 8,
  }
  const currentPhase = current.room.status === 'finished' ? 'finished' : current.round?.phase ?? current.room.status
  const nextPhase = next.room.status === 'finished' ? 'finished' : next.round?.phase ?? next.room.status
  return (ranks[nextPhase] ?? -1) >= (ranks[currentPhase] ?? -1)
}

export type RoomSettings = { total_rounds: number; question_seconds: number; categories: string[] }
export type PlayerProfile = {
  user_id: string
  display_name: string
  avatar_key: PlayerCharacterKey
}

function requireClient() {
  if (!supabase) throw new Error('Supabase ayarları eksik. .env dosyasını doldurup sunucuyu yeniden başlatın.')
  return supabase
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await requireClient().rpc(name, args)
  if (error) throw error
  return data as T
}

export async function ensureGuestSession(displayName: string): Promise<string> {
  const client = requireClient()
  let { data: { session } } = await client.auth.getSession()
  if (!session) {
    const { data, error } = await client.auth.signInAnonymously()
    if (error) throw error
    session = data.session
  }
  if (!session?.user) throw new Error('Misafir oturumu oluşturulamadı.')
  const name = displayName.trim()
  if (name) {
    const { error } = await client.rpc('set_display_name', { p_display_name: name })
    if (error) throw error
  }
  return session.user.id
}

export const loadMyProfile = () => rpc<PlayerProfile>('get_my_profile')
export const updateMyProfile = (displayName: string, avatarKey: PlayerCharacterKey) =>
  rpc<PlayerProfile>('update_my_profile', { p_display_name: displayName, p_avatar_key: avatarKey })

export const createRoom = (name: string, settings: RoomSettings) =>
  rpc<string>('create_room', {
    p_display_name: name,
    p_total_rounds: settings.total_rounds,
    p_question_seconds: settings.question_seconds,
    p_categories: settings.categories,
  })

export const joinRoom = (code: string, name: string) =>
  rpc<string>('join_room', { p_code: code.toUpperCase(), p_display_name: name })

export const setReady = (ready: boolean) => rpc<boolean>('set_ready', { p_ready: ready })
export const startGame = () => rpc<boolean>('start_game')
export const submitAnswer = (roundNumber: number, answer: string) =>
  rpc<boolean>('submit_answer', { p_round_number: roundNumber, p_answer: answer })
export const useAbility = (ability: AbilityKey, targetId?: string) =>
  rpc<boolean>('use_ability', { p_ability: ability, p_target_id: targetId ?? null })
export const castVote = (roundNumber: number, choiceId: string) =>
  rpc<boolean>('cast_vote', { p_round_number: roundNumber, p_target_id: choiceId })
export const loadRoomState = () => rpc<RoomState | null>('get_room_state')
export const loadRoundProgress = () => rpc<RoundProgress | null>('get_round_progress')
export const loadRoundReveal = () => rpc<RoundReveal | null>('get_round_reveal')
export const continueAfterScoreboard = (roundNumber: number) =>
  rpc<boolean>('continue_after_scoreboard', { p_round_number: roundNumber })
export const leaveRoom = () => rpc<boolean>('leave_room')

export function subscribeToRoom(
  roomId: string,
  userId: string,
  onChange: () => void,
  onConnection: (connected: boolean) => void,
  onPresence: (userIds: string[]) => void,
  onPoke: (targetUserId: string, senderUserId: string) => void,
): RealtimeChannel {
  const client = requireClient()
  const channel = client.channel(`room:${roomId}`, {
    config: { private: true, presence: { key: userId } },
  })
  roomChannels.set(roomId, channel)
  channel
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'game_events',
      filter: `room_id=eq.${roomId}`,
    }, onChange)
    .on('presence', { event: 'sync' }, () => {
      const users = Object.values(channel.presenceState<RoomPresence>())
        .flat()
        .map((presence) => presence.user_id)
        .filter((id): id is string => typeof id === 'string')
      onPresence(users)
      onChange()
    })
    .on('broadcast', { event: 'room_refresh' }, onChange)
    .on('broadcast', { event: 'room_poke' }, ({ payload }) => {
      const targetUserId = payload?.target_user_id
      const senderUserId = payload?.sender_user_id
      if (typeof targetUserId === 'string' && typeof senderUserId === 'string') {
        onPoke(targetUserId, senderUserId)
      }
    })
    .subscribe(async (status) => {
      const connected = status === 'SUBSCRIBED'
      onConnection(connected)
      if (connected) {
        await channel.track({ user_id: userId, online_at: new Date().toISOString() })
        onPresence(Object.values(channel.presenceState<RoomPresence>())
          .flat()
          .map((presence) => presence.user_id)
          .filter((id): id is string => typeof id === 'string'))
        onChange()
      }
    })
  return channel
}

export type RoomRefreshAction = 'ready' | 'start' | 'answer' | 'ability' | 'vote' | 'continue'

export async function broadcastRoomRefresh(roomId: string, action: RoomRefreshAction): Promise<void> {
  const channel = roomChannels.get(roomId)
  if (!channel || channel.state !== 'joined') return
  const status = await channel.send({
    type: 'broadcast',
    event: 'room_refresh',
    payload: { action },
  })
  if (status !== 'ok') throw new Error('Anlık bildirim iletilemedi; oda durumu veritabanından yeniden yükleniyor.')
}

export async function broadcastRoomPoke(roomId: string, targetUserId: string, senderUserId: string): Promise<void> {
  const channel = roomChannels.get(roomId)
  if (!channel || channel.state !== 'joined') {
    throw new Error('Dürtme gönderilemedi; oda bağlantısı kurulamadı.')
  }
  const status = await channel.send({
    type: 'broadcast',
    event: 'room_poke',
    payload: { target_user_id: targetUserId, sender_user_id: senderUserId },
  })
  if (status !== 'ok') throw new Error('Dürtme iletilemedi; bağlantını kontrol edip yeniden dene.')
}

export function removeRoomSubscription(roomId: string, channel: RealtimeChannel): void {
  if (roomChannels.get(roomId) === channel) roomChannels.delete(roomId)
  if (supabase) void supabase.removeChannel(channel)
}
