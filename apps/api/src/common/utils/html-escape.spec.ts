import { escapeHtml } from './html-escape';

describe('escapeHtml', () => {
  it('encodes every HTML-significant character', () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;',
    );
  });

  it('encodes ampersands first, so existing entities are not left active', () => {
    expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
  });

  it('leaves ordinary text and non-ASCII names unchanged', () => {
    expect(escapeHtml('Zoë Ngāti O’Brien 12')).toBe('Zoë Ngāti O’Brien 12');
  });

  it('stringifies non-string values', () => {
    expect(escapeHtml(4)).toBe('4');
  });
});
