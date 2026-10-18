import { describe, expect, it } from 'vitest'
import { isStateAtLeastAsNew } from './game'
import type { Round } from './game'

function marker(roundNumber: number, phase: Round['phase'] | 'lobby' | 'countdown', roomId = 'room') {
  return {
    room: { id: roomId, status: phase, current_round: roundNumber },
    round: phase === 'lobby' || phase === 'countdown' ? null : { round_number: roundNumber, phase },
  }
}

describe('room state ordering', () => {
  it('ignores delayed snapshots from an earlier phase or round', () => {
    expect(isStateAtLeastAsNew(marker(2, 'scoreboard'), marker(2, 'results'))).toBe(false)
    expect(isStateAtLeastAsNew(marker(3, 'answering'), marker(2, 'completed'))).toBe(false)
  })

  it('accepts phase advancement and the next round', () => {
    expect(isStateAtLeastAsNew(marker(1, 'results'), marker(1, 'scoreboard'))).toBe(true)
    expect(isStateAtLeastAsNew(marker(1, 'scoreboard'), marker(2, 'answering'))).toBe(true)
  })

  it('does not let an old countdown snapshot replace the first round', () => {
    expect(isStateAtLeastAsNew(marker(0, 'answering'), marker(0, 'countdown'))).toBe(false)
    expect(isStateAtLeastAsNew(marker(0, 'countdown'), marker(1, 'answering'))).toBe(true)
  })

  it('keeps a final game state ahead of a delayed scoreboard snapshot', () => {
    const finished = {
      room: { id: 'room', status: 'finished', current_round: 3 },
      round: { round_number: 3, phase: 'completed' as const },
    }
    expect(isStateAtLeastAsNew(finished, marker(3, 'scoreboard'))).toBe(false)
  })

  it('accepts a new room snapshot', () => {
    expect(isStateAtLeastAsNew(marker(3, 'scoreboard'), marker(1, 'lobby', 'new-room'))).toBe(true)
  })
})
