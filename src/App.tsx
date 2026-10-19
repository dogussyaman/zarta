import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  createRoom,
  ensureGuestSession,
  joinRoom,
  leaveRoom,
  isStateAtLeastAsNew,
  loadMyProfile,
  loadRoomState,
  removeRoomSubscription,
  castVote,
  broadcastRoomRefresh,
  broadcastRoomPoke,
  continueAfterScoreboard,
  loadRoundProgress,
  loadRoundReveal,
  setReady,
  startGame,
  submitAnswer,
  subscribeToRoom,
  updateMyProfile,
} from './lib/game'
import type { RoomSettings, RoomState, RoundProgress, RoundReveal } from './lib/game'
import { CATEGORIES, RULES } from './lib/rules'
import type { Category } from './lib/rules'
import { getPlayerCharacter, PLAYER_CHARACTERS } from './lib/profile'
import type { PlayerCharacterKey } from './lib/profile'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { RoundAnswerReveal } from './components/RoundAnswerReveal'
import { ContinueButton } from './components/ContinueButton'

const SettingsSelect = lazy(() => import('./components/SettingsSelect').then((module) => ({ default: module.SettingsSelect })))


const CATEGORY_CARDS_DATA: Record<Category, {
  image: string
  icon: string
  badge?: string
  accentColor: string
}> = {
  'Genel kültür': {
    image: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=400&q=80',
    icon: '📚',
    badge: 'KLASİK',
    accentColor: '#3b82f6',
  },
  'Hayvanlar âlemi': {
    image: 'https://images.unsplash.com/photo-1534188753412-3e26d0d618d6?auto=format&fit=crop&w=400&q=80',
    icon: '🦁',
    badge: 'POPÜLER',
    accentColor: '#eab308',
  },
  'Spor': {
    image: 'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?auto=format&fit=crop&w=400&q=80',
    icon: '🏋️',
    badge: 'PREMIUM',
    accentColor: '#f97316',
  },
  'Müzik': {
    image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80',
    icon: '🎵',
    badge: 'CANLI',
    accentColor: '#ec4899',
  },
  'Bilim ve teknoloji': {
    image: 'https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&w=400&q=80',
    icon: '🔬',
    badge: 'BİLİM',
    accentColor: '#14b8a6',
  },
  'Film ve dizi': {
    image: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=400&q=80',
    icon: '🎬',
    badge: 'SİNEMA',
    accentColor: '#8b5cf6',
  },
  'Tarih ve coğrafya': {
    image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=400&q=80',
    icon: '🏛️',
    badge: 'TARİH',
    accentColor: '#d97706',
  },
  'Yemek ve lezzet': {
    image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80',
    icon: '🍕',
    badge: 'LEZZET',
    accentColor: '#ef4444',
  },
  'Moda ve stil': {
    image: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=400&q=80',
    icon: '👗',
    badge: 'TREND',
    accentColor: '#a855f7',
  },
}

