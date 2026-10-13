// Brand devices drawn from the print trade: crop marks, halftone dots, and a proof-sheet frame.

/** Crop marks in the four corners, just outside the box they sit in. Desktop only: phones keep the space. */
export function CropMarks({ tone = 'ink' }: { tone?: 'ink' | 'light' }) {
  const c = tone === 'ink' ? 'bg-ink/70' : 'bg-white/60';
  const h = `absolute h-[1.5px] w-3 ${c}`;
  const v = `absolute w-[1.5px] h-3 ${c}`;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -inset-[22px] hidden sm:block">
      <span className={`${h} left-0 top-[22px]`} /><span className={`${v} left-[22px] top-0`} />
      <span className={`${h} right-0 top-[22px]`} /><span className={`${v} right-[22px] top-0`} />
      <span className={`${h} left-0 bottom-[22px]`} /><span className={`${v} left-[22px] bottom-0`} />
      <span className={`${h} right-0 bottom-[22px]`} /><span className={`${v} right-[22px] bottom-0`} />
    </span>
  );
}

/** A halftone field: dots that grow from left to right, the way a printed gradient is built. */
export function Halftone({ cols = 12, rows = 9, gap = 34, max = 12, color = '#FFC400', className = '', fit = 'meet' }: { cols?: number; rows?: number; gap?: number; max?: number; color?: string; className?: string; fit?: 'meet' | 'slice' }) {
  const dots: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = c / (cols - 1);
      const rad = 1.4 + k * max * (0.55 + 0.45 * Math.sin(r * 0.62 + 0.4));
      dots.push(<circle key={`${r}-${c}`} cx={c * gap + gap / 2} cy={r * gap + gap / 2} r={rad.toFixed(2)} opacity={(0.22 + 0.78 * k).toFixed(2)} />);
    }
  }
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${cols * gap} ${rows * gap}`} className={className} fill={color} preserveAspectRatio={`xMaxYMid ${fit}`}>
      {dots}
    </svg>
  );
}

export function Avatar({ name, className = 'h-9 w-9 text-[15px]' }: { name?: string | null; className?: string }) {
  const initial = (name ?? '').trim().charAt(0).toUpperCase() || 'B';
  // The initial is drawn by CSS, so it is not part of the page's text. A link that says "Chioma" would otherwise read as "CChioma".
  return <span aria-hidden="true" data-initial={initial} className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-display font-extrabold text-ink after:content-[attr(data-initial)] ${className}`} />;
}
