/** A banner drawn to scale next to a person 5.6 ft tall, so "10 x 5 ft" means something before you pay. */
export function ScaleViz({ w, h }: { w: number; h: number }) {
  const W = Number.isFinite(w) && w > 0 ? Math.min(w, 60) : 5;
  const H = Number.isFinite(h) && h > 0 ? Math.min(h, 40) : 3;
  const person = 5.6;
  const s = Math.min(230 / W, 118 / Math.max(H, person));
  const floor = 150, left = 30;
  const bw = W * s, bh = H * s;
  const px = left + bw + 26;
  const ph = person * s;
  return (
    <figure className="grid gap-2">
      <svg viewBox="0 0 340 180" className="w-full rounded-md2 bg-paper2" role="img" aria-label={`A ${W} by ${H} foot banner beside a person 5.6 feet tall`}>
        <line x1="8" x2="332" y1={floor} y2={floor} stroke="#7A8A9B" strokeWidth="1.5" />
        <rect x={left} y={floor - bh} width={bw} height={bh} rx="2" fill="#0B1F33" />
        <rect x={left} y={floor - Math.min(bh * 0.28, 22)} width={bw} height={Math.min(bh * 0.28, 22)} fill="#FFC400" />
        <text x={left + bw / 2} y={floor - bh - 7} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0B1F33">{W} ft</text>
        <text x={left - 7} y={floor - bh / 2 + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="#0B1F33">{H} ft</text>
        {px + 22 < 336 && (
          <g fill="#7A8A9B">
            <circle cx={px + 9} cy={floor - ph + 7} r={Math.max(5, ph * 0.075)} />
            <rect x={px} y={floor - ph + 7 + Math.max(5, ph * 0.075) + 2} width="18" height={ph - 7 - Math.max(5, ph * 0.075) - 2} rx="7" />
          </g>
        )}
      </svg>
      <figcaption className="text-[13px] text-muted">Drawn to scale. The grey figure is a person 5.6 ft tall.</figcaption>
    </figure>
  );
}
