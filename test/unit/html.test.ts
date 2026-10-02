import { describe, expect, it } from 'vitest';
import { escapeHtml, renderStatusPage } from '../../src/shared/html.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('renderStatusPage', () => {
  it('renders a Thai page with every value escaped', () => {
    const html = renderStatusPage({
      status: 410,
      title: 'ลิงก์หมดอายุแล้ว',
      message: '<script>alert(1)</script>',
    });
    expect(html).toContain('<html lang="th">');
    expect(html).toContain('ลิงก์หมดอายุแล้ว');
    expect(html).toContain('410');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
