'use client';
export function PrintButton({ label = 'Print this page' }: { label?: string }) {
  return <button type="button" className="btn-secondary btn-sm no-print" onClick={() => window.print()}>{label}</button>;
}
