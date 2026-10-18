export const CATEGORIES = [
  'Genel kültür',
  'Hayvanlar âlemi',
  'Moda ve stil',
  'Film ve dizi',
  'Müzik',
  'Bilim ve teknoloji',
  'Tarih ve coğrafya',
  'Spor',
  'Yemek ve lezzet',
] as const

export type Category = (typeof CATEGORIES)[number]
export type AbilityKey = 'shield' | 'block' | 'retaliation' | 'joker'

export const ABILITIES: Record<AbilityKey, { name: string; description: string; uses: number; icon: string }> = {
  shield: { name: 'Kalkan', description: 'Aktif turda sana gelen bir Zartanın puan cezasını engeller.', uses: 1, icon: '◈' },
  block: { name: 'Blok', description: 'Aktif turda sana yöneltilen Zartayı iptal eder.', uses: 1, icon: '▣' },
  retaliation: { name: 'Misilleme', description: 'Sana saldıran oyuncuya aynı puan cezasını geri yansıtır.', uses: 1, icon: '↗' },
  joker: { name: 'Joker', description: 'Cevabını süre dolmadan bir kez değiştirebilirsin.', uses: 1, icon: '✦' },
}

export const RULES = {
  minPlayers: 2,
  maxPlayers: 10,
  defaultRounds: 5,
  defaultQuestionSeconds: 20,
  countdownSeconds: 3,
  correctAnswerPoints: 1,
  incorrectAnswerPoints: 0,
  successfulZartaPoints: 2,
  phaseOrder: ['lobby', 'countdown', 'answering', 'answer_reveal', 'voting', 'results', 'scoreboard', 'finished'] as const,
}

export function scoreAnswer(correct: boolean, currentScore: number): number {
  return currentScore + (correct ? RULES.correctAnswerPoints : RULES.incorrectAnswerPoints)
}

export function canStartGame(playerCount: number, readyCount: number): boolean {
  return playerCount >= RULES.minPlayers && readyCount === playerCount
}
