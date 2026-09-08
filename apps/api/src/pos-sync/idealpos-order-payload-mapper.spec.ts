import {
  buildIdealposOrderPayload,
  IdealposMappingError,
  IdealposMappingInput,
} from './idealpos-order-payload-mapper';

function baseInput(overrides: Partial<IdealposMappingInput> = {}): IdealposMappingInput {
  return {
    externalOrderId: 'ORD-600123',
    serviceMode: 'dine_in',
    tableCode: 'T5',
    notes: null,
    items: [
      {
        menuItemId: 'item-1',
        menuItemTitle: 'Mixed Grill',
        quantity: 2,
        selectedModifiers: [],
        posProductCode: 'PLU-4821',
      },
    ],
    ...overrides,
  };
}

describe('buildIdealposOrderPayload', () => {
  it('builds the exact real bridge wire shape for a fully-mapped, modifier-free order', () => {
    const payload = buildIdealposOrderPayload(baseInput());
    expect(payload).toEqual({
      externalOrderId: 'ORD-600123',
      table: 'T5',
      items: [{ productCode: 'PLU-4821', quantity: 2 }],
    });
  });

  it('includes notes only when present — never an empty string field the bridge has to special-case', () => {
    const withNotes = buildIdealposOrderPayload(baseInput({ notes: 'No onion' }));
    expect(withNotes.notes).toBe('No onion');

    const withoutNotes = buildIdealposOrderPayload(baseInput({ notes: null }));
    expect(withoutNotes).not.toHaveProperty('notes');
  });

  it('is deterministic — the same input produces byte-identical output on every call, required for safe bridge-side idempotent retry', () => {
    const input = baseInput({
      items: [
        {
          menuItemId: 'a',
          menuItemTitle: 'A',
          quantity: 1,
          selectedModifiers: [],
          posProductCode: 'PLU-A',
        },
        {
          menuItemId: 'b',
          menuItemTitle: 'B',
          quantity: 3,
          selectedModifiers: [],
          posProductCode: 'PLU-B',
        },
      ],
    });
    expect(buildIdealposOrderPayload(input)).toEqual(buildIdealposOrderPayload(input));
  });

  it("rejects with unmapped_table when a dine-in order's table has no posTableCode — never guesses from tableNumber", () => {
    try {
      buildIdealposOrderPayload(baseInput({ serviceMode: 'dine_in', tableCode: null }));
      fail('expected IdealposMappingError');
    } catch (e) {
      expect(e).toBeInstanceOf(IdealposMappingError);
      expect((e as IdealposMappingError).reason).toBe('unmapped_table');
    }
  });

  it('rejects with takeaway_unsupported_by_bridge (never unmapped_table) for a takeaway order with no table — the real bridge requires a non-empty table and this is a bridge-contract gap, not a Verdura mapping omission', () => {
    try {
      buildIdealposOrderPayload(baseInput({ serviceMode: 'takeaway', tableCode: null }));
      fail('expected IdealposMappingError');
    } catch (e) {
      expect(e).toBeInstanceOf(IdealposMappingError);
      expect((e as IdealposMappingError).reason).toBe('takeaway_unsupported_by_bridge');
    }
  });

  it('rejects with unmapped_item when a menu item has no posProductCode — never falls back to the menuItemId', () => {
    const input = baseInput({
      items: [
        {
          menuItemId: 'item-1',
          menuItemTitle: 'Mixed Grill',
          quantity: 1,
          selectedModifiers: [],
          posProductCode: null,
        },
      ],
    });
    try {
      buildIdealposOrderPayload(input);
      fail('expected IdealposMappingError');
    } catch (e) {
      expect(e).toBeInstanceOf(IdealposMappingError);
      expect((e as IdealposMappingError).reason).toBe('unmapped_item');
      expect((e as IdealposMappingError).details).toEqual({ menuItemId: 'item-1' });
    }
  });

  it('a single unmapped item among several mapped ones still fails closed — no partial payload is ever returned', () => {
    const input = baseInput({
      items: [
        {
          menuItemId: 'a',
          menuItemTitle: 'A',
          quantity: 1,
          selectedModifiers: [],
          posProductCode: 'PLU-A',
        },
        {
          menuItemId: 'b',
          menuItemTitle: 'B',
          quantity: 1,
          selectedModifiers: [],
          posProductCode: null,
        },
      ],
    });
    expect(() => buildIdealposOrderPayload(input)).toThrow(IdealposMappingError);
  });

  it('rejects with unsupported_modifiers when an item has any selected modifier — the real bridge contract has no field for them, so they are never silently dropped or squeezed into notes', () => {
    const input = baseInput({
      items: [
        {
          menuItemId: 'item-1',
          menuItemTitle: 'Mixed Grill',
          quantity: 1,
          selectedModifiers: [{ optionId: 'opt-1', optionName: 'Extra Sauce' }],
          posProductCode: 'PLU-4821',
        },
      ],
    });
    try {
      buildIdealposOrderPayload(input);
      fail('expected IdealposMappingError');
    } catch (e) {
      expect(e).toBeInstanceOf(IdealposMappingError);
      expect((e as IdealposMappingError).reason).toBe('unsupported_modifiers');
    }
  });

  it('rejects with invalid_quantity for a zero or non-integer quantity', () => {
    expect(() =>
      buildIdealposOrderPayload(
        baseInput({
          items: [
            {
              menuItemId: 'a',
              menuItemTitle: 'A',
              quantity: 0,
              selectedModifiers: [],
              posProductCode: 'PLU-A',
            },
          ],
        }),
      ),
    ).toThrow(IdealposMappingError);

    expect(() =>
      buildIdealposOrderPayload(
        baseInput({
          items: [
            {
              menuItemId: 'a',
              menuItemTitle: 'A',
              quantity: 1.5,
              selectedModifiers: [],
              posProductCode: 'PLU-A',
            },
          ],
        }),
      ),
    ).toThrow(IdealposMappingError);
  });
});

