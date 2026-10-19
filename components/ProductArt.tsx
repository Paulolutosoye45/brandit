// Flat illustrations in the Brandit palette. They stand in for product photography until real Brandit jobs are photographed.
const INK = '#0B1F33', YEL = '#FFC400', WHITE = '#FFFFFF', GREY = '#7A8A9B', SOFT = '#D9DFE5';

export function ProductArt({ slug, name, className = 'h-full w-full' }: { slug: string; name?: string; className?: string }) {
  const art: Record<string, React.ReactNode> = {
    'business-cards': (
      <>
        <g transform="rotate(-9 100 90)"><rect x="40" y="48" width="124" height="76" rx="9" fill={INK} /><circle cx="68" cy="74" r="11" fill={YEL} /><rect x="58" y="102" width="60" height="5" rx="2.5" fill={WHITE} opacity=".8" /></g>
        <g transform="rotate(7 135 100)"><rect x="80" y="64" width="124" height="76" rx="9" fill={WHITE} stroke={INK} strokeWidth="2.5" /><rect x="97" y="84" width="46" height="8" rx="4" fill={INK} /><rect x="97" y="99" width="74" height="5" rx="2.5" fill={GREY} /><rect x="97" y="111" width="54" height="5" rx="2.5" fill={GREY} /><circle cx="184" cy="84" r="7" fill={YEL} /></g>
      </>
    ),
    flyers: (
      <>
        <g transform="rotate(-8 90 90)"><rect x="44" y="26" width="92" height="128" rx="6" fill={INK} /></g>
        <g transform="rotate(5 130 90)"><rect x="86" y="22" width="98" height="136" rx="6" fill={WHITE} stroke={INK} strokeWidth="2.5" /><circle cx="135" cy="62" r="20" fill={YEL} /><rect x="102" y="96" width="66" height="9" rx="4.5" fill={INK} /><rect x="102" y="112" width="66" height="5" rx="2.5" fill={GREY} /><rect x="102" y="124" width="48" height="5" rx="2.5" fill={GREY} /></g>
      </>
    ),
    posters: (
      <>
        <rect x="68" y="14" width="104" height="152" rx="4" fill={WHITE} stroke={INK} strokeWidth="2.5" />
        <rect x="76" y="22" width="88" height="88" fill={INK} />
        <circle cx="132" cy="50" r="14" fill={YEL} />
        <path d="M76 110 L106 68 L124 92 L140 76 L164 110 Z" fill="#16324F" />
        <rect x="80" y="122" width="64" height="9" rx="4.5" fill={INK} /><rect x="80" y="138" width="80" height="5" rx="2.5" fill={GREY} /><rect x="80" y="149" width="50" height="5" rx="2.5" fill={GREY} />
      </>
    ),
    'roll-up-banners': (
      <>
        <rect x="82" y="14" width="76" height="132" rx="3" fill={WHITE} stroke={INK} strokeWidth="2.5" />
        <rect x="82" y="14" width="76" height="34" fill={INK} /><circle cx="120" cy="31" r="9" fill={YEL} />
        <rect x="94" y="64" width="52" height="8" rx="4" fill={INK} /><rect x="94" y="80" width="52" height="5" rx="2.5" fill={GREY} /><rect x="94" y="92" width="38" height="5" rx="2.5" fill={GREY} />
        <rect x="94" y="112" width="52" height="22" rx="4" fill={YEL} />
        <rect x="66" y="146" width="108" height="14" rx="7" fill={INK} />
      </>
    ),
    'flex-banners': (
      <>
        <path d="M30 28 H210" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <path d="M44 28 V44 M196 28 V44" stroke={GREY} strokeWidth="2" />
        <rect x="26" y="44" width="188" height="92" rx="4" fill={INK} />
        <rect x="26" y="108" width="188" height="28" fill={YEL} />
        <rect x="46" y="62" width="104" height="13" rx="6.5" fill={WHITE} /><rect x="46" y="84" width="72" height="7" rx="3.5" fill={WHITE} opacity=".7" />
        {[[36, 54], [204, 54], [36, 126], [204, 126]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.5" fill={WHITE} stroke={INK} strokeWidth="1.5" />)}
        <rect x="46" y="116" width="60" height="9" rx="4.5" fill={INK} />
      </>
    ),
    stickers: (
      <>
        <circle cx="86" cy="94" r="52" fill={INK} /><circle cx="86" cy="94" r="38" fill="none" stroke={YEL} strokeWidth="5" /><circle cx="86" cy="94" r="12" fill={YEL} />
        <g transform="rotate(10 160 80)"><rect x="116" y="38" width="76" height="76" rx="14" fill={WHITE} stroke={INK} strokeWidth="2.5" /><path d="M192 90 Q176 94 170 114 L192 114 Z" fill={SOFT} stroke={INK} strokeWidth="2" strokeLinejoin="round" /><rect x="130" y="56" width="40" height="8" rx="4" fill={INK} /><circle cx="150" cy="86" r="9" fill={YEL} /></g>
      </>
    ),
    'tees-and-totes': (
      <>
        <path d="M82 30 L54 44 L36 78 L62 90 L68 80 L68 150 L172 150 L172 80 L178 90 L204 78 L186 44 L158 30 C152 42 138 50 120 50 C102 50 88 42 82 30 Z" fill={INK} />
        <path d="M82 30 C88 42 102 50 120 50 C138 50 152 42 158 30" fill="none" stroke="#16324F" strokeWidth="5" />
        <circle cx="120" cy="92" r="19" fill={YEL} /><circle cx="120" cy="92" r="8" fill={INK} />
        <rect x="98" y="120" width="44" height="6" rx="3" fill={WHITE} opacity=".85" />
      </>
    ),
    'id-cards': (
      <>
        <path d="M104 4 V44 M136 4 V44" stroke={INK} strokeWidth="6" />
        <rect x="108" y="38" width="24" height="14" rx="4" fill={GREY} />
        <rect x="70" y="50" width="100" height="116" rx="10" fill={WHITE} stroke={INK} strokeWidth="2.5" />
        <rect x="70" y="50" width="100" height="26" rx="10" fill={INK} /><rect x="70" y="66" width="100" height="10" fill={INK} /><circle cx="88" cy="63" r="6" fill={YEL} />
        <circle cx="120" cy="104" r="18" fill={SOFT} /><circle cx="120" cy="99" r="7" fill={GREY} /><path d="M106 118 C110 108 130 108 134 118" fill={GREY} />
        <rect x="90" y="132" width="60" height="7" rx="3.5" fill={INK} /><rect x="98" y="145" width="44" height="5" rx="2.5" fill={GREY} />
      </>
    ),
    'picture-frames': (
      <>
        <rect x="52" y="20" width="136" height="136" rx="3" fill={INK} />
        <rect x="64" y="32" width="112" height="112" fill={WHITE} />
        <rect x="74" y="42" width="92" height="92" fill="#E9EDF1" />
        <circle cx="140" cy="68" r="12" fill={YEL} />
        <path d="M74 134 L74 104 L100 78 L120 102 L134 88 L166 120 L166 134 Z" fill={INK} />
        <path d="M74 134 L74 118 L96 100 L114 120 L126 112 L166 134 Z" fill="#16324F" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 240 180" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {art[slug] ?? (
        // A product with no photo and no drawing yet: a printed sheet with the first letter of its name.
        <>
          <g transform="rotate(-6 100 90)"><rect x="52" y="30" width="108" height="130" rx="8" fill={INK} /></g>
          <g transform="rotate(4 130 90)"><rect x="78" y="24" width="108" height="130" rx="8" fill={WHITE} stroke={INK} strokeWidth="2.5" /><circle cx="132" cy="68" r="26" fill={YEL} /><text x="132" y="79" textAnchor="middle" fontSize="32" fontWeight="800" fill={INK} fontFamily="system-ui, sans-serif">{(name ?? slug).trim().charAt(0).toUpperCase() || 'B'}</text><rect x="96" y="112" width="72" height="8" rx="4" fill={INK} /><rect x="96" y="127" width="52" height="5" rx="2.5" fill={GREY} /></g>
        </>
      )}
    </svg>
  );
}
