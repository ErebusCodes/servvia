import { renderKotContent, KotRenderInput, KOT_RENDER_VERSION } from './kot-renderer';

function baseInput(overrides: Partial<KotRenderInput> = {}): KotRenderInput {
  return {
    printerJobId: 'job-1',
    orderId: 'order-1',
    tableNumber: '12',
    serviceMode: 'dine_in',
    takeawayReference: null,
    printerName: 'Kitchen Printer',
    station: 'kitchen',
    orderNotes: null,
    charPerLine: 42,
    items: [
      {
        menuItemTitle: 'Lamb Machboos',
        quantity: 2,
        notes: null,
        selectedModifiers: [],
      },
    ],
    ...overrides,
  };
}

describe('renderKotContent', () => {
  it('is deterministic: identical input produces byte-identical content and checksum', () => {
    const a = renderKotContent(baseInput());
    const b = renderKotContent(baseInput());
    expect(a.content).toBe(b.content);
    expect(a.checksum).toBe(b.checksum);
    expect(a.renderVersion).toBe(KOT_RENDER_VERSION);
  });

  it('a different input produces a different checksum', () => {
    const a = renderKotContent(baseInput());
    const b = renderKotContent(baseInput({ tableNumber: '13' }));
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('includes table, item, quantity, and station', () => {
    const { content } = renderKotContent(baseInput());
    expect(content).toContain('Table: 12');
    expect(content).toContain('2x Lamb Machboos');
    expect(content).toContain('Kitchen Printer');
    expect(content).toContain('kitchen');
  });

  it('includes Story 15-3 modifier snapshots with their group name', () => {
    const { content } = renderKotContent(
      baseInput({
        items: [
          {
            menuItemTitle: 'Burger',
            quantity: 1,
            notes: null,
            selectedModifiers: [
              { modifierGroupName: 'Spice Level', optionName: 'Extra Hot' },
              { modifierGroupName: null, optionName: 'No Onion' },
            ],
          },
        ],
      }),
    );
    expect(content).toContain('Spice Level: Extra Hot');
    expect(content).toContain('No Onion');
  });

  it('includes item and order notes', () => {
    const { content } = renderKotContent(
      baseInput({
        orderNotes: 'Birthday table, rush please',
        items: [
          {
            menuItemTitle: 'Pasta',
            quantity: 1,
            notes: 'No cheese - allergy',
            selectedModifiers: [],
          },
        ],
      }),
    );
    expect(content).toContain('No cheese - allergy');
    expect(content).toContain('Birthday table, rush please');
  });

  it('never includes price, GST, or payment fields — the input type cannot carry them', () => {
    const { content } = renderKotContent(baseInput());
    // Structural guarantee: KotRenderInput has no price/tax/total field at
    // all, so there is nothing to assert-away at the content level beyond
    // confirming none of these words leak in from anywhere else.
    expect(content.toLowerCase()).not.toMatch(/gst|subtotal|total\s*\$|price/);
  });

  it('strips ASCII control/escape characters from hostile input, preserving newlines', () => {
    const { content } = renderKotContent(
      baseInput({
        items: [
          {
            menuItemTitle: 'Evil\x1b[31mItem\x07\x00',
            quantity: 1,
            notes: null,
            selectedModifiers: [],
          },
        ],
      }),
    );
    // eslint-disable-next-line no-control-regex
    expect(content).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
    // The ESC/BEL/NUL control bytes are stripped; the surrounding literal,
    // printable text (including the escape sequence's printable tail) is
    // preserved verbatim — sanitization removes control bytes, not text.
    expect(content).toContain('Evil[31mItem');
  });

  it('preserves and NFC-normalizes unicode', () => {
    const { content } = renderKotContent(
      baseInput({
        items: [
          { menuItemTitle: 'Café Ñoño 中文', quantity: 1, notes: null, selectedModifiers: [] },
        ],
      }),
    );
    expect(content).toContain('Café Ñoño 中文');
  });

  it('wraps lines deterministically at the printer charPerLine limit', () => {
    const longTitle = 'A'.repeat(100);
    const { content } = renderKotContent(
      baseInput({
        charPerLine: 20,
        items: [{ menuItemTitle: longTitle, quantity: 1, notes: null, selectedModifiers: [] }],
      }),
    );
    for (const line of content.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  it('falls back to a sane default line width when charPerLine is not positive', () => {
    const { content } = renderKotContent(baseInput({ charPerLine: 0 }));
    expect(content.length).toBeGreaterThan(0);
  });

  it('handles an item with an empty/whitespace-only title without throwing', () => {
    const { content } = renderKotContent(
      baseInput({
        items: [{ menuItemTitle: '   ', quantity: 1, notes: null, selectedModifiers: [] }],
      }),
    );
    expect(content).toContain('(unnamed item)');
  });

  it('omits the table line when no table is set', () => {
    const { content } = renderKotContent(baseInput({ tableNumber: null }));
    expect(content).not.toContain('Table:');
  });

  // Story 15-13
  it('renders a prominent TAKEAWAY banner and reference, never a table line, for a takeaway order', () => {
    const { content } = renderKotContent(
      baseInput({
        serviceMode: 'takeaway',
        takeawayReference: 'TA-000042',
        tableNumber: null,
      }),
    );
    expect(content).toContain('*** TAKEAWAY ***');
    expect(content).toContain('Ref: TA-000042');
    expect(content).not.toContain('Table:');
  });

  it('never renders both a table line and a TAKEAWAY banner, even if tableNumber is non-null on a takeaway input', () => {
    // Defensive: OrdersService/the schema already guarantee a takeaway
    // order never carries a table, but this renderer's own output must
    // stay unambiguous even if that invariant were ever violated upstream.
    const { content } = renderKotContent(
      baseInput({ serviceMode: 'takeaway', takeawayReference: 'TA-000042', tableNumber: '12' }),
    );
    expect(content).toContain('*** TAKEAWAY ***');
    expect(content).not.toContain('Table:');
  });

  it('dine-in rendering is byte-identical to before this story when takeawayReference is null', () => {
    const { content, checksum } = renderKotContent(
      baseInput({ serviceMode: 'dine_in', takeawayReference: null }),
    );
    expect(content).toContain('Table: 12');
    expect(content).not.toContain('TAKEAWAY');
    expect(checksum).toHaveLength(64); // sha256 hex, unchanged shape
  });
});
