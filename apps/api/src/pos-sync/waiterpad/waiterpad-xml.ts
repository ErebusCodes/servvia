/**
 * A deliberately tiny, strict, dependency-free XML reader for WaiterPad
 * packets — and nothing else.
 *
 * WHY NOT A LIBRARY. Two reasons, and neither is "avoid a dependency for its
 * own sake".
 *
 * First, safety. This parser will one day be pointed at bytes arriving on a
 * socket from a machine we do not control. A general-purpose XML parser's job
 * is to accept as much as possible; ours is the opposite. There are no
 * entities beyond the five built-ins, no DOCTYPE, no external entities, no
 * CDATA, no comments, no processing instructions except the leading
 * declaration, no namespaces. Every one of those is a rejection, not a
 * best-effort interpretation. That closes the XXE and billion-laughs classes
 * by construction rather than by configuration.
 *
 * Second, honesty about the grammar. The packets we must read are six fixed
 * literals plus one repeating <OrderItem> shape. A parser that accepts exactly
 * that and refuses everything else is a better specification of the protocol
 * than a permissive one plus a schema.
 *
 * WHAT IT IS NOT. Not a general XML parser. Do not export it for other uses.
 */

/** Hard ceilings. A hostile or corrupt stream must not be able to exhaust us. */
export const XML_LIMITS = {
  maxBytes: 1_000_000,
  maxDepth: 8,
  maxElements: 20_000,
  maxNameLength: 64,
} as const;

export class WaiterPadXmlError extends Error {
  constructor(
    message: string,
    readonly offset?: number,
  ) {
    super(message);
    this.name = 'WaiterPadXmlError';
  }
}

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** Concatenated direct text content, entity-decoded. Never null; '' when empty. */
  readonly text: string;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** The five entities XML defines without a DTD. Nothing else is accepted. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(raw: string, offset: number): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&([^;&]{0,12});?/g, (whole, body: string) => {
    if (!whole.endsWith(';')) {
      throw new WaiterPadXmlError(`unterminated entity '${whole}'`, offset);
    }
    if (Object.prototype.hasOwnProperty.call(ENTITIES, body)) {
      return ENTITIES[body];
    }
    // Numeric character references are legal XML but have no place in this
    // protocol, and decoding them is a needless obfuscation channel.
    throw new WaiterPadXmlError(`unsupported entity '&${body};'`, offset);
  });
}

interface MutableElement {
  name: string;
  attributes: Record<string, string>;
  children: MutableElement[];
  textParts: string[];
}

function freeze(node: MutableElement): XmlElement {
  return {
    name: node.name,
    attributes: Object.freeze({ ...node.attributes }),
    children: Object.freeze(node.children.map(freeze)),
    text: node.textParts.join('').trim(),
  };
}

/**
 * Parse one WaiterPad document and return its single root element.
 *
 * Throws `WaiterPadXmlError` on anything it does not recognise. Callers must
 * treat a throw as "this is not a WaiterPad packet", never as "try harder".
 */
