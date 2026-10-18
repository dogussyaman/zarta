import type { PlayerCharacterKey } from '../lib/profile'

export function CharacterAvatar({
  avatarKey,
  className = '',
  size = 56,
}: {
  avatarKey?: PlayerCharacterKey | string | null
  className?: string
  size?: number
}) {
  const key = avatarKey || 'spark'

  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 rounded-full select-none overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      {key === 'spark' ? (
        // Curly-haired smiling boy avatar from the screenshot
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          {/* Background circle */}
          <circle cx="50" cy="50" r="50" fill="#fde68a" />
          
          {/* Curly hair back layer */}
          <path
            d="M20 52 C15 40 18 24 30 16 C38 10 50 10 60 14 C70 10 82 14 86 24 C92 34 88 50 82 56 C88 64 80 72 74 72 C70 72 68 70 65 68 C62 70 58 72 50 72 C42 72 38 70 35 68 C32 70 30 72 26 72 C20 72 12 64 18 52 Z"
            fill="#3e2723"
          />
          {/* Shoulders / Shirt */}
          <path d="M22 100 C22 84 32 78 50 78 C68 78 78 84 78 100 Z" fill="#6d28d9" />
          {/* Shirt V-neck collar */}
          <polygon points="42,78 58,78 50,88" fill="#ffedd5" />

          {/* Neck */}
          <rect x="44" y="68" width="12" height="14" fill="#fbd38d" rx="4" />

          {/* Face */}
          <ellipse cx="50" cy="50" rx="22" ry="24" fill="#fbd38d" />

          {/* Ears */}
          <circle cx="28" cy="50" r="6" fill="#fbd38d" />
          <circle cx="72" cy="50" r="6" fill="#fbd38d" />
          <circle cx="28" cy="50" r="3.5" fill="#f6ad55" />
          <circle cx="72" cy="50" r="3.5" fill="#f6ad55" />

          {/* Front Curly Hair Puffs */}
          <circle cx="28" cy="30" r="11" fill="#2d1d19" />
          <circle cx="40" cy="22" r="12" fill="#3e2723" />
          <circle cx="55" cy="20" r="13" fill="#2d1d19" />
          <circle cx="70" cy="25" r="11" fill="#3e2723" />
          <circle cx="78" cy="36" r="10" fill="#2d1d19" />
          <circle cx="22" cy="39" r="9" fill="#3e2723" />
          <circle cx="34" cy="26" r="8" fill="#4a3028" />
          <circle cx="50" cy="24" r="8" fill="#4a3028" />
          <circle cx="64" cy="27" r="8" fill="#4a3028" />

          {/* Eyebrows */}
          <path d="M36 41 Q42 38 46 42" stroke="#2d1d19" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M54 42 Q58 38 64 41" stroke="#2d1d19" strokeWidth="3" strokeLinecap="round" fill="none" />

          {/* Eyes */}
          <ellipse cx="40" cy="47" rx="3.5" ry="4" fill="#2d1d19" />
          <ellipse cx="60" cy="47" rx="3.5" ry="4" fill="#2d1d19" />
          <circle cx="41.5" cy="45.5" r="1.3" fill="#ffffff" />
          <circle cx="61.5" cy="45.5" r="1.3" fill="#ffffff" />

          {/* Nose */}
          <path d="M49 48 Q50 54 53 54" stroke="#dd6b20" strokeWidth="2.5" strokeLinecap="round" fill="none" />

          {/* Big Cheerful Smile with Teeth */}
          <path d="M37 57 Q50 72 63 57 Z" fill="#b91c1c" />
          <path d="M39 57 Q50 64 61 57 Q50 56 39 57 Z" fill="#ffffff" />
          <path d="M43 65 Q50 68 57 65 Q50 71 43 65 Z" fill="#ef4444" />

          {/* Cheek blush */}
          <ellipse cx="33" cy="54" rx="4" ry="2.5" fill="#f6ad55" opacity="0.6" />
          <ellipse cx="67" cy="54" rx="4" ry="2.5" fill="#f6ad55" opacity="0.6" />
        </svg>
      ) : key === 'panda' ? (
        // Panda eating bamboo avatar from screenshot
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          {/* Nature Background */}
          <circle cx="50" cy="50" r="50" fill="#bbf7d0" />

          {/* Panda Ears */}
          <circle cx="30" cy="26" r="14" fill="#1f2937" />
          <circle cx="70" cy="26" r="14" fill="#1f2937" />
          <circle cx="30" cy="26" r="8" fill="#374151" />
          <circle cx="70" cy="26" r="8" fill="#374151" />

          {/* Panda Head */}
          <circle cx="50" cy="54" r="32" fill="#ffffff" />

          {/* Eye Patches */}
          <ellipse cx="37" cy="50" rx="9" ry="11" fill="#1f2937" transform="rotate(-15 37 50)" />
          <ellipse cx="63" cy="50" rx="9" ry="11" fill="#1f2937" transform="rotate(15 63 50)" />

          {/* Eyes */}
          <circle cx="38" cy="49" r="3.5" fill="#ffffff" />
          <circle cx="62" cy="49" r="3.5" fill="#ffffff" />
          <circle cx="39" cy="48" r="2" fill="#111827" />
          <circle cx="61" cy="48" r="2" fill="#111827" />

          {/* Nose */}
          <path d="M46 58 Q50 55 54 58 Q50 63 46 58 Z" fill="#1f2937" />

          {/* Mouth */}
          <path d="M50 61 L50 65 Q45 68 42 66" stroke="#1f2937" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M50 65 Q55 68 58 66" stroke="#1f2937" strokeWidth="2" strokeLinecap="round" fill="none" />

          {/* Bamboo Stick in mouth/paws */}
          <path d="M15 78 L85 45" stroke="#15803d" strokeWidth="6" strokeLinecap="round" />
          <path d="M15 78 L85 45" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" />
          {/* Bamboo Joints */}
          <circle cx="40" cy="66" r="4" fill="#14532d" />
          <circle cx="60" cy="57" r="4" fill="#14532d" />
          {/* Bamboo Leaves */}
          <path d="M72 49 Q84 40 88 47 Q80 52 72 49 Z" fill="#22c55e" />
          <path d="M32 70 Q20 74 18 68 Q26 65 32 70 Z" fill="#22c55e" />

          {/* Panda Paws holding bamboo */}
          <ellipse cx="36" cy="72" rx="7" ry="8" fill="#1f2937" />
          <ellipse cx="64" cy="62" rx="7" ry="8" fill="#1f2937" />
        </svg>
      ) : key === 'fox' ? (
        // Playful Fox
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#fed7aa" />
          {/* Ears */}
          <polygon points="20,18 42,40 18,48" fill="#ea580c" />
          <polygon points="80,18 58,40 82,48" fill="#ea580c" />
          <polygon points="25,24 40,40 22,46" fill="#ffedd5" />
          <polygon points="75,24 60,40 78,46" fill="#ffedd5" />
          {/* Head */}
          <polygon points="18,46 82,46 50,86" fill="#ea580c" />
          <ellipse cx="50" cy="50" rx="32" ry="24" fill="#f97316" />
          {/* White cheeks */}
          <polygon points="24,50 50,84 34,50" fill="#ffffff" />
          <polygon points="76,50 50,84 66,50" fill="#ffffff" />
          {/* Eyes */}
          <ellipse cx="36" cy="50" rx="4" ry="5" fill="#1c1917" />
          <ellipse cx="64" cy="50" rx="4" ry="5" fill="#1c1917" />
          <circle cx="38" cy="48" r="1.5" fill="#ffffff" />
          <circle cx="66" cy="48" r="1.5" fill="#ffffff" />
          {/* Nose */}
          <circle cx="50" cy="80" r="5" fill="#1c1917" />
        </svg>
      ) : key === 'frog' ? (
        // Happy Frog
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#bbf7d0" />
          {/* Eye bumps */}
          <circle cx="32" cy="35" r="16" fill="#22c55e" />
          <circle cx="68" cy="35" r="16" fill="#22c55e" />
          {/* Eyes */}
          <circle cx="32" cy="35" r="10" fill="#ffffff" />
          <circle cx="68" cy="35" r="10" fill="#ffffff" />
          <circle cx="34" cy="35" r="6" fill="#0f172a" />
          <circle cx="66" cy="35" r="6" fill="#0f172a" />
          <circle cx="36" cy="33" r="2.5" fill="#ffffff" />
          <circle cx="68" cy="33" r="2.5" fill="#ffffff" />
          {/* Head */}
          <ellipse cx="50" cy="62" rx="36" ry="26" fill="#22c55e" />
          {/* Cheeks */}
          <circle cx="26" cy="64" r="5" fill="#f472b6" opacity="0.6" />
          <circle cx="74" cy="64" r="5" fill="#f472b6" opacity="0.6" />
          {/* Big smile */}
          <path d="M28 62 Q50 82 72 62" stroke="#14532d" strokeWidth="4" strokeLinecap="round" fill="none" />
        </svg>
      ) : key === 'tiger' ? (
        // Tiger
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#fef08a" />
          {/* Ears */}
          <circle cx="26" cy="28" r="14" fill="#f59e0b" />
          <circle cx="74" cy="28" r="14" fill="#f59e0b" />
          <circle cx="26" cy="28" r="8" fill="#fef3c7" />
          <circle cx="74" cy="28" r="8" fill="#fef3c7" />
          {/* Head */}
          <circle cx="50" cy="55" r="34" fill="#f59e0b" />
          {/* Stripes */}
          <polygon points="50,25 47,36 53,36" fill="#451a03" />
          <polygon points="40,28 41,37 45,34" fill="#451a03" />
          <polygon points="60,28 59,37 55,34" fill="#451a03" />
          <polygon points="20,52 30,50 30,54" fill="#451a03" />
          <polygon points="80,52 70,50 70,54" fill="#451a03" />
          {/* Snout */}
          <ellipse cx="50" cy="68" rx="18" ry="13" fill="#ffffff" />
          <polygon points="46,60 54,60 50,65" fill="#451a03" />
          <path d="M50 65 L50 71 Q44 74 41 71 M50 71 Q56 74 59 71" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          {/* Eyes */}
          <circle cx="36" cy="49" r="4.5" fill="#451a03" />
          <circle cx="64" cy="49" r="4.5" fill="#451a03" />
          <circle cx="38" cy="47" r="1.8" fill="#ffffff" />
          <circle cx="66" cy="47" r="1.8" fill="#ffffff" />
        </svg>
      ) : key === 'octopus' ? (
        // Cute Octopus
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#fbcfe8" />
          {/* Head */}
          <ellipse cx="50" cy="44" rx="30" ry="26" fill="#ec4899" />
          {/* Tentacles */}
          <path d="M24 64 Q22 84 30 84 Q38 84 35 68" fill="#db2777" />
          <path d="M36 68 Q36 88 44 88 Q50 88 47 68" fill="#ec4899" />
          <path d="M53 68 Q52 88 60 88 Q66 88 63 68" fill="#db2777" />
          <path d="M66 65 Q66 84 74 84 Q82 84 76 64" fill="#ec4899" />
          {/* Eyes */}
          <circle cx="38" cy="46" r="6" fill="#ffffff" />
          <circle cx="62" cy="46" r="6" fill="#ffffff" />
          <circle cx="40" cy="46" r="3.5" fill="#1e1b4b" />
          <circle cx="64" cy="46" r="3.5" fill="#1e1b4b" />
          <circle cx="41.5" cy="44.5" r="1.5" fill="#ffffff" />
          <circle cx="65.5" cy="44.5" r="1.5" fill="#ffffff" />
          {/* Cute mouth */}
          <ellipse cx="50" cy="57" rx="3.5" ry="5" fill="#be185d" />
        </svg>
      ) : key === 'unicorn' ? (
        // Magical Unicorn
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#f3e8ff" />
          {/* Horn */}
          <polygon points="50,10 44,38 56,38" fill="#fbbf24" />
          <path d="M46 22 L54 26 M45 30 L55 34" stroke="#d97706" strokeWidth="2" />
          {/* Ears */}
          <polygon points="28,26 42,44 26,48" fill="#e9d5ff" />
          <polygon points="72,26 58,44 74,48" fill="#e9d5ff" />
          {/* Mane */}
          <path d="M40 32 C30 36 28 50 34 60 C32 68 38 78 44 82" stroke="#f472b6" strokeWidth="7" strokeLinecap="round" fill="none" />
          {/* Head */}
          <ellipse cx="56" cy="58" rx="26" ry="24" fill="#ffffff" />
          {/* Eyes */}
          <path d="M52 56 Q58 50 64 56" stroke="#581c87" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M56 52 L54 49 M60 51 L60 48 M64 52 L66 49" stroke="#581c87" strokeWidth="2" strokeLinecap="round" />
          {/* Blush */}
          <circle cx="66" cy="64" r="5" fill="#f472b6" opacity="0.6" />
        </svg>
      ) : key === 'penguin' ? (
        // Cool Penguin
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#bae6fd" />
          {/* Body */}
          <ellipse cx="50" cy="56" rx="30" ry="34" fill="#0f172a" />
          {/* White Belly */}
          <ellipse cx="50" cy="62" rx="20" ry="26" fill="#ffffff" />
          {/* Cheeks */}
          <circle cx="32" cy="56" r="4" fill="#fda4af" opacity="0.6" />
          <circle cx="68" cy="56" r="4" fill="#fda4af" opacity="0.6" />
          {/* Eyes */}
          <circle cx="40" cy="46" r="4" fill="#ffffff" />
          <circle cx="60" cy="46" r="4" fill="#ffffff" />
          <circle cx="41" cy="46" r="2.5" fill="#0f172a" />
          <circle cx="59" cy="46" r="2.5" fill="#0f172a" />
          {/* Beak */}
          <polygon points="44,52 56,52 50,62" fill="#f59e0b" />
        </svg>
      ) : key === 'bear' ? (
        // Friendly Bear
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#fed7aa" />
          {/* Ears */}
          <circle cx="26" cy="28" r="14" fill="#854d0e" />
          <circle cx="74" cy="28" r="14" fill="#854d0e" />
          <circle cx="26" cy="28" r="7" fill="#fde68a" />
          <circle cx="74" cy="28" r="7" fill="#fde68a" />
          {/* Head */}
          <circle cx="50" cy="56" r="34" fill="#854d0e" />
          {/* Snout */}
          <ellipse cx="50" cy="66" rx="18" ry="14" fill="#fef3c7" />
          <ellipse cx="50" cy="62" rx="6" ry="4.5" fill="#451a03" />
          <path d="M50 66 L50 72 Q45 75 42 72 M50 72 Q55 75 58 72" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          {/* Eyes */}
          <circle cx="37" cy="48" r="3.5" fill="#451a03" />
          <circle cx="63" cy="48" r="3.5" fill="#451a03" />
          <circle cx="38" cy="47" r="1.2" fill="#ffffff" />
          <circle cx="64" cy="47" r="1.2" fill="#ffffff" />
        </svg>
      ) : (
        // Dragon
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#a7f3d0" />
          {/* Horns */}
          <polygon points="30,16 42,36 24,38" fill="#eab308" />
          <polygon points="70,16 58,36 76,38" fill="#eab308" />
          {/* Head */}
          <ellipse cx="50" cy="56" rx="30" ry="28" fill="#059669" />
          {/* Cheeks */}
          <ellipse cx="50" cy="66" rx="18" ry="12" fill="#34d399" />
          {/* Nostrils */}
          <circle cx="46" cy="63" r="2.5" fill="#065f46" />
          <circle cx="54" cy="63" r="2.5" fill="#065f46" />
          {/* Eyes */}
          <ellipse cx="36" cy="48" rx="6" ry="7" fill="#fef08a" />
          <ellipse cx="64" cy="48" rx="6" ry="7" fill="#fef08a" />
          <ellipse cx="37" cy="48" rx="2.5" ry="5" fill="#065f46" />
          <ellipse cx="63" cy="48" rx="2.5" ry="5" fill="#065f46" />
        </svg>
      )}
    </div>
  )
}
