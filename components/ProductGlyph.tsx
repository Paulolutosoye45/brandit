// Simple stroke pictograms stand in for product photos until real Brandit work is photographed.
export function ProductGlyph({ slug, className = 'h-16 w-16' }: { slug: string; className?: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  const art: Record<string, React.ReactNode> = {
    'business-cards': (<><rect x="8" y="18" width="40" height="26" rx="3" {...p} /><rect x="16" y="26" width="40" height="26" rx="3" {...p} /><path d="M24 36h16M24 43h10" {...p} /></>),
    flyers: (<><rect x="16" y="8" width="32" height="48" rx="3" {...p} /><path d="M24 20h16M24 28h16M24 36h10" {...p} /></>),
    posters: (<><rect x="12" y="6" width="40" height="52" rx="2" {...p} /><circle cx="32" cy="26" r="8" {...p} /><path d="M20 46h24M24 52h16" {...p} /></>),
    'roll-up-banners': (<><rect x="18" y="6" width="28" height="44" rx="2" {...p} /><path d="M10 54h44M26 18h12M26 26h12M26 34h7" {...p} /></>),
    'flex-banners': (<><rect x="6" y="14" width="52" height="30" rx="2" {...p} /><circle cx="11" cy="19" r="1.5" {...p} /><circle cx="53" cy="19" r="1.5" {...p} /><circle cx="11" cy="39" r="1.5" {...p} /><circle cx="53" cy="39" r="1.5" {...p} /><path d="M18 26h28M18 33h18M32 44v12M22 56h20" {...p} /></>),
    stickers: (<><circle cx="30" cy="30" r="20" {...p} /><path d="M44 44c4 2 8 6 10 10-8 0-12-2-14-6" {...p} /><path d="M22 28h16M22 35h10" {...p} /></>),
    'branded-t-shirts': (<><path d="M22 8l-14 8 6 12 6-3v28h24V25l6 3 6-12-14-8c-2 4-6 6-10 6s-8-2-10-6z" {...p} /><path d="M26 34h12M28 41h8" {...p} /></>),
    'id-cards': (<><rect x="8" y="14" width="48" height="36" rx="4" {...p} /><circle cx="23" cy="30" r="6" {...p} /><path d="M14 44c1-5 5-7 9-7s8 2 9 7M38 26h12M38 33h12M38 40h7" {...p} /></>),
    'picture-frames': (<><rect x="8" y="8" width="48" height="48" rx="2" {...p} /><rect x="16" y="16" width="32" height="32" rx="1" {...p} /><path d="M16 42l10-10 8 8 6-6 8 8" {...p} /><circle cx="38" cy="24" r="3" {...p} /></>),
  };
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-hidden="true">
      {art[slug] ?? <rect x="10" y="10" width="44" height="44" rx="4" {...p} />}
    </svg>
  );
}
