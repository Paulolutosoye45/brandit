// The approved Brandit logo (October 2026). The artwork is Brandit's own and is never redrawn here: every file in
// public/brand/ is cut from the approved masters, public/brand/logo-original.png and, for dark backgrounds,
// public/brand/logo-original-on-dark.png (the all-white version supplied with it).
//   full      "brandit" with its speed lines. For headers, footers, invoices and emails.
//   stacked   the logo exactly as approved, with the tagline. For sign-in, 404 pages and anywhere there is room.
//             It is wide, so size it by width (w-[300px] h-auto), not by height.
//   mark      the b with its speed lines. For small spaces; the app icons are cut from it.
//   wordmark  "brandit" on its own, without the speed lines.
// tone "light" is for dark backgrounds: the all-white version.
const FILES = {
  full: { name: 'logo-horizontal', w: 1100, h: 237 },
  stacked: { name: 'logo', w: 1200, h: 329 },
  mark: { name: 'mark', w: 640, h: 428 },
  wordmark: { name: 'wordmark', w: 900, h: 219 },
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