describe('buildIdealposOrderPayload — per-seat assignment (Order Tablet screenshot flow)', () => {
  it('carries a positive integer seat through to the bridge line, preserving the assignment', () => {
    const payload = buildIdealposOrderPayload(
      baseInput({
        items: [
          {
            menuItemId: 'item-1',
            menuItemTitle: 'Lemon Slice',
            quantity: 1,
            selectedModifiers: [],
            posProductCode: 'PLU-LEMON',
            seat: 1,
          },
        ],
      }),
    );
    expect(payload.items[0]).toEqual({ productCode: 'PLU-LEMON', quantity: 1, seat: 1 });
  });

  it('acceptance: select Table 5 → add Lemon Slice → Send to Kitchen builds table=5, Lemon Slice, seat 1 (no IdealPOS call)', () => {
    const payload = buildIdealposOrderPayload(
      baseInput({
        externalOrderId: 'ORD-TABLE5-R1',
        tableCode: '5',
        items: [
          {
            menuItemId: 'lemon-slice',
            menuItemTitle: 'Lemon Slice',
            quantity: 1,
            selectedModifiers: [],
            posProductCode: 'PLU-LEMON',
            seat: 1,
          },
        ],
      }),
    );
    // This is the payload that maps 1:1 to the bridge's TableRound
    // (table="5", one line Lemon Slice seat 1). No HTTP/IdealPOS call happens
    // here — this mapper is pure.
    expect(payload).toEqual({
      externalOrderId: 'ORD-TABLE5-R1',
      table: '5',
      items: [{ productCode: 'PLU-LEMON', quantity: 1, seat: 1 }],
    });
  });

  it('omits seat entirely when none is assigned — never a seat:0 the native server would misread', () => {
    const payload = buildIdealposOrderPayload(baseInput());
    expect(payload.items[0]).not.toHaveProperty('seat');
  });

  it('treats a non-positive or non-integer seat as "no seat" rather than fabricating one', () => {
    const zero = buildIdealposOrderPayload(
      baseInput({
        items: [
          {
            menuItemId: 'a',
            menuItemTitle: 'A',
            quantity: 1,
            selectedModifiers: [],
            posProductCode: 'PLU-A',
            seat: 0,
          },
        ],
      }),
    );
    expect(zero.items[0]).not.toHaveProperty('seat');
  });
});
