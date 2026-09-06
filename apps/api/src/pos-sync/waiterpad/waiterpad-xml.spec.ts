/**
 * The XML reader exists to REFUSE things. These tests are mostly about what it
 * must not accept, because the accept-path is only six fixed shapes.
 */
import {
  childNamed,
  childrenNamed,
  escapeXmlText,
  parseWaiterPadXml,
  WaiterPadXmlError,
  XML_LIMITS,
} from './waiterpad-xml';

describe('parseWaiterPadXml — accepts the protocol', () => {
  it('parses the exact ACK body the binary emits, spaces around = included', () => {
    const el = parseWaiterPadXml(
      `<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'ACK'></WPPacket>`,
    );
    expect(el.name).toBe('WPPacket');
    expect(el.attributes.Type).toBe('ACK');
  });

  it('parses double-quoted attributes and self-closing elements', () => {
    const el = parseWaiterPadXml(`<WPPacket Type="NAK"><Order Type="ORDER"/></WPPacket>`);
    expect(el.attributes.Type).toBe('NAK');
    expect(childNamed(el, 'Order')?.attributes.Type).toBe('ORDER');
  });

  it('collects repeated children in document order', () => {
    const el = parseWaiterPadXml(
      `<WPPacket><OrderItem><StockItem>1</StockItem></OrderItem>` +
        `<OrderItem><StockItem>2</StockItem></OrderItem></WPPacket>`,
    );
    const items = childrenNamed(el, 'OrderItem');
    expect(items).toHaveLength(2);
    expect(items.map((i) => childNamed(i, 'StockItem')?.text)).toEqual(['1', '2']);
  });

  it('decodes exactly the five built-in entities', () => {
    const el = parseWaiterPadXml(`<WPPacket><D>a&amp;b&lt;c&gt;d&quot;e&apos;f</D></WPPacket>`);
    expect(childNamed(el, 'D')?.text).toBe(`a&b<c>d"e'f`);
  });

  it('trims text but preserves interior spacing', () => {
    const el = parseWaiterPadXml(`<WPPacket><D>  Lemon  slice  </D></WPPacket>`);
    expect(childNamed(el, 'D')?.text).toBe('Lemon  slice');
  });
});

describe('parseWaiterPadXml — refuses everything else', () => {
  const rejects = (label: string, doc: string) =>
    it(`rejects ${label}`, () => {
      expect(() => parseWaiterPadXml(doc)).toThrow(WaiterPadXmlError);
    });

  rejects('a DOCTYPE (XXE vector)', `<!DOCTYPE p [<!ENTITY x "y">]><WPPacket/>`);
  rejects(
    'an external entity declaration',
    `<!DOCTYPE p [<!ENTITY x SYSTEM "file:///etc/passwd">]><WPPacket>&x;</WPPacket>`,
  );
  rejects('an undeclared entity reference', `<WPPacket><D>&xxe;</D></WPPacket>`);
  rejects('a numeric character reference', `<WPPacket><D>&#65;</D></WPPacket>`);
  rejects('an unterminated entity', `<WPPacket><D>&amp</D></WPPacket>`);
  rejects('CDATA', `<WPPacket><![CDATA[<evil/>]]></WPPacket>`);
  rejects('a comment', `<WPPacket><!-- hi --></WPPacket>`);
  rejects('a processing instruction', `<WPPacket><?php echo 1; ?></WPPacket>`);
  rejects('a namespaced element', `<ns:WPPacket xmlns:ns="u"/>`);
  rejects('a namespaced attribute', `<WPPacket ns:Type="ACK"/>`);
  rejects('mismatched tags', `<WPPacket Type='ACK'></WPPocket>`);
  rejects('an unclosed element', `<WPPacket><Order></WPPacket>`);
  rejects('an unexpected closing tag', `</WPPacket>`);
  rejects('two root elements', `<WPPacket/><WPPacket/>`);
  rejects('text outside the root', `hello<WPPacket/>`);
  rejects('trailing text after the root', `<WPPacket/>trailing`);
  rejects('an empty document', ``);
  rejects('a non-XML string', `ACK`);
  rejects('an unterminated tag', `<WPPacket Type='ACK'`);
  rejects('a duplicate attribute', `<WPPacket Type='ACK' Type='NAK'/>`);
  rejects('an unquoted attribute value', `<WPPacket Type=ACK/>`);
  rejects('a malformed attribute list', `<WPPacket Type='ACK' junk/>`);
  rejects('an illegal element name', `<WP*Packet/>`);

  it('rejects a document over the byte ceiling', () => {
    const huge = `<WPPacket>${'a'.repeat(XML_LIMITS.maxBytes)}</WPPacket>`;
    expect(() => parseWaiterPadXml(huge)).toThrow(/exceeds .* bytes/);
  });

  it('rejects nesting deeper than the ceiling (billion-laughs shape)', () => {
    const depth = XML_LIMITS.maxDepth + 3;
    const doc = `${'<A>'.repeat(depth)}x${'</A>'.repeat(depth)}`;
    expect(() => parseWaiterPadXml(doc)).toThrow(/depth/);
  });

  it('rejects an element-count flood', () => {
    const many = '<A/>'.repeat(XML_LIMITS.maxElements + 2);
    expect(() => parseWaiterPadXml(`<WPPacket>${many}</WPPacket>`)).toThrow(/elements/);
  });

  it('rejects a non-string input without throwing something unexpected', () => {
    expect(() => parseWaiterPadXml(undefined as unknown as string)).toThrow(WaiterPadXmlError);
    expect(() => parseWaiterPadXml(42 as unknown as string)).toThrow(WaiterPadXmlError);
  });
});

describe('escapeXmlText', () => {
  it('escapes all five metacharacters', () => {
    expect(escapeXmlText(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('round-trips through the parser', () => {
    const nasty = `Beef & "Ale" <pie> 'special'`;
    const el = parseWaiterPadXml(`<WPPacket><D>${escapeXmlText(nasty)}</D></WPPacket>`);
    expect(childNamed(el, 'D')?.text).toBe(nasty);
  });

  it('neutralises an attempted tag injection', () => {
    const injection = `x</Description></OrderItem><OrderItem><StockItem>999`;
    const doc = `<WPPacket><D>${escapeXmlText(injection)}</D></WPPacket>`;
    const el = parseWaiterPadXml(doc);
    expect(el.children).toHaveLength(1);
    expect(childNamed(el, 'D')?.text).toBe(injection);
  });
});
