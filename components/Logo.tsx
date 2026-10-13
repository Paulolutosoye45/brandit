// The approved Brandit logo. The artwork is Brandit's own and is never redrawn here: every file in
// public/brand/ is cut from the approved master (public/brand/logo-original.png).
//   full      the mark and the wordmark side by side. For headers, footers and invoices.
//   stacked   the logo exactly as approved, with the tagline. For sign-in, 404 pages and anywhere there is room.
//   mark      the B mark on its own. For small spaces.
//   wordmark  "brandit" on its own.
// tone "light" is for dark backgrounds: the navy parts turn white, the yellow stays.
const FILES = {
  full: { name: 'logo-horizontal', w: 1100, h: 249 },
  stacked: { name: 'logo', w: 900, h: 780 },
  mark: { name: 'mark', w: 640, h: 418 },
  wordmark: { name: 'wordmark', w: 900, h: 198 },
} as const;

type Props = {
  variant?: keyof typeof FILES;
  /** ink: for light backgrounds. light: for dark backgrounds. */
  tone?: 'ink' | 'light';
  className?: string;
  title?: string;
  priority?: boolean;
};

export function Logo({ variant = 'full', tone = 'ink', className = 'h-8 w-auto', title = 'Brandit', priority = false }: Props) {
  const f = FILES[variant];
  const src = `/brand/${f.name}${tone === 'light' ? '-on-dark' : ''}.png`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={f.w} height={f.h} alt={title} className={className} decoding="async" fetchPriority={priority ? 'high' : undefined} draggable={false} />;
}
