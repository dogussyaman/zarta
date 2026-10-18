import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RoundAnswerReveal } from './RoundAnswerReveal'
import type { RevealedAnswer } from '../lib/game'

afterEach(cleanup)

const answers: RevealedAnswer[] = [
  {
    player_id: 'ada',
    display_name: 'Ada',
    avatar_key: 'panda',
    answer_text: 'Kanada',
    is_correct: false,
    fooled_count: 2,
    fooled_players: [
      { user_id: 'deniz', display_name: 'Deniz', avatar_key: 'fox' },
      { user_id: 'mert', display_name: 'Mert', avatar_key: 'dragon' },
    ],
  },
  {
    player_id: null,
    display_name: 'Gerçek cevap',
    avatar_key: null,
    answer_text: 'Avustralya',
    is_correct: true,
    fooled_count: 1,
    fooled_players: [{ user_id: 'selin', display_name: 'Selin', avatar_key: 'frog' }],
  },
]

describe('round answer reveal', () => {
  it('highlights the most successful bluff and reveals the real answer', () => {
    render(<RoundAnswerReveal answers={answers} roundNumber={2} />)

    expect(screen.getByRole('heading', { name: 'EN ZARTALAYAN!' })).toBeInTheDocument()
    expect(screen.getAllByText('Ada')).toHaveLength(2)
    expect(screen.getByText('Kanada')).toBeInTheDocument()
    expect(screen.getByText('Avustralya')).toBeInTheDocument()
    expect(screen.getByText('GERÇEK CEVAP')).toBeInTheDocument()
    expect(screen.getByText('2 kişi bu cevaba kandı')).toBeInTheDocument()
  })

  it('shows a generic reveal banner when nobody fell for a bluff', () => {
    const noSuccessfulBluff = answers.map((answer) => ({ ...answer, fooled_count: 0, fooled_players: [] }))
    render(<RoundAnswerReveal answers={noSuccessfulBluff} roundNumber={1} />)

    const results = screen.getByRole('region', { name: 'Tur 1 cevap sonuçları' })
    expect(within(results).getByRole('heading', { name: 'CEVAPLAR AÇILDI' })).toBeInTheDocument()
    expect(within(results).queryByText('Ada', { selector: 'strong' })).not.toBeInTheDocument()
  })
})
