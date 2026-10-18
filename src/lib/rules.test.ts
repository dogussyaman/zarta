import { describe, expect, it } from 'vitest'
import { ABILITIES, CATEGORIES, RULES, canStartGame, scoreAnswer } from './rules'

describe('centralized Zarta rules', () => {
  it('defines the supported categories and 2–10 player limits', () => {
    expect(CATEGORIES).toHaveLength(9)
    expect(RULES.minPlayers).toBe(2)
    expect(RULES.maxPlayers).toBe(10)
    expect(RULES.countdownSeconds).toBe(3)
  })

  it('starts only when every player is ready and at least two are present', () => {
    expect(canStartGame(1, 1)).toBe(false)
    expect(canStartGame(2, 1)).toBe(false)
    expect(canStartGame(2, 2)).toBe(true)
    expect(canStartGame(10, 10)).toBe(true)
  })

  it('keeps the round phases in the shared multiplayer order', () => {
    expect(RULES.phaseOrder).toEqual([
      'lobby',
      'countdown',
      'answering',
      'answer_reveal',
      'voting',
      'results',
      'scoreboard',
      'finished',
    ])
  })

  it('awards points for correct answers without subtracting points for incorrect ones', () => {
    expect(scoreAnswer(true, 150)).toBe(151)
    expect(scoreAnswer(false, 150)).toBe(150)
    expect(RULES.correctAnswerPoints).toBe(1)
    expect(RULES.successfulZartaPoints).toBe(2)
  })

  it('documents each ability with one starting use and its interaction', () => {
    expect(Object.keys(ABILITIES)).toEqual(['shield', 'block', 'retaliation', 'joker'])
    expect(Object.values(ABILITIES).every((ability) => ability.uses === 1 && ability.description.length > 10)).toBe(true)
  })
})
