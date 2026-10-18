export const PLAYER_CHARACTERS = [
  { key: 'spark', name: 'Kıvılcım', emoji: '✦', color: '#ffe27a' },
  { key: 'panda', name: 'Panda', emoji: '🐼', color: '#d9ebff' },
  { key: 'fox', name: 'Tilki', emoji: '🦊', color: '#ffb16e' },
  { key: 'frog', name: 'Kurbağa', emoji: '🐸', color: '#8cf19b' },
  { key: 'tiger', name: 'Kaplan', emoji: '🐯', color: '#ffcc69' },
  { key: 'octopus', name: 'Ahtapot', emoji: '🐙', color: '#ff8ac9' },
  { key: 'unicorn', name: 'Tekboynuz', emoji: '🦄', color: '#dbabff' },
  { key: 'penguin', name: 'Penguen', emoji: '🐧', color: '#91ddff' },
  { key: 'bear', name: 'Ayı', emoji: '🐻', color: '#e8b88c' },
  { key: 'dragon', name: 'Ejderha', emoji: '🐲', color: '#84ecc7' },
] as const

export type PlayerCharacterKey = (typeof PLAYER_CHARACTERS)[number]['key']

export function getPlayerCharacter(key: string | null | undefined) {
  return PLAYER_CHARACTERS.find((character) => character.key === key) ?? PLAYER_CHARACTERS[0]
}
