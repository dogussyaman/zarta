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

const CATEGORY_ART_IDS = ['culture', 'animals', 'fashion', 'film', 'music', 'science', 'history', 'sports', 'food'] as const

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
        <a className="brand" href="#" onClick={goHome} aria-label="Zarta ana sayfa">
          <span className="brand-mark">Z</span>
          <span>ZARTA<span className="brand-online">ONLINE</span></span>
        </a>
        <div className="topbar-right">
          <button
            className="profile-trigger"
            aria-label={`Profili düzenle: ${name || 'oyuncu'}`}
            onClick={openProfile}
          >
            <PlayerAvatar avatarKey={avatarKey} />
            <span>PROFİL</span>
          </button>
          <div className={`connection-chip ${connection}`}>
            <span className="connection-dot" />
            {connectionText(connection)}
          </div>
          <button className="icon-button" aria-label="Oyun kurallarını aç" onClick={() => setShowSettings(true)}>☼</button>
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
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-spark">✦</span> ARKADAŞLARINLA, HER YERDEN</div>
            <h1>Biraz bilgi.<br /><span>Bolca zarta.</span></h1>
            <p className="hero-description">Doğru cevabı bul, inandırıcı blöfünü yaz, arkadaşlarını yakala. Oyun başlasın.</p>
            <div className="hero-proof">
              <div className="proof-icon" aria-hidden="true">✦</div>
              <span><strong>2–10 oyuncu</strong><br />aynı odada, her cihazda</span>
              <span className="proof-divider" />
              <span className="proof-latency"><i /> Gerçek zamanlı</span>
            </div>
            <div className="hero-decor" aria-hidden="true">
              <span className="orbit orbit-one" />
              <span className="orbit orbit-two" />
              <span className="float-token token-star">✦</span>
              <span className="float-token token-bolt">ϟ</span>
              <span className="float-token token-z">Z</span>
              <span className="orbit-core">Z!</span>
            </div>
          </div>

          <section className="entry-card">
            <div className="card-heading">
              <div>
                <span className="section-kicker">KATIL VE KARIŞTIR</span>
                <h2>4 adımda Zarta</h2>
              </div>
              <span className="live-badge"><i /> ÇEVRİM İÇİ OYUN</span>
            </div>
            <ol className="quick-steps" aria-label="Oyun nasıl oynanır">
              {['Odaya katıl', 'Soruyu oku', 'Blöfünü yaz', 'Gerçeği seç'].map((step, index) => (
                <li key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>
              ))}
            </ol>
            <label className="field-label" htmlFor="player-name">Oyuncu adın</label>
            <input id="player-name" className="text-input" maxLength={24} minLength={2} placeholder="Sana nasıl seslenelim?" value={name} onChange={(event) => setName(event.target.value)} />
            {!isSupabaseConfigured && <p className="setup-notice">Önce Supabase bağlantısı kurulmalı. `.env.example` dosyasını `.env` olarak kopyalayıp proje anahtarlarını gir.</p>}
            <form onSubmit={handleJoin} className="join-form">
              <label className="field-label" htmlFor="room-code">Oda kodun var mı?</label>
              <div className="join-row">
                <input id="room-code" className="text-input code-input" maxLength={6} placeholder="ÖRN. Z4RTA2" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} aria-label="Oda kodu" />
                <button className="button button-secondary join-button" disabled={!isSupabaseConfigured || busy} type="submit">Katıl <span>↗</span></button>
              </div>
            </form>
            <div className="or-divider"><span /> ya da yeni bir masa aç <span /></div>
            <button className="button button-primary create-button" disabled={!isSupabaseConfigured || busy} onClick={() => setShowSettings(true)}>
              <span className="button-plus">＋</span> Oda oluştur <span className="button-arrow">→</span>
            </button>
            <div className="card-foot"><span>◈ Ücretsiz</span><span>✦ Hesap açmak yok</span><span>⌁ Mobil uyumlu</span></div>
          </section>
          <div className="home-bottom"><span>ARKADAŞLARLA DAHA GÜZEL OYNANIR</span><span className="bottom-note">En iyi yanlış cevap, hiç verilmemiş olandır.</span></div>
        </section>
      ) : (
        <section className="game-layout">
          <div className="game-topline">
            <div>
              <button className="back-link" onClick={handleLeave}>← Ana sayfa</button>
              <div className="room-code-line">ODA KODU <button className="room-code" onClick={() => void copyRoomCode()}>{room.room.code} <span>▣</span></button></div>
            </div>
            <div className="round-counter">
              <span className="section-kicker">{room.room.status === 'lobby' ? 'OYUN LOBİSİ' : 'OYUN DEVAM EDİYOR'}</span>
              {room.room.current_round > 0 && <strong>Tur {room.room.current_round}<span> / {room.room.total_rounds}</span></strong>}
            </div>
          </div>

          {room.room.status === 'lobby' ? (
            <div className="lobby-grid">
              <section className="game-panel lobby-panel">
                <div className="panel-title-row">
                  <div><span className="section-kicker">MASA HAZIR</span><h2>Oyuncular</h2></div>
                  <span className="player-count">{room.players.length}<span> / 10</span></span>
                </div>
                <div className="player-grid">
                  {room.players.map((player) => <PlayerTile key={player.user_id} player={player} isOnline={onlineUsers.includes(player.user_id)} />)}
                  {room.players.length < 10 && <div className="invite-tile"><span>＋</span><strong>Arkadaşlarını çağır</strong><small>Kodu gönder: {room.room.code}</small></div>}
                </div>
                <div className="lobby-status"><span className="status-pulse" /> {readyCount} / {room.players.length} oyuncu hazır</div>
                <div className="lobby-actions">
                  {isHost ? (
                    <button className="button button-primary start-button" disabled={busy || room.players.length < 2 || readyCount !== room.players.length} onClick={() => void withBusy(startGame)}>
                      Oyunu başlat <span>→</span>
                    </button>
                  ) : (
                    <button className={`button ${room.players.find((player) => player.user_id === room.viewer_id)?.is_ready ? 'button-secondary' : 'button-primary'} start-button`} disabled={busy} onClick={() => void withBusy(() => setReady(!room.players.find((player) => player.user_id === room.viewer_id)?.is_ready))}>
                      {room.players.find((player) => player.user_id === room.viewer_id)?.is_ready ? 'Hazırım ✓' : 'Hazır ol'} <span>→</span>
                    </button>
                  )}
                  <button className="button-link" onClick={() => setShowSettings(true)}>Oyun ayarları <span>↗</span></button>
                </div>
              </section>
              <aside className="game-panel side-panel">
                <span className="section-kicker">BU OYUNDA</span>
                <h3>Kurallar belli.<br />Dostluklar şüpheli.</h3>
                <RuleLine icon="◉" title={`${room.room.total_rounds} tur`} detail={`${room.room.question_seconds} saniyede cevabını ver`} />
                <RuleLine icon="✦" title="Doğru cevabı bul +1" detail="Gerçek cevabı seç" />
                <RuleLine icon="↗" title="Blöfün tutarsa +2" detail="Her kandırdığın oyuncu için" />
                <div className="category-mini"><span className="section-kicker">KATEGORİLER</span><div>{room.room.categories.map((category) => <span className="category-chip" key={category}>{category}</span>)}</div></div>
              </aside>
            </div>
          ) : room.room.status === 'countdown' ? (
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
            <div className="play-grid play-grid-single">
              <section className="game-panel question-panel">
                {room.round?.phase === 'answering' ? (
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
                      <strong>
                        {room.round.personal_result.answered_correctly
                          ? 'Doğru cevabı buldun!'
                          : room.round.personal_result.zartalandi_by.length > 0
                            ? 'Zartalandın!'
                            : room.round.personal_result.fooled_players.length > 0
                              ? 'Blöfün tuttu!'
                              : room.round.personal_result.has_voted
                                ? 'Tur tamamlandı'
                                : 'Bu tur oy kullanmadın'}
                      </strong>
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
                  {CATEGORIES.map((item, index) => (
                    <label
                      className={`category-choice category-card category-card-${index + 1}${category === item ? ' active' : ''}`}
                      key={item}
                    >
                      <input
                        className="category-radio"
                        type="radio"
                        name="room-category"
                        value={item}
                        checked={category === item}
                        onChange={() => setCategory(item)}
                      />
                      <svg className="category-art" aria-hidden="true" viewBox="0 0 360 140" preserveAspectRatio="xMidYMid slice">
                        <use href={`/category-art.svg#${CATEGORY_ART_IDS[index]}`} />
                      </svg>
                      <span className="category-name">{item}</span>
                      <span className="category-selected" aria-hidden="true">✓</span>
                    </label>
                  ))}
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

function PlayerTile({ player, isOnline }: { player: RoomState['players'][number]; isOnline: boolean }) {
  return <div className="player-tile">
    <div className="player-avatar-wrap">
      <PlayerAvatar avatarKey={player.avatar_key} />
      {player.is_host && <span className="host-crown">♛</span>}
      <span className={`online-indicator ${isOnline ? 'online' : ''}`} title={isOnline ? 'Çevrim içi' : 'Bağlantı bekleniyor'} />
    </div>
    <strong>{player.display_name}</strong>
    <span className={`ready-label ${player.is_ready ? 'is-ready' : ''}`}><i />{player.is_ready ? 'HAZIR' : 'BEKLİYOR'}</span>
  </div>
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

function connectionText(connection: string) {
  switch (connection) {
    case 'connected': return 'BAĞLANTI AKTİF'
    case 'ready': return 'OYUNA HAZIR'
    case 'loading': return 'BAĞLANIYOR'
    case 'reconnecting': return 'YENİDEN BAĞLANIYOR'
    case 'unconfigured': return 'KURULUM GEREKLİ'
    default: return 'BAĞLANTI YOK'
  }
}

function footerConnectionText(connection: string) {
  if (connection === 'connected') return 'GERÇEK ZAMANLI BAĞLI'
  if (connection === 'ready') return 'OYUNA HAZIR'
  if (connection === 'unconfigured') return 'SUPABASE KURULUMU GEREKLİ'
  if (connection === 'loading' || connection === 'reconnecting') return 'YENİDEN BAĞLANIYOR'
  return 'BAĞLANTI YOK'
}

export default App
