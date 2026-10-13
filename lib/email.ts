import { appUrl } from './messages';

/** Transactional email through Resend. Set RESEND_API_KEY and EMAIL_FROM (for example "Brandit <hello@brandit.ng>"). */
export const emailOn = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(m: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!res.ok) throw new Error(`Email ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function codeEmail(code: string) {
  const logo = `${appUrl()}/brand/logo-horizontal.png`;
  const text = `Your Brandit code is ${code}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.\n\nBrandit. Printing without the hassle.`;
  const html = `<!doctype html><html><body style="margin:0;background:#F3F5F7;font-family:Arial,Helvetica,sans-serif;color:#0B1F33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F7;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #D9DFE5;border-radius:16px">
<tr><td style="padding:28px 32px 8px"><img src="${esc(logo)}" alt="Brandit" height="32" style="height:32px;width:auto;display:block"></td></tr>
<tr><td style="padding:8px 32px 0;font-size:16px;line-height:1.5">Use this code to sign in. It works for 10 minutes.</td></tr>
<tr><td style="padding:20px 32px"><div style="font-size:40px;font-weight:800;letter-spacing:10px;background:#FFF1CC;border-radius:12px;text-align:center;padding:18px 0;color:#0B1F33">${esc(code)}</div></td></tr>
<tr><td style="padding:0 32px 28px;font-size:14px;line-height:1.5;color:#3D5166">Did not ask for this? Ignore this email and nothing will happen. Never share this code with anyone.</td></tr>
</table>
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px"><tr><td style="padding:16px 8px;font-size:13px;color:#3D5166;text-align:center">Brandit. Printing without the hassle.</td></tr></table>
</td></tr></table></body></html>`;
  return { subject: `${code} is your Brandit code`, text, html };
}

export function receiptEmail(v: { code: string; product: string; quantity: number; totalNaira: string; arrival: string; trackUrl: string; receiptUrl: string; couponCode?: string | null; discountNaira?: string | null }) {
  // A custom job is one line with its own title, so it has no "1 x" in front of it.
  const what = v.product.startsWith('Custom:') ? v.product : `${v.quantity.toLocaleString('en-US')} x ${v.product}`;
  const saved = v.couponCode && v.discountNaira ? `Coupon ${v.couponCode} saved you ${v.discountNaira}` : null;
  const logo = `${appUrl()}/brand/logo-horizontal.png`;
  const text = `Paid. We have started on order ${v.code}.\n\n${what}\n${saved ? `${saved}\n` : ''}Total ${v.totalNaira}\n${v.arrival}\n\nTrack your order: ${v.trackUrl}\nYour receipt: ${v.receiptUrl}\n\nNext, a person checks your file. Brandit. Printing without the hassle.`;
  const btn = (href: string, label: string, dark = false) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:14px 22px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;${dark ? 'background:#FFFFFF;color:#0B1F33;border:2px solid #0B1F33' : 'background:#FFC400;color:#0B1F33'}">${esc(label)}</a>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F3F5F7;font-family:Arial,Helvetica,sans-serif;color:#0B1F33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F7;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #D9DFE5;border-radius:16px">
<tr><td style="padding:28px 32px 8px"><img src="${esc(logo)}" alt="Brandit" height="32" style="height:32px;width:auto;display:block"></td></tr>
<tr><td style="padding:12px 32px 0;font-size:26px;font-weight:800;line-height:1.15">Paid. We have started on order ${esc(v.code)}.</td></tr>
<tr><td style="padding:16px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #D9DFE5;border-radius:12px"><tr><td style="padding:16px 18px;font-size:16px">${esc(what).replace(' x ', ' &times; ')}${saved ? `<div style="margin-top:6px;font-size:14px;color:#146B3A">${esc(saved)}</div>` : ''}</td><td align="right" style="padding:16px 18px;font-size:20px;font-weight:800">${esc(v.totalNaira)}</td></tr></table></td></tr>
<tr><td style="padding:16px 32px 0"><div style="background:#E3F4EC;border-radius:12px;padding:14px 18px;font-size:16px;font-weight:700">${esc(v.arrival)}</div></td></tr>
<tr><td style="padding:20px 32px 0;font-size:16px;line-height:1.5">Next, a person checks your file. We will message you at every step, so you never have to chase.</td></tr>
<tr><td style="padding:20px 32px 28px">${btn(v.trackUrl, 'Track your order')}${btn(v.receiptUrl, 'View your receipt', true)}</td></tr>
</table>
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="padding:16px 8px;font-size:13px;color:#3D5166;text-align:center">Brandit. Printing without the hassle.</td></tr></table>
</td></tr></table></body></html>`;
  return { subject: `Paid: order ${v.code}`, text, html };
}
