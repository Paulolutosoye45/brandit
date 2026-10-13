'use client';
// Last resort, when even the page frame fails. Plain on purpose: it must not depend on anything else loading.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-NG">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F3F5F7', color: '#0B1F33' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '96px 20px' }}>
          <h1 style={{ fontSize: 36, lineHeight: 1.1, margin: '0 0 12px' }}>Something went wrong on our side.</h1>
          <p style={{ fontSize: 18, color: '#3D5166', margin: '0 0 24px' }}>It was not anything you did. Try again in a moment.</p>
          <button onClick={reset} style={{ background: '#FFC400', color: '#0B1F33', border: 0, borderRadius: 12, padding: '14px 24px', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