export function parseWaiterPadXml(input: string): XmlElement {
  if (typeof input !== 'string') {
    throw new WaiterPadXmlError('input is not a string');
  }
  if (input.length > XML_LIMITS.maxBytes) {
    throw new WaiterPadXmlError(`document exceeds ${XML_LIMITS.maxBytes} bytes`);
  }

  let i = 0;
  const n = input.length;
  let elementCount = 0;
  const stack: MutableElement[] = [];
  let root: MutableElement | null = null;

  const fail = (m: string): never => {
    throw new WaiterPadXmlError(m, i);
  };

  // Optional leading XML declaration. Anything else prefixed to the document
  // is a rejection: no BOM handling, no leading junk.
  const skipWhitespace = () => {
    while (i < n && /\s/.test(input[i])) i += 1;
  };

  skipWhitespace();
  if (input.startsWith('<?', i)) {
    const close = input.indexOf('?>', i);
    if (close < 0) fail('unterminated XML declaration');
    const decl = input.slice(i + 2, close);
    if (!/^xml[\s]/i.test(decl)) {
      fail('processing instructions are not accepted');
    }
    i = close + 2;
  }

  while (i < n) {
    const lt = input.indexOf('<', i);

    if (lt < 0) {
      // Trailing text after the root element closed.
      if (input.slice(i).trim() !== '') fail('text outside the root element');
      break;
    }

    if (lt > i) {
      const chunk = input.slice(i, lt);
      const current = stack[stack.length - 1];
      if (current) {
        current.textParts.push(decodeEntities(chunk, i));
      } else if (chunk.trim() !== '') {
        fail('text outside the root element');
      }
      i = lt;
    }

    if (input.startsWith('<!', i)) {
      // Comments, CDATA and DOCTYPE all land here and are all refused.
      fail('comments, CDATA and DOCTYPE are not accepted');
    }
    if (input.startsWith('<?', i)) {
      fail('processing instructions are not accepted');
    }

    const gt = input.indexOf('>', i);
    if (gt < 0) fail('unterminated tag');
    const rawTag = input.slice(i + 1, gt);
    if (rawTag.length === 0) fail('empty tag');

    if (rawTag.startsWith('/')) {
      const name = rawTag.slice(1).trim();
      const current = stack.pop();
      if (!current) fail(`unexpected closing tag '${name}'`);
      if (current!.name !== name) {
        fail(`closing tag '${name}' does not match open element '${current!.name}'`);
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = rawTag.endsWith('/');
    const body = selfClosing ? rawTag.slice(0, -1) : rawTag;

    const nameMatch = /^([^\s]+)/.exec(body.trim());
    if (!nameMatch) fail('tag without a name');
    const name = nameMatch![1];
    if (name.length > XML_LIMITS.maxNameLength) fail('element name too long');
    if (!NAME_RE.test(name)) fail(`illegal element name '${name}'`);
    if (name.includes(':')) fail('namespaced elements are not accepted');

    elementCount += 1;
    if (elementCount > XML_LIMITS.maxElements) {
      fail(`document exceeds ${XML_LIMITS.maxElements} elements`);
    }

    const attributes: Record<string, string> = {};
    const attrSource = body.trim().slice(name.length);
    // Attribute grammar, deliberately narrow: name = 'value' or name="value",
    // with optional whitespace around '='. IPS.exe emits `Type = 'ACK'`, with
    // the spaces, so the spaces must be tolerated.
    const attrRe = /\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
    let consumed = 0;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrSource)) !== null) {
      if (am.index !== consumed) fail('malformed attribute list');
      const attrName = am[1];
      if (attrName.includes(':')) fail('namespaced attributes are not accepted');
      if (Object.prototype.hasOwnProperty.call(attributes, attrName)) {
        fail(`duplicate attribute '${attrName}'`);
      }
      attributes[attrName] = decodeEntities(am[2] !== undefined ? am[2] : am[3], i);
      consumed = attrRe.lastIndex;
    }
    if (attrSource.slice(consumed).trim() !== '') fail('malformed attribute list');

    const node: MutableElement = { name, attributes, children: [], textParts: [] };

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else if (root) {
      fail('a second root element is not allowed');
    } else {
      root = node;
    }

    if (!selfClosing) {
      stack.push(node);
      if (stack.length > XML_LIMITS.maxDepth) {
        fail(`document exceeds depth ${XML_LIMITS.maxDepth}`);
      }
    }

    i = gt + 1;
  }

  if (stack.length > 0) {
    throw new WaiterPadXmlError(`unclosed element '${stack[stack.length - 1].name}'`);
  }
  if (!root) {
    throw new WaiterPadXmlError('document contains no elements');
  }
  return freeze(root);
}

/** First direct child with this exact name, or undefined. Case sensitive. */
export function childNamed(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c) => c.name === name);
}

/** All direct children with this exact name, in document order. */
export function childrenNamed(el: XmlElement, name: string): readonly XmlElement[] {
  return el.children.filter((c) => c.name === name);
}

/**
 * XML-escape a text value for serialisation.
 *
 * Escapes all five, including quotes in text position. Over-escaping is inert;
 * under-escaping is an injection.
 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