function App() {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [roundProgress, setRoundProgress] = useState<RoundProgress | null>(null)
  const [roundReveal, setRoundReveal] = useState<RoundReveal | null>(null)
  const [pokeNotice, setPokeNotice] = useState<string | null>(null)
  const refreshInFlight = useRef(false)
  const refreshQueued = useRef(false)
  const refreshExpectedRoomId = useRef<string | undefined>(undefined)
  const [name, setName] = useState('')
  const [avatarKey, setAvatarKey] = useState<PlayerCharacterKey>('spark')
  const [profileNameDraft, setProfileNameDraft] = useState('')
  const [profileAvatarDraft, setProfileAvatarDraft] = useState<PlayerCharacterKey>('spark')
  const [code, setCode] = useState('')
  const [rounds, setRounds] = useState(RULES.defaultRounds)
  const [seconds, setSeconds] = useState(RULES.defaultQuestionSeconds)
  const [category, setCategory] = useState<Category>(CATEGORIES[0])
  const [connection, setConnection] = useState<'loading' | 'ready' | 'connected' | 'reconnecting' | 'offline' | 'unconfigured'>(
    isSupabaseConfigured ? 'loading' : 'unconfigured',
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [answerDraft, setAnswerDraft] = useState('')
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [homeTab, setHomeTab] = useState<'play' | 'how' | 'categories'>('play')

  const refresh = useCallback(async (expectedRoomId?: string) => {
    if (!supabase) return
    if (refreshInFlight.current) {
      refreshQueued.current = true
      refreshExpectedRoomId.current = expectedRoomId
      return
    }
    refreshInFlight.current = true
    let requestRoomId = expectedRoomId
    try {
      do {
        refreshQueued.current = false
        refreshExpectedRoomId.current = requestRoomId
        const [state, progress] = await Promise.all([loadRoomState(), loadRoundProgress()])
        const reveal = state?.round && ['results', 'scoreboard', 'completed'].includes(state.round.phase)
          ? await loadRoundReveal()
          : null
        setRoom((current) => {
          if (requestRoomId && current?.room.id !== requestRoomId) return current
          return isStateAtLeastAsNew(current, state) ? state : current
        })
        if (!requestRoomId || state?.room.id === requestRoomId) {
          setRoundProgress(progress?.room_id === state?.room.id ? progress : null)
          setRoundReveal(reveal && state && reveal.room_id === state.room.id && reveal.round_number === state.round?.round_number
            ? reveal
            : null)
        }
        requestRoomId = refreshExpectedRoomId.current
      } while (refreshQueued.current)
    } finally {
      refreshInFlight.current = false
    }
  }, [])

  useEffect(() => {
    setAnswerDraft(room?.round?.my_answer ?? '')
  }, [room?.round?.round_number, room?.round?.my_answer])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    void (async () => {
      try {
        await ensureGuestSession('')
        const profile = await loadMyProfile()
        const state = await loadRoomState()
        if (!cancelled) {
          setName(profile.display_name === 'Oyuncu' ? '' : profile.display_name)
          setAvatarKey(profile.avatar_key)
          setRoom(state)
          setConnection(state ? 'reconnecting' : 'ready')
        }
      } catch (error) {
        if (!cancelled) {
          setConnection('offline')
          setMessage(errorMessage(error))
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!room || !supabase) return
    const client = supabase
    let userId = room.viewer_id
    let channel: RealtimeChannel | undefined
    let cancelled = false
    void client.auth.getUser().then(({ data, error }) => {
      if (cancelled) return
      if (error || !data.user) {
        setConnection('offline')
        setMessage('Oturum doğrulanamadı. Sayfayı yenileyip yeniden bağlan.')
        return
      }
      userId = data.user.id
      channel = subscribeToRoom(room.room.id, userId, () => {
        void refresh(room.room.id).catch((error: unknown) => setMessage(errorMessage(error)))
      }, (connected) => {
        setConnection(connected ? 'connected' : navigator.onLine ? 'reconnecting' : 'offline')
        if (!connected) setOnlineUsers([])
      }, setOnlineUsers, (targetUserId, senderUserId) => {
        if (targetUserId !== room.viewer_id) return
        setPokeNotice(senderUserId)
        navigator.vibrate?.([120, 70, 120])
      })
    })
    const onOnline = () => {
      setConnection('reconnecting')
      void refresh(room.room.id).catch((error: unknown) => setMessage(errorMessage(error)))
    }
    const onOffline = () => setConnection('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      if (channel) removeRoomSubscription(room.room.id, channel)
    }
  }, [room?.room.id, room?.viewer_id, refresh])

  useEffect(() => {
    if (room?.round?.phase === 'scoreboard') {
      setRemainingSeconds(0)
      return
    }
    const endAt = room?.room.status === 'countdown'
      ? room.room.countdown_ends_at
      : ['answering', 'answer_reveal', 'voting', 'results'].includes(room?.round?.phase ?? '') ? room?.round?.ends_at : null
    if (!endAt) {
      setRemainingSeconds(0)
      return
    }
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((new Date(endAt).getTime() - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [room?.room.status, room?.room.countdown_ends_at, room?.round?.ends_at, room?.round?.phase])

  useEffect(() => {
    const waitingForCountdown = room?.room.status === 'countdown' && remainingSeconds === 0
    const waitingForRoundTransition = ['answering', 'answer_reveal', 'voting', 'results'].includes(room?.round?.phase ?? '')
      && remainingSeconds === 0
    if (!waitingForCountdown && !waitingForRoundTransition) return
    const timer = window.setInterval(() => {
      void refresh(room!.room.id).catch((error: unknown) => setMessage(errorMessage(error)))
    }, waitingForCountdown ? 1000 : 2000)
    return () => window.clearInterval(timer)
  }, [remainingSeconds, room?.room.id, room?.room.status, room?.round?.phase, refresh])

  const winner = useMemo(() => [...(room?.players ?? [])].sort((a, b) => b.score - a.score)[0], [room?.players])
  const isHost = room?.viewer_id === room?.room.host_id
  const otherPlayers = useMemo(
    () => room?.players.filter((player) => player.user_id !== room?.viewer_id) ?? [],
    [room?.players, room?.viewer_id]
  )
  const allOthersReady = otherPlayers.length > 0 && otherPlayers.every((player) => player.is_ready)
  const myPlayer = useMemo(
    () => room?.players.find((player) => player.user_id === room?.viewer_id),
    [room?.players, room?.viewer_id]
  )
  const isMyReady = myPlayer?.is_ready ?? false
  const readyCount = room?.players.filter((player) => player.is_ready).length ?? 0
  const progressMatchesRound = roundProgress?.round_number === room?.round?.round_number
  const answeredPlayerIds = new Set(progressMatchesRound ? roundProgress?.answered_player_ids : [])
  const continuedPlayerIds = new Set(progressMatchesRound ? roundProgress?.continued_player_ids : [])
  const answeredPlayerCount = room?.players.filter((player) => answeredPlayerIds.has(player.user_id)).length ?? 0
  const continuedPlayerCount = room?.players.filter((player) => continuedPlayerIds.has(player.user_id)).length ?? 0
  const waitingToAnswer = progressMatchesRound
    ? room?.players.filter((player) => player.user_id !== room.viewer_id && !answeredPlayerIds.has(player.user_id)) ?? []
    : []
  const waitingToContinue = progressMatchesRound
    ? room?.players.filter((player) => !continuedPlayerIds.has(player.user_id)) ?? []
    : []
  const alreadyContinued = progressMatchesRound && continuedPlayerIds.has(room?.viewer_id ?? '')

  async function withBusy(action: () => Promise<unknown>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      if (supabase) await refresh()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  // Room host is automatically ready by default in the lobby; auto-sync if not ready
  useEffect(() => {
    if (!room || room.room.status !== 'lobby' || !isHost || busy) return
    const hostPlayer = room.players.find((p) => p.user_id === room.viewer_id)
    if (hostPlayer && !hostPlayer.is_ready) {
      void setReady(true).then(() => {
        void broadcastRoomRefresh(room.room.id, 'ready').catch(() => {})
        if (supabase) void refresh(room.room.id)
      }).catch(() => {})
    }
  }, [room?.room.status, room?.players, isHost, room?.room.id, busy, refresh])

  async function handleToggleReady(targetReady?: boolean) {
    if (!room) return
    const nextReady = typeof targetReady === 'boolean' ? targetReady : !isMyReady
    await withBusy(async () => {
      await setReady(nextReady)
      void broadcastRoomRefresh(room.room.id, 'ready').catch(() => {})
    })
  }

  async function handleHostStart() {
    if (!room) return
    await withBusy(async () => {
      if (!isMyReady) {
        await setReady(true)
      }
      await startGame()
      void broadcastRoomRefresh(room.room.id, 'start').catch(() => {})
    })
  }

  async function pokePlayer(targetId: string) {
    if (!room) return
    try {
      await broadcastRoomPoke(room.room.id, targetId, room.viewer_id)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  async function handleContinueAfterScoreboard() {
    if (!room?.round) return
    await withBusy(async () => {
      await continueAfterScoreboard(room.round!.round_number)
      void broadcastRoomRefresh(room.room.id, 'continue')
        .catch((error: unknown) => setMessage(errorMessage(error)))
    })
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) return setMessage('Önce bir oyuncu adı seç.')
    await withBusy(async () => {
      await ensureGuestSession(name)
      await createRoom(name, { total_rounds: rounds, question_seconds: seconds, categories: [category] } satisfies RoomSettings)
      await refresh()
      setShowSettings(false)
    })
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) return setMessage('Önce bir oyuncu adı seç.')
    if (code.trim().length !== 6) return setMessage('Oda kodu 6 karakter olmalı.')
    await withBusy(async () => {
      await ensureGuestSession(name)
      await joinRoom(code, name)
      await refresh()
    })
  }

  async function handleAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!room?.round) return
    if (!answerDraft.trim()) return setMessage('Önce bir cevap yaz.')
    await withBusy(async () => {
      await submitAnswer(room.round!.round_number, answerDraft)
      void broadcastRoomRefresh(room.room.id, 'answer').catch((error: unknown) => setMessage(errorMessage(error)))
    })
  }

  async function voteForPlayer(roundNumber: number, targetId: string) {
    if (!room) return
    await withBusy(async () => {
      await castVote(roundNumber, targetId)
      void broadcastRoomRefresh(room.room.id, 'vote').catch((error: unknown) => setMessage(errorMessage(error)))
    })
  }

  async function handleLeave() {
    await withBusy(async () => {
      await leaveRoom()
      setRoom(null)
      setRoundProgress(null)
      setRoundReveal(null)
      setPokeNotice(null)
      setCode('')
    })
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileNameDraft.trim()) return setMessage('Oyuncu adını yazmalısın.')
    await withBusy(async () => {
      await ensureGuestSession('')
      const profile = await updateMyProfile(profileNameDraft, profileAvatarDraft)
      setName(profile.display_name)
      setAvatarKey(profile.avatar_key)
      setShowProfile(false)
    })
  }

  function openProfile() {
    setProfileNameDraft(name)
    setProfileAvatarDraft(avatarKey)
    setShowProfile(true)
  }

  async function copyRoomCode() {
    try {
      if (!navigator.clipboard) throw new Error('Bu tarayıcı panoya kopyalamayı desteklemiyor.')
      await navigator.clipboard.writeText(room?.room.code ?? '')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  async function shareRoomInvite() {
    if (!room) return
    const inviteText = `Zarta oyunumuza katıl! Oda kodu: ${room.room.code}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Zarta Online', text: inviteText })
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(inviteText)
        setMessage('Davet metni kopyalandı. Arkadaşına gönderebilirsin.')
      } else {
        throw new Error('Bu tarayıcı davet paylaşmayı veya panoya kopyalamayı desteklemiyor.')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setMessage(errorMessage(error))
    }
  }

  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    if (room) void handleLeave()
    else {
      setMessage('')
      setShowSettings(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <div className="topbar-main">
          <a className="brand" href="#" onClick={goHome} aria-label="Zarta ana sayfa">
            <span className="brand-mark">Z</span>
            <span className="brand-title">ZARTA</span>
          </a>

          <div className="game-stat-bar" aria-label="Oyuncu kaynakları">
            <div className="stat-pill stat-energy" title="Enerji: 5/10">
              <span className="stat-icon">⚡</span>
              <span className="stat-val">5/10</span>
            </div>
            <div className="stat-pill stat-gems" title="Elmas: 500">
              <span className="stat-icon">💎</span>
              <span className="stat-val">500</span>
            </div>
            <div className="stat-pill stat-coins" title="Altın: 500">
              <span className="stat-icon">🟡</span>
              <span className="stat-val">500</span>
            </div>
          </div>

          <div className="topbar-actions">
            <button
              className="profile-trigger"
              aria-label={`Profili düzenle: ${name || 'oyuncu'}`}
              onClick={openProfile}
              title="Profil"
            >
              <PlayerAvatar avatarKey={avatarKey} />
              <span className="profile-name-text">{name || 'PROFİL'}</span>
            </button>
            <button className="icon-button settings-btn" aria-label="Oyun kurallarını aç" onClick={() => setShowSettings(true)} title="Ayarlar">⚙️</button>
          </div>
        </div>
      </header>

      {room && (connection === 'offline' || connection === 'reconnecting') && (
        <div className={`connection-banner ${connection}`} role="status">
          <span><strong>{connection === 'offline' ? 'Gerçek zamanlı bağlantı kesildi.' : 'Odaya yeniden bağlanılıyor.'}</strong> Oyun durumu sunucuda kayıtlı; bağlantı gelince otomatik eşitlenecek.</span>
          <button onClick={() => void refresh(room.room.id).catch((error: unknown) => setMessage(errorMessage(error)))}>Durumu yenile</button>
        </div>
      )}
      {pokeNotice && room && (
        <div className="poke-notice" role="status" aria-live="polite">
          <span>📳 {room.players.find((player) => player.user_id === pokeNotice)?.display_name ?? 'Bir oyuncu'} seni dürttü!</span>
          <button aria-label="Dürtme bildirimini kapat" onClick={() => setPokeNotice(null)}>×</button>
        </div>
      )}

      {message && (
        <div className="toast" role="alert">
          <span>{message}</span>
          <button aria-label="Bildirimi kapat" onClick={() => setMessage('')}>×</button>
        </div>
      )}

      {!room ? (
        <section className="home-layout">
          {/* Featured Section with 3D Purple Ribbon */}
          <div className="featured-section">
            <div className="game-ribbon ribbon-purple">
              <span className="ribbon-text">EN YENİLER</span>
            </div>
            <div
              className="featured-card"
              style={{
                backgroundImage: "linear-gradient(145deg, rgba(22, 163, 74, 0.88) 0%, rgba(21, 128, 61, 0.94) 100%), url('https://images.unsplash.com/photo-1512389142860-9c449e58a543?auto=format&fit=crop&w=600&q=80')",
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <div className="featured-card-badge">ÖZEL KATEGORİ</div>
              <div className="featured-card-body">
                <div className="featured-card-info">
                  <h3 className="featured-card-title">Zarta Partisi!</h3>
                  <p className="featured-card-desc">Arkadaşlarınla gerçek zamanlı zartalaşma vakti.</p>
                  <button
                    type="button"
                    className="featured-play-btn"
                    onClick={() => setShowSettings(true)}
                  >
                    <span>⚡ OYUNU BAŞLAT</span>
                  </button>
                </div>
                <div className="featured-card-mascot" aria-hidden="true">
                  <div className="mascot-face">🎅</div>
                  <div className="mascot-star star-1">✦</div>
                  <div className="mascot-star star-2">★</div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Action Section with 3D Purple Ribbon */}
          <section className="entry-card game-arcade-card">
            <div className="game-ribbon ribbon-purple">
              <span className="ribbon-text">KATEGORİLER & OYNA</span>
            </div>

            <div className="home-tabs" role="tablist" aria-label="Zarta ana menü">
              <button
                type="button"
                role="tab"
                id="home-tab-play"
                aria-selected={homeTab === 'play'}
                aria-controls="home-panel-play"
                className={homeTab === 'play' ? 'home-tab active' : 'home-tab'}
                onClick={() => setHomeTab('play')}
              >
                Oyna
              </button>
              <button
                type="button"
                role="tab"
                id="home-tab-categories"
                aria-selected={homeTab === 'categories'}
                aria-controls="home-panel-categories"
                className={homeTab === 'categories' ? 'home-tab active' : 'home-tab'}
                onClick={() => setHomeTab('categories')}
              >
                Kategoriler
              </button>
              <button
                type="button"
                role="tab"
                id="home-tab-how"
                aria-selected={homeTab === 'how'}
                aria-controls="home-panel-how"
                className={homeTab === 'how' ? 'home-tab active' : 'home-tab'}
                onClick={() => setHomeTab('how')}
              >
                Nasıl Oynanır?
              </button>
            </div>

            {homeTab === 'play' ? (
              <div className="home-tab-panel home-tab-panel-enter" role="tabpanel" id="home-panel-play" aria-labelledby="home-tab-play">
                <div className="game-field-group">
                  <label className="field-label" htmlFor="player-name">
                    OYUNCU ADIN
                  </label>
                  <div className="game-input-wrap">
                    <span className="game-input-icon">👤</span>
                    <input
                      id="player-name"
                      className="text-input game-text-input"
                      maxLength={24}
                      minLength={2}
                      placeholder="Sana nasıl seslenelim?"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    {name && (
                      <button
                        type="button"
                        className="input-clear-btn"
                        onClick={() => setName('')}
                        aria-label="Adı temizle"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {!isSupabaseConfigured && (
                  <p className="setup-notice">Önce Supabase bağlantısı kurulmalı. `.env.example` dosyasını `.env` olarak kopyalayıp proje anahtarlarını gir.</p>
                )}

                <form onSubmit={handleJoin} className="join-form">
                  <label className="field-label" htmlFor="room-code">
                    ODA KODUN VAR MI?
                  </label>
                  <div className="join-row">
                    <div className="game-input-wrap code-wrap">
                      <span className="game-input-icon">🔑</span>
                      <input
                        id="room-code"
                        className="text-input code-input game-text-input"
                        maxLength={6}
                        placeholder="ÖRN. Z4RTA2"
                        value={code}
                        onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
                        aria-label="Oda kodu"
                      />
                      {code && (
                        <button
                          type="button"
                          className="input-clear-btn"
                          onClick={() => setCode('')}
                          aria-label="Kodu temizle"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <button
                      className="button button-blue-3d join-button"
                      disabled={!isSupabaseConfigured || busy || !code.trim()}
                      type="submit"
                    >
                      <span>KATIL ↗</span>
                    </button>
                  </div>
                </form>

                <div className="or-divider">
                  <span className="divider-line" />
                  <span className="divider-label">YA DA YENİ BİR MASA AÇ</span>
                  <span className="divider-line" />
                </div>

                <button
                  className="button button-green-3d big-play-button"
                  disabled={!isSupabaseConfigured || busy}
                  onClick={() => setShowSettings(true)}
                >
                  <span className="btn-lightning">⚡</span>
                  <span className="btn-text">OYUN OLUŞTUR</span>
                </button>

                <div className="card-foot">
                  <span>◈ Ücretsiz</span>
                  <span>✦ Hesap Açmak Yok</span>
                  <span>📱 Mobil Uyumlu</span>
                </div>
              </div>
            ) : homeTab === 'categories' ? (
              <div className="home-tab-panel home-tab-panel-enter categories-panel" role="tabpanel" id="home-panel-categories" aria-labelledby="home-tab-categories">
                <div className="category-arcade-grid">
                  {CATEGORIES.map((catName) => {
                    const data = CATEGORY_CARDS_DATA[catName]
                    const isSelected = category === catName
                    return (
                      <button
                        key={catName}
                        type="button"
                        className={`category-arcade-card ${isSelected ? 'category-card-selected' : ''}`}
                        style={{
                          backgroundImage: `url(${data.image})`,
                          borderColor: isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.22)',
                        }}
                        onClick={() => {
                          setCategory(catName)
                          setShowSettings(true)
                        }}
                      >
                        <div className="category-card-overlay" />
                        <div className="cat-card-top">
                          <span className="cat-card-glass-icon">{data.icon}</span>
                          {data.badge && (
                            <span className="cat-card-badge" style={{ backgroundColor: data.accentColor }}>
                              {data.badge}
                            </span>
                          )}
                        </div>
                        <div className="cat-card-bottom">
                          <span className="cat-card-title">{catName}</span>
                          <span className="cat-card-play-arrow">▶</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <button
                  className="button button-green-3d big-play-button"
                  style={{ marginTop: '14px' }}
                  onClick={() => setShowSettings(true)}
                >
                  <span className="btn-lightning">⚡</span>
                  <span className="btn-text">OYUN OLUŞTUR</span>
                </button>
              </div>
            ) : (
              <div className="home-tab-panel home-tab-panel-enter how-to-panel" role="tabpanel" id="home-panel-how" aria-labelledby="home-tab-how">
                <ol className="arcade-steps-list">
                  <li>
                    <span className="arcade-step-num">01</span>
                    <div>
                      <strong>Odaya Katıl</strong>
                      <p>Kodu yazarak arkadaşlarına katıl veya yeni masa aç.</p>
                    </div>
                  </li>
                  <li>
                    <span className="arcade-step-num">02</span>
                    <div>
                      <strong>Soruyu Oku</strong>
                      <p>Herkes aynı genel kültür sorusunu aynı anda görür.</p>
                    </div>
                  </li>
                  <li>
                    <span className="arcade-step-num">03</span>
                    <div>
                      <strong>Blöfünü Yaz</strong>
                      <p>Herkesi kandıracak inandırıcı bir yalan cevap uydur.</p>
                    </div>
                  </li>
                  <li>
                    <span className="arcade-step-num">04</span>
                    <div>
                      <strong>Gerçeği Seç & Zartala</strong>
                      <p>Doğruya +1; blöfüne inanan her oyuncu için +2 puan kap!</p>
                    </div>
                  </li>
                </ol>
                <button
                  className="button button-green-3d big-play-button"
                  onClick={() => setHomeTab('play')}
                >
                  <span className="btn-lightning">⚡</span>
                  <span className="btn-text">HEMEN OYNA</span>
                </button>
              </div>
            )}
          </section>

          <div className="home-bottom-tagline">
            <span className="tagline-star">✦</span>
            <span>Başka bir kullanıcıyı zartalamak doğru cevap vermekten daha çok kazandırır!</span>
          </div>
        </section>
      ) : (
        <section className="game-layout">
          {room.room.status === 'lobby' ? (
            <div className="lobby-arcade-container">
              {/* Clean Lobby Nav Header */}
              <div className="lobby-nav-header">
                <button className="back-link-btn" onClick={handleLeave}>
                  ‹ Ana sayfa
                </button>
                <div className="lobby-nav-center">
                  <span className="lobby-title-badge">OYUN LOBİSİ</span>
                </div>
                <div className="lobby-nav-actions">
                  <button className="icon-button settings-btn" onClick={() => setShowSettings(true)} title="Oyun Ayarları">⚙️</button>
                </div>
              </div>

              {/* Top Banner with Room Code and Quick Action */}
              <div className="lobby-top-card">
                <div className="lobby-code-group">
                  <span className="lobby-code-label">ODA KODU</span>
                  <div className="lobby-code-pill">
                    <strong className="lobby-code-text">{room.room.code}</strong>
                    <button
                      type="button"
                      className="lobby-copy-btn"
                      onClick={() => void copyRoomCode()}
                      title="Kodu Kopyala"
                    >
                      📋
                    </button>
                  </div>
                  <button
                    type="button"
                    className="button button-blue-3d lobby-share-btn"
                    onClick={() => void shareRoomInvite()}
                  >
                    <span>DAVET ET ↗</span>
                  </button>
                </div>

                <div className="lobby-quick-meta">
                  <span className="meta-pill">⏱️ {room.room.question_seconds} sn</span>
                  <span className="meta-pill">🎯 {room.room.categories.join(', ')}</span>
                  <button className="lobby-settings-link" onClick={() => setShowSettings(true)}>
                    ⚙️ Ayarlar
                  </button>
                </div>
              </div>

              {/* Main Lobby Arcade Grid */}
              <div className="lobby-grid">
                <section className="game-panel lobby-panel arcade-panel">
                  {/* Round Track / Tur Sayısı (Yellow Ribbon) */}
                  <div className="lobby-rounds-section">
                    <div className="game-ribbon ribbon-gold">
                      <span className="ribbon-text">TUR SAYISI: {room.room.total_rounds} TUR</span>
                    </div>
                    <div className="round-step-track" aria-label="Tur sayısı göstergesi">
                      <div className="track-line" />
                      {[3, 5, 7, 10, 15, 20].map((num) => {
                        const isSelected = room.room.total_rounds === num
                        return (
                          <div key={num} className={`round-step-node ${isSelected ? 'active' : ''}`}>
                            <div className="step-knob">{isSelected ? '●' : ''}</div>
                            <span className="step-num">{num}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Players Section (Blue Ribbon) */}
                  <div className="lobby-players-section">
                    <div className="game-ribbon ribbon-blue">
                      <span className="ribbon-text">MASADAKİ OYUNCULAR ({room.players.length}/10)</span>
                    </div>

                    <div className="player-grid arcade-player-grid">
                      {room.players.map((player) => (
                        <PlayerTile
                          key={player.user_id}
                          player={player}
                          isOnline={onlineUsers.includes(player.user_id)}
                          isViewer={player.user_id === room.viewer_id}
                          onToggleReady={() => void handleToggleReady()}
                        />
                      ))}
                      {/* Generous empty slots to give realistic arcade party room feel */}
                      {Array.from({ length: Math.max(1, Math.min(4, 8 - room.players.length)) }).map((_, idx) => (
                        <button
                          key={`invite-slot-${idx}`}
                          type="button"
                          className="invite-tile arcade-invite-tile"
                          onClick={() => void shareRoomInvite()}
                          title="Arkadaşını davet et"
                        >
                          <div className="invite-avatar-circle">＋</div>
                          <strong className="invite-title">{idx === 0 ? 'Davet Et' : 'Boş Koltuk'}</strong>
                          <small className="invite-code">{room.room.code}</small>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Ready progress & Waiting Nudge */}
                  <div className="lobby-status-banner">
                    <div className="lobby-status-bar">
                      <span className="status-pulse" />
                      <strong>{readyCount} / {room.players.length} Oyuncu Hazır</strong>
                    </div>
                  </div>

                  {room.players.some((player) => player.user_id !== room.viewer_id && !player.is_ready) && (
                    <div className="lobby-nudge-panel">
                      <div className="waiting-panel-heading">
                        <strong>Hazır olması beklenenler</strong>
                        <span>{room.players.filter((player) => player.user_id !== room.viewer_id && !player.is_ready).length} oyuncu</span>
                      </div>
                      <WaitingPlayers
                        players={room.players.filter((player) => player.user_id !== room.viewer_id && !player.is_ready)}
                        onlineUsers={onlineUsers}
                        onPoke={(playerId) => void pokePlayer(playerId)}
                        emptyMessage="Herkes hazır."
                      />
                    </div>
                  )}

                  {/* Main Action Button */}
                  <div className="lobby-actions">
                    {isHost ? (
                      <div className="host-actions-wrapper">
                        <button
                          className="button button-green-3d big-play-button"
                          disabled={busy || room.players.length < 2 || !allOthersReady}
                          onClick={() => void handleHostStart()}
                        >
                          <span className="btn-lightning">⚡</span>
                          <span className="btn-text">
                            {room.players.length < 2
                              ? 'EN AZ 2 OYUNCU GEREKİYOR'
                              : !allOthersReady
                                ? 'DİĞER OYUNCULARIN HAZIR OLMASI BEKLENİYOR'
                                : 'OYUNU BAŞLAT'}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`host-ready-toggle-btn ${isMyReady ? 'is-ready' : ''}`}
                          disabled={busy}
                          onClick={() => void handleToggleReady()}
                          title="Hazır durumunu manuel değiştir"
                        >
                          {isMyReady ? '✓ Hazırsın (Değiştir)' : '⚡ Hazır Ol'}
                        </button>
                      </div>
                    ) : (
                      <button
                        className={`button ${myPlayer?.is_ready ? 'button-secondary' : 'button-green-3d'} big-play-button`}
                        disabled={busy}
                        onClick={() => void handleToggleReady()}
                      >
                        <span className="btn-lightning">{myPlayer?.is_ready ? '✓' : '⚡'}</span>
                        <span className="btn-text">
                          {myPlayer?.is_ready ? 'HAZIRSIN (İPTAL ET)' : 'HAZIR OL'}
                        </span>
                      </button>
                    )}
                  </div>
                </section>

                {/* Side Rules & Summary Panel */}
                <aside className="game-panel side-panel arcade-side-panel">
                  <div className="game-ribbon ribbon-purple side-ribbon">
                    <span className="ribbon-text">BU MASADA</span>
                  </div>
                  <div className="side-rules-content">
                    <RuleLine icon="◉" title={`${room.room.total_rounds} Tur`} detail={`${room.room.question_seconds} saniyede cevabını ver`} />
                    <RuleLine icon="✦" title="Doğru Cevap: +1 Puan" detail="Gerçek cevabı bulan kazanır" />
                    <RuleLine icon="⚡" title="Zarta Blöfü: +2 Puan" detail="Kandırdığın her oyuncu için" />
                  </div>
                  <div className="category-mini">
                    <span className="section-kicker">KATEGORİ</span>
                    <div className="lobby-category-badge-list">
                      {room.room.categories.map((cat) => {
                        const catData = CATEGORY_CARDS_DATA[cat as Category]
                        return (
                          <div
                            key={cat}
                            className="lobby-cat-card"
                            style={{
                              backgroundImage: catData ? `linear-gradient(180deg, rgba(15,23,42,0.4) 0%, rgba(10,14,38,0.92) 100%), url(${catData.image})` : undefined,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }}
                          >
                            {catData && <span className="cat-icon-badge">{catData.icon}</span>}
                            <span className="cat-card-name">{cat}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          ) : (
            <>
              <div className="game-topline">
                <div>
                  <button className="back-link" onClick={handleLeave}>← Ana sayfa</button>
                  <div className="room-code-line">ODA KODU <button className="room-code" onClick={() => void copyRoomCode()}>{room.room.code} <span>▣</span></button> <button className="button-link room-share-button" onClick={() => void shareRoomInvite()}>Davet et ↗</button></div>
                </div>
                <div className="round-counter">
                  <span className="section-kicker">OYUN DEVAM EDİYOR</span>
                  {room.room.current_round > 0 && <strong>Tur {room.room.current_round}<span> / {room.room.total_rounds}</span></strong>}
                </div>
              </div>

              {room.room.status === 'countdown' ? (
            <div className="countdown-layout">
              <div className="countdown-orb">{remainingSeconds > 0 ? remainingSeconds : '✦'}</div>
              <span className="section-kicker">İLK SORU GELİYOR</span>
              <h1>Hazır ol,<br /><span>zarta başlıyor.</span></h1>
              <p>Sunucu zamanlayıcısı başlatıldı. Sayfayı yenilesen de geri sayım devam eder.</p>
              <Scoreboard players={room.players} viewerId={room.viewer_id} compact />
            </div>
          ) : room.room.status === 'finished' ? (
            <div className="finish-layout">
              <div className="winner-orb">🏆</div>
              <span className="section-kicker">SON SORU DA CEVAPLANDI</span>
              <h1>Bu masanın yıldızı<br /><span>{winner?.display_name ?? '—'}</span></h1>
              <p className="hero-description">Güzel oyundu! Puan tablosu aşağıda, rövanş için yeni oda kur.</p>
              {room.round?.scoreboard.length
                ? <RoundScoreboard entries={room.round.scoreboard} viewerId={room.viewer_id} final />
                : <Scoreboard players={room.players} viewerId={room.viewer_id} />}
              {room.round?.question?.correct_answer && (
                <section className="finish-round-results" aria-label="Son turun sonuçları">
                  <span className="section-kicker">SON TUR · GERÇEK CEVAP</span>
                  <h2>{room.round.question.prompt}</h2>
                  <p className="correct-answer-callout">{room.round.question.correct_answer}</p>
                  <div className="result-answer-list">
                    {room.round.answers.map((answer) => <div className="answer-card" key={answer.player_id}>
                      <span>{answer.display_name}</span><strong>{answer.answer_text}</strong>
                      <b>{answer.fooled_count > 0 ? `${answer.fooled_count} kişi kandı · +${answer.fooled_count * 2}` : 'Kimse kanmadı'}</b>
                    </div>)}
                  </div>
                </section>
              )}
              <button className="button button-primary" onClick={handleLeave}>Lobiye dön <span>→</span></button>
            </div>
          ) : (
            <div className={room.round?.phase === 'answering' && room.round.my_answer ? 'play-grid play-grid-single answer-waiting-page' : 'play-grid play-grid-single'}>
              <section className={room.round?.phase === 'answering' && room.round.my_answer ? 'game-panel question-panel question-panel-waiting' : 'game-panel question-panel'}>
                {room.round?.phase === 'answering' ? (
                  <>
                    {room.round.my_answer ? (
                      <div className="answer-waiting-heading">
                        <div className="results-icon">⏳</div>
                        <span className="section-kicker">CEVABIN KAYDEDİLDİ</span>
                        <h1>Bekleme <span>odası</span></h1>
                        <p>Blöfün kilitlendi. Diğer oyuncular cevaplarını gönderirken buradan canlı olarak takip edebilirsin.</p>
                        <div className="question-meta"><span className="category-chip">{room.round.question?.category}</span><span className={remainingSeconds < 10 ? 'timer-badge timer-badge-urgent' : 'timer-badge'} role="timer" aria-label={`Kalan süre: ${remainingSeconds} saniye`}>◷ {remainingSeconds} sn</span></div>
                        {progressMatchesRound ? <><div className="waiting-progress"><span>{answeredPlayerCount} / {room.players.length} OYUNCU CEVAP VERDİ</span><i><b style={{ width: `${room.players.length ? answeredPlayerCount / room.players.length * 100 : 0}%` }} /></i></div><WaitingPlayers players={waitingToAnswer} onlineUsers={onlineUsers} onPoke={(playerId) => void pokePlayer(playerId)} emptyMessage="Herkes cevabını gönderdi. Sonuçlar birazdan açılacak." /></> : <p className="answer-private">Oyuncu durumu yükleniyor…</p>}
                      </div>
                    ) : (
                    <>
                    <div className="question-meta">
                      <span className="category-chip">{room.round.question?.category}</span>
                      <span className="difficulty">{room.round.question?.difficulty}</span>
                      <span className={`timer-badge ${remainingSeconds < 10 ? 'timer-badge-urgent' : ''}`} role="timer" aria-label={`Kalan süre: ${remainingSeconds} saniye`}>
                        ◷ {remainingSeconds} sn
                      </span>
                    </div>
                    <div className="question-content">
                      <span className="question-overline">SORU {String(room.room.current_round).padStart(2, '0')} · BLÖFÜNÜ YAZ</span>
                      <h1>{room.round.question?.prompt ?? 'Soru yükleniyor…'}</h1>
                      <p className="bluff-hint">Gerçek cevabı yazma. Arkadaşlarının inanacağı, yaratıcı bir yanlış cevap uydur.</p>
                    </div>
                    {room.round.my_answer ? (
                      <div className="waiting-state">
                        <div className="waiting-state-heading">
                          <span className="waiting-state-icon">⏳</span>
                          <div>
                            <span className="section-kicker">CEVABIN KİLİTLENDİ</span>
                            <h2>Oyuncuları bekle</h2>
                          </div>
                          <span className={`timer-badge ${remainingSeconds < 10 ? 'timer-badge-urgent' : ''}`}>{remainingSeconds} sn</span>
                        </div>
                        <p>Blöfün gizli. Cevap vermeyen arkadaşlarına dokunup hatırlatabilirsin.</p>
                        {progressMatchesRound ? (
                          <>
                            <div className="waiting-progress">
                              <span>{answeredPlayerCount} / {room.players.length} CEVAP VERDİ</span>
                              <i><b style={{ width: `${room.players.length ? answeredPlayerCount / room.players.length * 100 : 0}%` }} /></i>
                            </div>
                            <WaitingPlayers
                              players={waitingToAnswer}
                              onlineUsers={onlineUsers}
                              onPoke={(playerId) => void pokePlayer(playerId)}
                              emptyMessage="Herkes cevabını gönderdi. Sonuçlar birazdan açılacak."
                            />
                          </>
                        ) : <p className="answer-private">Oyuncu durumu yükleniyor…</p>}
                      </div>
                    ) : (
                      <form className="answer-form" onSubmit={(event) => void handleAnswer(event)}>
                        <label className="field-label" htmlFor="round-answer">İnandırıcı bir yanlış cevap yaz</label>
                        <textarea id="round-answer" className="text-input answer-input" maxLength={120} rows={3} value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} placeholder="Arkadaşlarını hangi blöf kandırır?…" disabled={busy || remainingSeconds <= 0} />
                        <button className="button button-primary answer-submit" type="submit" disabled={busy || remainingSeconds <= 0 || !answerDraft.trim()}>
                          Blöfünü gönder <span>→</span>
                        </button>
                      </form>
                    )}
                    </>
                    )}
                  </>
                ) : room.round?.phase === 'answer_reveal' ? (
                  <div className="results-state answer-reveal-state">
                    <div className="results-icon">👀</div>
                    <span className="section-kicker">CEVAPLAR KİLİTLENDİ</span>
                    <h2>Blöfleri incele,<br /><span>gerçeği bul!</span></h2>
                    <p>Herkesin cevabı kilitlendi. Gerçek cevap da aralarında; isimler gizli.</p>
                    <div className="result-answer-list">
                      {room.round.answer_choices.map((choice, index) => (
                        <div className="answer-card answer-choice" key={choice.choice_id}>
                          <span className="choice-number">{String.fromCharCode(65 + index)}</span>
                          <strong>{choice.answer_text}</strong>
                          {choice.is_mine && <small className="own-bluff-label">Senin blöfün</small>}
                        </div>
                      ))}
                    </div>
                    <p className="answer-private">Birazdan gerçek cevabı seçme aşaması başlayacak.</p>
                  </div>
                ) : room.round?.phase === 'voting' ? (
                  <div className="results-state voting-state">
                    <div className="results-icon">🎯</div>
                    <span className="section-kicker">DOĞRU CEVABI BUL</span>
                    <h2>Hangisi<br /><span>gerçek cevap?</span></h2>
                    <p>Tüm blöfler ve gerçek cevap karıştırıldı. Doğru seçime +1; blöfüne düşürdüğün her oyuncu için +2 puan.</p>
                    <div className="result-answer-list">
                      {room.round.answer_choices.map((choice, index) => {
                        const selected = room.round?.my_vote_choice === choice.choice_id
                        const className = `answer-card answer-choice ${selected ? 'answer-choice-selected' : ''}`
                        return choice.is_mine
                          ? <div className={className} key={choice.choice_id}>
                            <span className="choice-number">{String.fromCharCode(65 + index)}</span><strong>{choice.answer_text}</strong>
                            <small className="own-bluff-label">Senin blöfün</small>
                          </div>
                          : <button
                            className={className}
                            key={choice.choice_id}
                            type="button"
                            aria-pressed={selected}
                            disabled={busy || remainingSeconds <= 0 || Boolean(room.round?.my_vote_choice)}
                            onClick={() => void voteForPlayer(room.round!.round_number, choice.choice_id)}
                          >
                            <span className="choice-number">{String.fromCharCode(65 + index)}</span><strong>{choice.answer_text}</strong>
                            <span className="choice-action">{selected ? 'Seçimin kaydedildi ✓' : room.round?.my_vote_choice ? 'Seçim yapıldı' : 'Cevabı seç →'}</span>
                          </button>
                      })}
                    </div>
                    <p className="answer-private">{room.round.my_vote_choice ? 'Seçimin kaydedildi. Diğer oyuncuların kararını bekle.' : `${remainingSeconds} saniye içinde gerçek olduğunu düşündüğün cevabı seç.`}</p>
                  </div>
                ) : room.round?.phase === 'results' ? (
                  <div className="results-state round-reveal-state">
                    {roundReveal?.room_id === room.room.id && roundReveal.round_number === room.round.round_number
                      ? <RoundAnswerReveal answers={roundReveal.answers} roundNumber={room.round.round_number} />
                      : <p>Cevap sonuçları yükleniyor…</p>}
                    {room.round.personal_result && <div className="round-personal-summary">
                      <span className="section-kicker">SENİN TUR SONUCUN</span>
                      <strong>
                        {room.round.personal_result.zartalandi_by.length > 0
                          ? 'ZARTALANDIN!'
                          : room.round.personal_result.answered_correctly
                            ? 'DOĞRU BİLDİN!'
                            : room.round.personal_result.fooled_players.length > 0
                              ? 'ZARTAN TUTTU!'
                              : room.round.personal_result.has_voted
                                ? 'TUR TAMAMLANDI'
                                : 'BU TUR CEVAP VERMEDİN'}
                      </strong>
                      {room.round.personal_result.answered_correctly && room.round.personal_result.fooled_players.length > 0 && <small className="personal-achievement">Ayrıca blöfün tuttu; diğer oyuncuları da kandırdın!</small>}
                      <span>{room.round.personal_result.score_delta >= 0 ? '+' : ''}{room.round.personal_result.score_delta} puan</span>
                      {room.round.personal_result.fooled_players.length > 0 && <small>
                        Blöfüne kananlar: {room.round.personal_result.fooled_players.map((player) => player.display_name).join(', ')}
                      </small>}
                      {room.round.personal_result.zartalandi_by.length > 0 && <small>
                        Seni zartalayanlar: {room.round.personal_result.zartalandi_by.map((player) => player.display_name).join(', ')}
                      </small>}
                    </div>}
                  </div>
                ) : room.round?.phase === 'scoreboard' ? (
                  <div className="results-state scoreboard-state">
                    <div className="results-icon">🏆</div>
                    <span className="section-kicker">ORTAK SKOR TABLOSU</span>
                    <h2>Tur {room.round.round_number}<br /><span>puan durumu</span></h2>
                    {room.round.scoreboard.length > 0
                      ? <RoundScoreboard entries={room.round.scoreboard} viewerId={room.viewer_id} />
                      : <p>Skor tablosu yükleniyor…</p>}
                    <p>Diğer oyuncuların devam etmesini beklerken istersen onları dürtebilirsin.</p>
                    <div className="continue-panel">
                      {progressMatchesRound ? (
                        <>
                          <div className="waiting-progress">{continuedPlayerCount} / {room.players.length} oyuncu devam etmeye hazır</div>
                          {alreadyContinued
                            ? <p className="continue-confirmation">Hazırsın. Diğer oyuncular bekleniyor…</p>
                            : <ContinueButton
                              label={room.round.round_number === room.room.total_rounds ? 'Oyunu bitir' : 'Devam et'}
                              sentLabel="Tamam"
                              disabled={busy}
                              onClick={handleContinueAfterScoreboard}
                            />}
                          <WaitingPlayers
                            players={waitingToContinue.filter((player) => player.user_id !== room.viewer_id)}
                            onlineUsers={onlineUsers}
                            onPoke={(playerId) => void pokePlayer(playerId)}
                            emptyMessage="Herkes devam etmeye hazır."
                          />
                        </>
                      ) : (
                        <p className="answer-private">Oyuncu durumu yükleniyor…</p>
                      )}
                    </div>
                  </div>
                ) : <p>Tur durumu eşitleniyor…</p>}
              </section>
            </div>
          )}
        </>
      )}
    </section>
      )}

      <footer className="footer"><span>© ZARTA ONLINE</span><span>İYİ OYUNLAR, TATLI REKABETLER <b>✦</b></span><span className={`footer-status ${connection}`}>{footerConnectionText(connection)} <i /></span></footer>

      {showProfile && (
        <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !busy) setShowProfile(false) }}>
          <section className="settings-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <button className="modal-close" aria-label="Profili kapat" disabled={busy} onClick={() => setShowProfile(false)}>×</button>
            <span className="section-kicker">SENİN OYUNCUN</span>
            <h2 id="profile-title">Profili düzenle</h2>
            <form onSubmit={(event) => void handleSaveProfile(event)}>
              <label className="field-label" htmlFor="profile-name">Oyuncu adın</label>
              <input
                id="profile-name"
                className="text-input"
                value={profileNameDraft}
                onChange={(event) => setProfileNameDraft(event.target.value)}
                maxLength={24}
                minLength={2}
                placeholder="2–24 karakter"
                autoComplete="nickname"
                required
              />
              <span className="field-label character-label">Karakterini seç</span>
              <div className="character-picker" role="group" aria-label="Oyuncu karakteri">
                {PLAYER_CHARACTERS.map((character) => (
                  <button
                    className={`character-choice ${profileAvatarDraft === character.key ? 'active' : ''}`}
                    type="button"
                    key={character.key}
                    aria-label={character.name}
                    aria-pressed={profileAvatarDraft === character.key}
                    onClick={() => setProfileAvatarDraft(character.key)}
                  >
                    <PlayerAvatar avatarKey={character.key} />
                    <span>{character.name}</span>
                  </button>
                ))}
              </div>
              <button className="button button-primary modal-submit" disabled={busy || !isSupabaseConfigured} type="submit">
                {busy ? 'Kaydediliyor…' : 'Profili kaydet'} <span>→</span>
              </button>
            </form>
          </section>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setShowSettings(false) }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button className="modal-close" aria-label="Kapat" onClick={() => setShowSettings(false)}>×</button>
            <span className="section-kicker">{room ? 'ODA AYARLARI' : 'YENİ ODA'}</span>
            <h2 id="settings-title">{room ? 'Kurallara göz at' : 'Masayı sen kur'}</h2>
            {!room && <form onSubmit={(event) => void handleCreate(event)}>
              <label className="field-label" htmlFor="create-name">Oyuncu adın</label>
              <input id="create-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder="Sana nasıl seslenelim?" />
              <div className="settings-row">
                <div className="settings-select-field">
                  <label id="rounds-label" className="field-label" htmlFor="room-rounds">Tur sayısı</label>
                  <Suspense fallback={<div className="settings-select-placeholder" aria-hidden="true" />}>
                    <SettingsSelect
                      id="room-rounds"
                      labelId="rounds-label"
                      value={rounds}
                      onValueChange={setRounds}
                      options={[3, 5, 7, 10].map((number) => ({ value: number, label: `${number} tur` }))}
                    />
                  </Suspense>
                </div>
                <div className="settings-select-field">
                  <label id="seconds-label" className="field-label" htmlFor="room-seconds">Cevap süresi</label>
                  <Suspense fallback={<div className="settings-select-placeholder" aria-hidden="true" />}>
                    <SettingsSelect
                      id="room-seconds"
                      labelId="seconds-label"
                      value={seconds}
                      onValueChange={setSeconds}
                      options={[15, 20, 30, 45].map((number) => ({ value: number, label: `${number} saniye` }))}
                    />
                  </Suspense>
                </div>
              </div>
              <fieldset className="category-fieldset">
                <legend className="field-label category-label">Kategori <small>Bir tane seç</small></legend>
                <div className="category-picker" role="radiogroup" aria-label="Oyun kategorisi">
                  {CATEGORIES.map((item) => {
                    const data = CATEGORY_CARDS_DATA[item]
                    const isSelected = category === item
                    return (
                      <label
                        className={`category-choice category-card ${isSelected ? 'active' : ''}`}
                        key={item}
                        style={{
                          backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.3) 0%, rgba(10,14,38,0.88) 100%), url(${data.image})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }}
                      >
                        <input
                          className="category-radio"
                          type="radio"
                          name="room-category"
                          value={item}
                          checked={isSelected}
                          onChange={() => setCategory(item)}
                        />
                        <span className="modal-cat-icon" aria-hidden="true">{data.icon}</span>
                        <span className="category-name">{item}</span>
                        <span className="category-selected" aria-hidden="true">✓</span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              <button className="button button-primary modal-submit" disabled={!isSupabaseConfigured || busy} type="submit">{busy ? 'Oda kuruluyor…' : 'Odayı oluştur'} <span>→</span></button>
            </form>}
            {room && <div className="rules-modal-content">
              <p>Oda ayarları oyun başladıktan sonra değiştirilemez. Gerçek cevabı bul <strong>+1</strong>; blöfüne düşürdüğün her oyuncu için <strong>+2</strong> puan.</p>
              <p><strong>Kalkan / Blok</strong> bir Zartayı engeller. <strong>Misilleme</strong> cezayı saldırana geri yansıtır. <strong>Joker</strong> cevabını tur süresince değiştirmeni sağlar.</p>
              <button className="button button-secondary modal-submit" onClick={() => setShowSettings(false)}>Anladım</button>
            </div>}
          </section>
        </div>
      )}
    </main>
  )
}

function PlayerAvatar({ avatarKey }: { avatarKey: PlayerCharacterKey }) {
  const character = getPlayerCharacter(avatarKey)
  return <span
    className="player-avatar"
    style={{ background: character.color, color: '#171322' }}
    role="img"
    aria-label={character.name}
  >{character.emoji}</span>
}

function PlayerTile({
  player,
  isOnline,
  isViewer,
  onToggleReady,
}: {
  player: RoomState['players'][number]
  isOnline: boolean
  isViewer?: boolean
  onToggleReady?: () => void
}) {
  return (
    <div
      className={`player-tile arcade-player-tile ${player.is_ready ? 'player-is-ready' : ''} ${isViewer ? 'is-viewer-tile' : ''}`}
      onClick={isViewer && onToggleReady ? onToggleReady : undefined}
      title={isViewer ? 'Hazır durumunu değiştirmek için tıkla' : undefined}
    >
      <div className="player-avatar-wrap arcade-avatar-wrap">
        <PlayerAvatar avatarKey={player.avatar_key} />
        {player.is_host && <span className="host-crown" title="Oda Kurucusu">👑</span>}
        <span className={`online-indicator ${isOnline ? 'online' : ''}`} title={isOnline ? 'Çevrim içi' : 'Bağlantı bekleniyor'} />
      </div>
      <strong className="player-display-name">
        {player.display_name}
        {isViewer && <small className="player-you-tag"> (SEN)</small>}
      </strong>
      <span className={`ready-label ${player.is_ready ? 'is-ready' : ''}`}>
        <i />{player.is_ready ? '✓ HAZIR' : 'BEKLİYOR'}
      </span>
    </div>
  )
}

function WaitingPlayers({
  players,
  onlineUsers,
  onPoke,
  emptyMessage,
}: {
  players: RoomState['players']
  onlineUsers: string[]
  onPoke: (playerId: string) => void
  emptyMessage: string
}) {
  if (!players.length) return <p className="waiting-empty">{emptyMessage}</p>

  return <div className="waiting-players" aria-label="Bekleyen oyuncular">
    {players.map((player) => {
      const isOnline = onlineUsers.includes(player.user_id)
      return <div className="waiting-player" key={player.user_id}>
        <span className="waiting-player-name">{player.display_name}</span>
        {isOnline
          ? <button type="button" className="poke-button" aria-label={`${player.display_name} oyuncusunu dürt`} onClick={() => onPoke(player.user_id)}>
            📳 Dürt
          </button>
          : <span className="waiting-player-offline">Çevrim dışı</span>}
      </div>
    })}
  </div>
}

function Scoreboard({ players, viewerId, compact = false }: { players: RoomState['players']; viewerId: string; compact?: boolean }) {
  return <div className={`score-list ${compact ? 'compact' : ''}`}>
    {[...players].sort((a, b) => b.score - a.score).map((player, index) => (
      <div className={`score-row ${player.user_id === viewerId ? 'is-you' : ''}`} key={player.user_id}>
        <span className="score-rank">{String(index + 1).padStart(2, '0')}</span>
        <span className="score-avatar" style={{ background: getPlayerCharacter(player.avatar_key).color }}>{getPlayerCharacter(player.avatar_key).emoji}</span>
        <span className="score-name">{player.display_name}{player.user_id === viewerId && <small> SENSİN</small>}</span>
        <strong className="score-value">{player.score}<small> PTS</small></strong>
      </div>
    ))}
  </div>
}

function RoundScoreboard({
  entries,
  viewerId,
  final = false,
}: {
  entries: NonNullable<RoomState['round']>['scoreboard']
  viewerId?: string
  final?: boolean
}) {
  return <ol className={`round-scoreboard ${final ? 'round-scoreboard-final' : ''}`} aria-label={final ? 'Final skor tablosu' : 'Tur skor tablosu'}>
    {entries.map((entry) => (
      <li className={`round-score-entry ${entry.user_id === viewerId ? 'is-you' : ''}`} key={entry.user_id}>
        <div className="round-score-heading">
          <span className="round-score-rank">{entry.rank}</span>
          <strong><span className="round-score-avatar" style={{ background: getPlayerCharacter(entry.avatar_key).color }}>{getPlayerCharacter(entry.avatar_key).emoji}</span>{entry.display_name}{entry.user_id === viewerId && <small> · SENSİN</small>}</strong>
          <span className="round-points">+{entry.round_points} <small>BU TUR</small></span>
          <b>{entry.total_score} <small>TOPLAM</small></b>
        </div>
        <p className={entry.answered_correctly ? 'score-correct' : 'score-incorrect'}>
          {entry.answered_correctly
            ? '✓ Gerçek cevabı buldu · +1'
            : entry.has_voted ? 'Gerçek cevabı bulamadı' : 'Cevap seçmedi'}
        </p>
        <p><strong>Zartaladığı oyuncular:</strong> {entry.fooled_players.length
          ? entry.fooled_players.map((player) => player.display_name).join(', ')
          : 'Kimse'} <span>({entry.fooled_count} başarılı Zartalama)</span></p>
        <p><strong>Kendisini Zartalayan:</strong> {entry.zartalandi_by.length
          ? entry.zartalandi_by.map((player) => player.display_name).join(', ')
          : 'Yok'}</p>
      </li>
    ))}
  </ol>
}

function RuleLine({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <div className="rule-line"><span>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div></div>
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
  if (message.toLowerCase().includes('anonymous sign-ins are disabled')) {
    return 'Supabase Anonymous Sign-Ins kapalı. Dashboard → Authentication → Sign In / Providers bölümünden etkinleştir.'
  }
  if (code === '23505' && message.includes('game_rounds_room_id_round_number_key')) {
    return 'Veritabanı güncellemesi gerekli: Supabase SQL Editor’da 202610180003_official_bluff_gameplay.sql dosyasını çalıştır.'
  }
  return message || 'Bir sorun oluştu. Bağlantını kontrol edip yeniden dene.'
}


function footerConnectionText(connection: string) {
  if (connection === 'connected') return 'GERÇEK ZAMANLI BAĞLI'
  if (connection === 'ready') return 'OYUNA HAZIR'
  if (connection === 'unconfigured') return 'SUPABASE KURULUMU GEREKLİ'
  if (connection === 'loading' || connection === 'reconnecting') return 'YENİDEN BAĞLANIYOR'
  return 'BAĞLANTI YOK'
}

export default App
