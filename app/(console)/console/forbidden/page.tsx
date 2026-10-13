import Link from 'next/link';
export const metadata = { title: 'Not allowed' };
export default function Forbidden() {
  return (
    <main className="min-h-screen grid place-items-center px-5"><div className="card p-8 max-w-[440px] grid gap-3 text-center"><h1 className="text-[28px]">That is not part of your role.</h1><p className="text-muted">Ask an admin if you need access.</p><Link className="btn-primary" href="/console/queue">Back to the queue</Link></div></main>
  );
}
