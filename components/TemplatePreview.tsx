import { PALETTES, type Look } from '@/lib/templateCore';

type TProps = { x: number; y: number; size: number; children: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; fill: string; maxW?: number; display?: boolean; italic?: boolean; opacity?: number; spacing?: number };

/** One line of text in the preview. A line that would run off the page is squeezed to fit instead of being cut. */
function T({ x, y, size, children, anchor = 'middle', weight = 600, fill, maxW = 240, display = false, italic = false, opacity = 1, spacing = 0 }: TProps) {
  const text = String(children ?? '');
  const est = text.length * size * 0.56;
  return (
    <text x={x} y={y} fontSize={size} textAnchor={anchor} fontWeight={weight} fill={fill} opacity={opacity} fontStyle={italic ? 'italic' : 'normal'} letterSpacing={spacing || undefined}
      className={display ? 'font-display' : undefined} textLength={est > maxW ? maxW : undefined} lengthAdjust={est > maxW ? 'spacingAndGlyphs' : undefined}>
      {text}
    </text>
  );
}

/**
 * A drawn stand-in for the finished piece, made from the template's palette, layout and sample words.
 * It shows the style, not the final design: a designer makes the real one from the customer's details.
 */
export function TemplatePreview({ look, title, className = '' }: { look: Look; title: string; className?: string }) {
  const p = PALETTES[look.palette] ?? PALETTES.ink;
  const L = look.lines;
  const line = (i: number) => L[i] ?? '';
  const landscape = look.layout === 'banner';
  const W = landscape ? 400 : 300;
  const H = landscape ? 200 : 400;
  const ink = p.fg;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sample style for ${title}`} className={`block h-full w-full ${className}`} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill={look.layout === 'shirt' ? p.soft : p.bg} />

      {look.layout === 'invite' && (
        <>
          <rect x="16" y="16" width="268" height="368" fill="none" stroke={p.accent} strokeWidth="2" />
          <rect x="24" y="24" width="252" height="352" fill="none" stroke={p.accent} strokeWidth="0.8" opacity="0.7" />
          <T x={150} y={92} size={13} fill={ink} italic weight={500} opacity={0.85} maxW={220}>{line(0)}</T>
          <path d="M120 118 h60 M150 108 l8 10 -8 10 -8 -10 z" stroke={p.accent} fill="none" strokeWidth="1.6" />
          <T x={150} y={182} size={36} fill={p.accent} display weight={800} maxW={230}>{line(1)}</T>
          <T x={150} y={220} size={13} fill={ink} italic weight={500} opacity={0.85} maxW={220}>{line(2)}</T>
          <T x={150} y={280} size={17} fill={ink} weight={700} maxW={220}>{line(3)}</T>
          <T x={150} y={338} size={12} fill={ink} weight={600} opacity={0.85} maxW={220}>{line(4)}</T>
        </>
      )}

      {look.layout === 'programme' && (
        <>
          <rect width="300" height="122" fill={p.soft} />
          <path d="M126 22 h48 M150 10 v24" stroke={p.accent} strokeWidth="3" strokeLinecap="round" />
          <T x={150} y={78} size={25} fill={ink} display weight={800} maxW={250}>{line(0)}</T>
          <T x={150} y={104} size={13} fill={p.accent} weight={700} maxW={240}>{line(1)}</T>
          {L.slice(2, 8).map((t, k) => (
            <g key={k}>
              <circle cx="46" cy={166 + k * 36} r="3.5" fill={p.accent} />
              <T x={62} y={171 + k * 36} size={14} anchor="start" fill={ink} weight={600} maxW={190}>{t}</T>
              <path d={`M42 ${184 + k * 36} h216`} stroke={ink} strokeWidth="0.6" opacity="0.2" />
            </g>
          ))}
        </>
      )}

      {look.layout === 'flyer' && (
        <>
          <rect x="0" y="0" width="300" height="14" fill={p.accent} />
          <T x={150} y={150} size={46} fill={p.accent} display weight={800} maxW={250}>{line(0)}</T>
          <rect x="110" y="172" width="80" height="5" fill={ink} opacity="0.9" />
          <T x={150} y={216} size={19} fill={ink} weight={600} maxW={240}>{line(1)}</T>
          <T x={150} y={262} size={15} fill={ink} weight={500} opacity={0.9} maxW={240}>{line(2)}</T>
          <rect x="40" y="324" width="220" height="44" rx="6" fill={p.accent} />
          <T x={150} y={352} size={17} fill={p.bg} weight={800} maxW={200}>{line(3)}</T>
        </>
      )}

      {look.layout === 'menu' && (
        <>
          <rect x="14" y="14" width="272" height="372" fill="none" stroke={p.accent} strokeWidth="1.5" />
          <T x={150} y={72} size={30} fill={p.accent} display weight={800} maxW={230}>{line(0)}</T>
          <path d="M70 90 h160" stroke={p.accent} strokeWidth="1.5" />
          {L.slice(1, 8).map((t, k) => {
            const m = t.match(/^(.*?)\s+([\d,.]+)$/);
            const name = m ? m[1] : t;
            const price = m ? m[2] : '';
            const y = 134 + k * 40;
            return (
              <g key={k}>
                <T x={40} y={y} size={15} anchor="start" fill={ink} weight={600} maxW={150}>{name}</T>
                {price && <path d={`M${40 + Math.min(150, name.length * 8.6)} ${y - 3} H${230}`} stroke={ink} strokeWidth="0.8" strokeDasharray="1 4" opacity="0.5" />}
                {price && <T x={262} y={y} size={15} anchor="end" fill={p.accent} weight={800} maxW={50}>{price}</T>}
              </g>
            );
          })}
        </>
      )}

      {look.layout === 'banner' && (
        <>
          {[[10, 10], [390, 10], [10, 190], [390, 190]].map(([cx, cy], k) => <circle key={k} cx={cx} cy={cy} r="4" fill="none" stroke={ink} strokeWidth="1.5" opacity="0.6" />)}
          <rect x="0" y="0" width="400" height="10" fill={p.accent} />
          <rect x="0" y="190" width="400" height="10" fill={p.accent} />
          <T x={200} y={90} size={40} fill={p.accent} display weight={800} maxW={350}>{line(0)}</T>
          <T x={200} y={124} size={17} fill={ink} weight={600} maxW={340}>{line(1)}</T>
          <T x={200} y={148} size={12} fill={ink} weight={500} opacity={0.85} maxW={340}>{line(2)}</T>
          <T x={200} y={176} size={14} fill={ink} weight={800} maxW={300}>{line(3)}</T>
        </>
      )}

      {look.layout === 'poster' && (
        <>
          <circle cx="260" cy="60" r="110" fill={p.soft} />
          <circle cx="40" cy="380" r="90" fill={p.soft} opacity="0.7" />
          <T x={150} y={150} size={44} fill={ink} display weight={800} maxW={250}>{line(0)}</T>
          <T x={150} y={208} size={32} fill={p.accent} display weight={800} maxW={250}>{line(1)}</T>
          <rect x="120" y="232" width="60" height="4" fill={p.accent} />
          <T x={150} y={310} size={17} fill={ink} weight={700} maxW={240}>{line(2)}</T>
          <T x={150} y={340} size={14} fill={ink} weight={500} opacity={0.9} maxW={240}>{line(3)}</T>
        </>
      )}

      {look.layout === 'shirt' && (
        <>
          <path d="M108 40 L58 62 L18 112 L54 138 L80 116 L80 362 L220 362 L220 116 L246 138 L282 112 L242 62 L192 40 Q150 78 108 40 Z" fill={p.bg} stroke={p.accent === '#FFC400' && p.bg === '#FFFFFF' ? '#0B1F33' : p.accent} strokeWidth="3" strokeLinejoin="round" />
          <T x={150} y={160} size={30} fill={ink} display weight={800} maxW={110}>{line(0)}</T>
          <T x={150} y={198} size={22} fill={p.bg === '#FFFFFF' ? '#0B1F33' : p.accent} display weight={800} maxW={110}>{line(1)}</T>
          <T x={150} y={226} size={11} fill={ink} weight={700} opacity={0.85} spacing={1.4} maxW={110}>{line(2)}</T>
          <T x={150} y={246} size={12} fill={ink} weight={700} opacity={0.85} maxW={110}>{line(3)}</T>
        </>
      )}
    </svg>
  );
}
