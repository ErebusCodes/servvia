import { createHash } from 'crypto';

/**
 * E8-S1 (expanded, KOT dispatch producer) — the rendering boundary.
 *
 * This is the ONE component authoritative for printable KOT content. It
 * runs in the API, before command creation (not in the connector), so that
 * the exact content sent for any print attempt can be reconstructed from
 * durable, versioned inputs at any later time — the connector receives
 * already-rendered text plus a checksum, never structured order data it
 * would have to interpret itself. This is a deliberate choice for
 * determinism and auditability: a rendering decision only ever needs to be
 * made once, by one component, and is then immutable for that attempt.
 *
 * A kitchen ticket carries no price, GST, or payment data — see
 * `renderKotContent`'s omission of `priceDeltaCents` and any totals field
 * from `KotRenderInput` entirely (the type does not expose the fields
 * needed to print them, which is a stronger guarantee than "we chose not
 * to call a method that would").
 */

// Story 15-13: bumped 1 -> 2. The connector's PrintKotCommandHandler never
// checks this value (it only checksums/prints the already-rendered
// `content` string — see printer-connector-command.constants.ts's separate,
// unchanged PRINT_KOT_SCHEMA_VERSION for the payload contract the connector
// DOES validate), so this bump breaks nothing for the one real consumer.
// It exists purely so a future forensic read of a KotRenderInput/checksum
// pair can tell, from the version alone, whether takeaway rendering
// (serviceMode/takeawayReference) was a possible input shape at print time.
export const KOT_RENDER_VERSION = 2;

export interface KotRenderModifier {
  modifierGroupName: string | null;
  optionName: string;
}

export interface KotRenderItem {
  menuItemTitle: string;
  quantity: number;
  notes: string | null;
  selectedModifiers: KotRenderModifier[];
}

export interface KotRenderInput {
  printerJobId: string;
  orderId: string | null;
  tableNumber: string | null;
  /**
   * Story 15-13. `'dine_in'` preserves the exact pre-existing rendering
   * (table line, no takeaway banner/reference). `'takeaway'` renders a
   * prominent `*** TAKEAWAY ***` banner and `takeawayReference` instead of
   * a table line — `tableNumber` is expected to be null for takeaway (a
   * dine-in table is never fabricated), but this renderer does not itself
   * enforce that invariant; `OrdersService`/the schema already do (a
   * takeaway `Order` can never carry a `tableId`).
   */
  serviceMode: 'dine_in' | 'takeaway';
  /** Only meaningful (and only ever non-null) for `serviceMode: 'takeaway'`. */
  takeawayReference: string | null;
  printerName: string;
  /** Printer.type — the closest existing field to "station"; no separate
   * station/course/seat model exists in this schema today (see the story
   * file's Explicit Exclusions). */
  station: string;
  items: KotRenderItem[];
  orderNotes: string | null;
  /** Printer.charPerLine — governs deterministic line wrapping. */
  charPerLine: number;
}

export interface RenderedKot {
  renderVersion: number;
  content: string;
  checksum: string;
}

/**
 * Strips ASCII control characters (0x00-0x1F, 0x7F) other than newline —
 * hostile input (e.g. a menu item title containing a bell character, escape
 * sequence, or other printer-control byte) must never reach raw ESC/POS
 * text output, where it could be interpreted as a device command rather
 * than literal text. Unicode is preserved and NFC-normalized so visually
 * identical input always produces byte-identical output (determinism).
 */
function sanitizeText(input: string): string {
  const normalized = input.normalize('NFC');
  let out = '';
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\n') {
      out += ch;
      continue;
    }
    if (code <= 0x1f || code === 0x7f) continue;
    out += ch;
  }
  return out.trim();
}

/** Deterministic hard-wrap at `width` characters, breaking on spaces where possible. */
function wrapLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function wrapText(text: string, width: number): string[] {
  return text.split('\n').flatMap((line) => wrapLine(line, width));
}

/**
 * Renders deterministic KOT content: identical input always produces a
 * byte-identical `content` string and `checksum`. Never includes price,
 * GST, or payment fields — `KotRenderInput` structurally cannot carry them.
 */
export function renderKotContent(input: KotRenderInput): RenderedKot {
  const width = input.charPerLine > 0 ? input.charPerLine : 42;
  const lines: string[] = [];

  lines.push(...wrapText(sanitizeText('KITCHEN ORDER TICKET'), width));
  lines.push(...wrapText(sanitizeText(`Station: ${input.printerName} (${input.station})`), width));
  if (input.serviceMode === 'takeaway') {
    // Prominent, unambiguous — never rendered alongside a table line, and
    // never omitted for a takeaway order (unlike the table line, which is
    // conditional). See kot-renderer.spec.ts's "never both a table line and
    // a TAKEAWAY banner" regression test.
    lines.push(...wrapText('*** TAKEAWAY ***', width));
    lines.push(
      ...wrapText(
        sanitizeText(`Ref: ${input.takeawayReference ?? '(reference unavailable)'}`),
        width,
      ),
    );
  } else if (input.tableNumber) {
    lines.push(...wrapText(sanitizeText(`Table: ${input.tableNumber}`), width));
  }
  lines.push('');

  for (const item of input.items) {
    const title = sanitizeText(item.menuItemTitle) || '(unnamed item)';
    lines.push(...wrapText(`${item.quantity}x ${title}`, width));
    for (const mod of item.selectedModifiers) {
      const groupPrefix = mod.modifierGroupName ? `${sanitizeText(mod.modifierGroupName)}: ` : '';
      const optionName = sanitizeText(mod.optionName);
      lines.push(...wrapText(`   - ${groupPrefix}${optionName}`, width));
    }
    if (item.notes) {
      lines.push(...wrapText(`   note: ${sanitizeText(item.notes)}`, width));
    }
  }

  if (input.orderNotes) {
    lines.push('');
    lines.push(...wrapText(sanitizeText(`Order notes: ${input.orderNotes}`), width));
  }

  const content = lines.join('\n');
  const checksum = createHash('sha256').update(content, 'utf8').digest('hex');

  return { renderVersion: KOT_RENDER_VERSION, content, checksum };
}
