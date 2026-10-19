import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MiniMarkdown, headingsOf } from '../components/MiniMarkdown';

const html = (source: string) => renderToStaticMarkup(createElement(MiniMarkdown, { source }));

describe('the words the team writes', () => {
  it('shows headings, lists, bold, italics and a rule', () => {
    const out = html('## First\n\nSome **bold** and *soft* words.\n\n- one\n- two\n\n1. step\n2. next\n\n---\n\n### Small');
    expect(out).toContain('<h2 id="s1"');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>soft</em>');
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<li>step</li><li>next</li>');
    expect(out).toContain('<hr');
    expect(out).toContain('<h3');
  });

  it('can never run what is typed as code', () => {
    const out = html('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('turns only safe addresses into links', () => {
    const out = html('[ours](/products) [safe](https://thebrandit.ng/x) [mail](mailto:hello@thebrandit.ng) [call](tel:+2348031234567) [bad](javascript:alert(1)) [worse](//evil.example) [data](data:text/html,hi) [plain](http://insecure.example)');
    expect(out).toContain('href="/products"');
    expect(out).toContain('href="https://thebrandit.ng/x"');
    expect(out).toContain('href="mailto:hello@thebrandit.ng"');
    expect(out).toContain('href="tel:+2348031234567"');
    for (const bad of ['javascript:', '//evil.example', 'data:text', 'http://insecure']) expect(out).not.toContain(`href="${bad}`);
    expect(out).toContain('bad'); // the words stay, the link goes
  });

  it('numbers the headings the same way the contents list does', () => {
    const md = '## Who we are\n\ntext\n\n### Not in the list\n\n## What we **do**\n';
    expect(headingsOf(md)).toEqual([{ id: 's1', title: 'Who we are' }, { id: 's2', title: 'What we do' }]);
    const out = html(md);
    expect(out).toContain('id="s1"');
    expect(out).toContain('id="s2"');
  });

  it('copes with Windows line endings and an empty page', () => {
    expect(html('## A\r\n\r\ntext\r\n- x\r\n- y')).toContain('<li>y</li>');
    expect(html('')).toBe('');
  });
});
