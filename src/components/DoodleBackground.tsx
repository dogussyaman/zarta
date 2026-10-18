export function DoodleBackground({
  variant,
}: {
  variant: 'lobby' | 'question' | 'zartalandin' | 'results' | 'sunburst'
}) {
  if (variant === 'zartalandin') {
    // Crimson background with floating 'Z' letters
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0" aria-hidden="true">
        <svg className="w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="z-pattern" width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
              <text x="20" y="45" fill="#ffffff" fontSize="42" fontFamily="Fredoka, Nunito, sans-serif" fontWeight="900" opacity="0.65">Z</text>
              <text x="75" y="105" fill="#ffffff" fontSize="36" fontFamily="Fredoka, Nunito, sans-serif" fontWeight="900" opacity="0.45">Z</text>
              <text x="80" y="35" fill="#ffffff" fontSize="26" fontFamily="Fredoka, Nunito, sans-serif" fontWeight="900" opacity="0.35">z</text>
              <text x="25" y="100" fill="#ffffff" fontSize="22" fontFamily="Fredoka, Nunito, sans-serif" fontWeight="900" opacity="0.3">z</text>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#z-pattern)" />
        </svg>
      </div>
    )
  }

  if (variant === 'question') {
    // Purple doodle pattern with geometric icons, hexagons, striped circles, squiggles, triangles
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0" aria-hidden="true">
        <svg className="w-full h-full opacity-15" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="geom-pattern" width="160" height="160" patternUnits="userSpaceOnUse">
              {/* Hexagon */}
              <polygon points="40,25 65,40 65,70 40,85 15,70 15,40" stroke="#ffffff" strokeWidth="4" fill="none" opacity="0.7" />
              {/* Triangle */}
              <polygon points="120,30 145,75 95,75" fill="#ffffff" opacity="0.5" />
              {/* Squiggle */}
              <path d="M100 125 Q115 110 130 125 T160 125" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.7" />
              {/* Circle with stripes */}
              <g transform="translate(30, 120)">
                <circle cx="15" cy="15" r="16" fill="#ffffff" opacity="0.4" />
                <line x1="3" y1="9" x2="27" y2="9" stroke="#581c87" strokeWidth="2.5" />
                <line x1="0" y1="15" x2="30" y2="15" stroke="#581c87" strokeWidth="2.5" />
                <line x1="3" y1="21" x2="27" y2="21" stroke="#581c87" strokeWidth="2.5" />
              </g>
              {/* Cross / Plus */}
              <path d="M85 95 L85 115 M75 105 L95 105" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
              {/* Small dot */}
              <circle cx="85" cy="40" r="5" fill="#ffffff" opacity="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#geom-pattern)" />
        </svg>
      </div>
    )
  }

  if (variant === 'sunburst') {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0" aria-hidden="true">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full animate-spin-slow opacity-25">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <g fill="#fde047">
              {Array.from({ length: 16 }).map((_, i) => (
                <polygon
                  key={i}
                  points="100,100 92,0 108,0"
                  transform={`rotate(${i * 22.5} 100 100)`}
                  opacity={i % 2 === 0 ? '0.85' : '0.4'}
                />
              ))}
            </g>
          </svg>
        </div>
      </div>
    )
  }

  // Default Lobby / Results playful soft watermarks
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0" aria-hidden="true">
      <svg className="w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
        <g fill="#ffffff" stroke="#ffffff">
          {/* Question marks */}
          <path
            d="M 280 240 Q 300 210 325 240 Q 340 260 320 280 Q 310 290 310 310"
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="310" cy="335" r="8" fill="#ffffff" stroke="none" />

          {/* Large asterisk / star */}
          <g transform="translate(60, 320)">
            <line x1="0" y1="-25" x2="0" y2="25" strokeWidth="12" strokeLinecap="round" />
            <line x1="-22" y1="-12" x2="22" y2="12" strokeWidth="12" strokeLinecap="round" />
            <line x1="-22" y1="12" x2="22" y2="-12" strokeWidth="12" strokeLinecap="round" />
          </g>

          {/* Soft squiggles */}
          <path d="M 80 440 C 90 480 60 520 85 550" strokeWidth="14" strokeLinecap="round" fill="none" />
          
          {/* Floating circles */}
          <circle cx="320" cy="380" r="22" fill="#ffffff" stroke="none" opacity="0.6" />
          <circle cx="90" cy="180" r="14" fill="#ffffff" stroke="none" opacity="0.4" />
        </g>
      </svg>
    </div>
  )
}
