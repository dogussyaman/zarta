export type PersonalRoundResult = {
  has_voted: boolean
  answered_correctly: boolean
  score_delta: number
  fooled_players: { user_id: string; display_name: string }[]
  zartalandi_by: { user_id: string; display_name: string }[]
}

export function derivePersonalResultFeedback(result: PersonalRoundResult) {
  return {
    showCorrectAnswer: result.answered_correctly,
    showSuccessfulBluff: result.fooled_players.length > 0,
    showZartalandi: result.zartalandi_by.length > 0,
    showNoVote: !result.has_voted,
    showMissedCorrectAnswer: result.has_voted
      && !result.answered_correctly
      && result.zartalandi_by.length === 0,
    showNoPoints: result.has_voted
      && result.score_delta === 0
      && result.zartalandi_by.length === 0,
  }
}
