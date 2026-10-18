import { describe, expect, it } from 'vitest'
import { derivePersonalResultFeedback } from './round-results'
import type { PersonalRoundResult } from './round-results'

const player = (display_name: string) => ({ user_id: display_name, display_name })
const result = (overrides: Partial<PersonalRoundResult>): PersonalRoundResult => ({
  has_voted: true,
  answered_correctly: false,
  score_delta: 0,
  fooled_players: [],
  zartalandi_by: [],
  ...overrides,
})

describe('private round result feedback', () => {
  it('shows correct answer and successful bluff independently', () => {
    expect(derivePersonalResultFeedback(result({
      answered_correctly: true,
      score_delta: 3,
      fooled_players: [player('Ada')],
    }))).toEqual({
      showCorrectAnswer: true,
      showSuccessfulBluff: true,
      showZartalandi: false,
      showNoVote: false,
      showMissedCorrectAnswer: false,
      showNoPoints: false,
    })
  })

  it('shows who fooled the player without a redundant wrong-answer message', () => {
    expect(derivePersonalResultFeedback(result({
      score_delta: 0,
      zartalandi_by: [player('Deniz')],
    }))).toMatchObject({
      showZartalandi: true,
      showMissedCorrectAnswer: false,
      showNoPoints: false,
    })
  })

  it('shows a missed correct answer alongside a successful bluff', () => {
    expect(derivePersonalResultFeedback(result({
      score_delta: 2,
      fooled_players: [player('Ada')],
    }))).toMatchObject({
      showSuccessfulBluff: true,
      showMissedCorrectAnswer: true,
      showNoPoints: false,
    })
  })
})
