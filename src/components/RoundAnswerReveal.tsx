import type { RevealedAnswer } from '../lib/game'
import { getPlayerCharacter } from '../lib/profile'

function RevealAvatar({ avatarKey, label }: { avatarKey: RevealedAnswer['avatar_key']; label: string }) {
  const character = getPlayerCharacter(avatarKey ?? 'spark')
  return <span className="revealed-avatar" role="img" aria-label={label} style={{ background: character.color }}>
    {character.emoji}
  </span>
}

export function RoundAnswerReveal({ answers, roundNumber }: { answers: RevealedAnswer[]; roundNumber: number }) {
  const bluffs = answers
    .filter((answer) => !answer.is_correct)
    .sort((a, b) => b.fooled_count - a.fooled_count || a.display_name.localeCompare(b.display_name, 'tr'))
  const featuredBluff = bluffs[0]?.fooled_count ? bluffs[0] : null
  const sortedAnswers = [...bluffs, ...answers.filter((answer) => answer.is_correct)]

  return (
    <section className="round-answer-reveal" aria-label={`Tur ${roundNumber} cevap sonuçları`}>
      <div className="round-reveal-title">
        <span className="round-reveal-crown" aria-hidden="true">♛</span>
        <span className="section-kicker">TUR {roundNumber} · CEVAPLAR</span>
        <h2>{featuredBluff ? 'EN ZARTALAYAN!' : 'CEVAPLAR AÇILDI'}</h2>
        {featuredBluff && (
          <div className="round-reveal-winner">
            <RevealAvatar avatarKey={featuredBluff.avatar_key} label={featuredBluff.display_name} />
            <strong>{featuredBluff.display_name}</strong>
            <span>+{featuredBluff.fooled_count * 2} puan</span>
          </div>
        )}
      </div>
      <div className="revealed-answer-list">
        {sortedAnswers.map((answer) => (
          <article
            className={`revealed-answer-card ${answer.is_correct ? 'revealed-answer-correct' : ''} ${answer === featuredBluff ? 'revealed-answer-featured' : ''}`}
            key={answer.is_correct ? 'correct-answer' : answer.player_id}
          >
            <div className="revealed-answer-main">
              {answer.is_correct
                ? <span className="revealed-answer-check" aria-label="Doğru cevap">✓</span>
                : <RevealAvatar avatarKey={answer.avatar_key} label={answer.display_name} />}
              <div className="revealed-answer-copy">
                <span>{answer.is_correct ? 'GERÇEK CEVAP' : answer.display_name}</span>
                <strong>{answer.answer_text}</strong>
              </div>
              {answer.fooled_count > 0 && !answer.is_correct && (
                <b className="revealed-answer-points">+{answer.fooled_count * 2}</b>
              )}
            </div>
            <div className="revealed-answer-voters">
              {answer.fooled_players.length > 0 ? (
                <>
                  <div className="revealed-voter-avatars" aria-label="Bu cevaba kanan oyuncular">
                    {answer.fooled_players.map((player) => {
                      const character = getPlayerCharacter(player.avatar_key)
                      return <span key={player.user_id} title={player.display_name} style={{ background: character.color }}>{character.emoji}</span>
                    })}
                  </div>
                  <small>{answer.fooled_count} kişi bu cevaba kandı</small>
                </>
              ) : (
                <small>{answer.is_correct ? 'Doğru cevabı seçen yok' : 'Kimse bu blöfe kanmadı'}</small>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
