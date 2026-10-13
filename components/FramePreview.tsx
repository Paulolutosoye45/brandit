const COLOURS: Record<string, { frame: string; edge: string }> = {
  black: { frame: '#14181D', edge: '#000000' },
  white: { frame: '#FFFFFF', edge: '#C9D3DD' },
  wood: { frame: '#B98350', edge: '#8F5F34' },
};

/** The chosen frame, in the chosen size and colour, so the choice is something you can see. Sizes are in inches. */
export function FramePreview({ sizeKey, colour }: { sizeKey: string; colour: string }) {
  const m = /^(\d+)x(\d+)$/.exec(sizeKey);
  const a = m ? Number(m[1]) : 12, b = m ? Number(m[2]) : 16;
  const w = Math.min(a, b), h = Math.max(a, b);
  const k = Math.min(150 / w, 170 / h);
  const fw = w * k, fh = h * k, x = (240 - fw) / 2, y = (200 - fh) / 2;
  const c = COLOURS[colour] ?? COLOURS.black;
  const t = Math.max(7, fw * 0.075);
  return (
    <figure className="grid gap-2">
      <svg viewBox="0 0 240 200" className="w-full max-w-[320px] rounded-md2 bg-paper2" role="img" aria-label={`A ${sizeKey.replace('x', ' by ')} inch frame in ${colour}`}>
        <rect x={x + 5} y={y + 7} width={fw} height={fh} fill="#0B1F33" opacity=".12" />
        <rect x={x} y={y} width={fw} height={fh} fill={c.frame} stroke={c.edge} strokeWidth="1.5" />
        <rect x={x + t} y={y + t} width={fw - 2 * t} height={fh - 2 * t} fill="#FFFFFF" />
        <rect x={x + t * 2.2} y={y + t * 2.2} width={fw - 4.4 * t} height={fh - 4.4 * t} fill="#E9EDF1" />
        <circle cx={x + fw * 0.64} cy={y + fh * 0.32} r={Math.max(5, fw * 0.07)} fill="#FFC400" />
        <path d={`M${x + t * 2.2} ${y + fh - t * 2.2} L${x + t * 2.2} ${y + fh * 0.7} L${x + fw * 0.4} ${y + fh * 0.5} L${x + fw * 0.58} ${y + fh * 0.68} L${x + fw * 0.7} ${y + fh * 0.58} L${x + fw - t * 2.2} ${y + fh * 0.72} L${x + fw - t * 2.2} ${y + fh - t * 2.2} Z`} fill="#0B1F33" />
      </svg>
      <figcaption className="text-[13px] text-muted">{a} × {b} inches, {colour === 'wood' ? 'natural wood' : colour}. Your photo goes inside.</figcaption>
    </figure>
  );
}
