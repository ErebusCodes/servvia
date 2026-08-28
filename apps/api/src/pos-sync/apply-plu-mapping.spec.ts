import { planPluMapping, applyPluMapping, ApplyPluMappingInput } from './apply-plu-mapping';

const STAGING_CATEGORY_NAME = 'Imported from IdealPOS (pending review)';

function curatedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'curated-1',
    title: 'Tiramisu',
    organizationId: 'org-1',
    posProductCode: null,
    isAvailable: true,
    category: { name: 'Desserts' },
    ...overrides,
  };
}

function stagingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staging-1',
    title: 'TIRAMISU',
    organizationId: 'org-1',
    posProductCode: '578',
    isAvailable: false,
    category: { name: STAGING_CATEGORY_NAME },
    ...overrides,
  };
}

const input: ApplyPluMappingInput = {
  curatedMenuItemId: 'curated-1',
  stagingMenuItemId: 'staging-1',
  posProductCode: '578',
  expectedStagingTitle: 'TIRAMISU',
};

function mockPrisma(
  overrides: {
    curated?: ReturnType<typeof curatedRow> | null;
    staging?: ReturnType<typeof stagingRow> | null;
    thirdOwner?: unknown;
  } = {},
) {
  const curated = overrides.curated === undefined ? curatedRow() : overrides.curated;
  const staging = overrides.staging === undefined ? stagingRow() : overrides.staging;

  const findFirst = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    if (where.id === 'curated-1') return Promise.resolve(curated);
    if (where.id === 'staging-1') return Promise.resolve(staging);
    return Promise.resolve(overrides.thirdOwner ?? null);
  });

  const updateMany = jest.fn().mockResolvedValue({ count: 1 });

  const prisma: any = {
    menuItem: {
      findFirst,
      updateMany,
      findUnique: jest.fn().mockResolvedValue(curated),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(prisma);
    }),
  };
  return { prisma, updateMany };
}

describe('planPluMapping', () => {
  it('reports no failures when every precondition is satisfied', async () => {
    const { prisma } = mockPrisma();
    const plan = await planPluMapping(prisma, input);
    expect(plan.failures).toEqual([]);
    expect(plan.curatedTitle).toBe('Tiramisu');
    expect(plan.stagingTitle).toBe('TIRAMISU');
  });

  it('fails closed when the curated row already has a posProductCode', async () => {
    const { prisma } = mockPrisma({ curated: curatedRow({ posProductCode: '999' }) });
    const plan = await planPluMapping(prisma, input);
    expect(plan.failures).toEqual([
      expect.stringContaining('curated row already has posProductCode'),
    ]);
  });

  it('fails closed when the staging row posProductCode does not match', async () => {
    const { prisma } = mockPrisma({ staging: stagingRow({ posProductCode: '111' }) });
    const plan = await planPluMapping(prisma, input);
    expect(plan.failures).toEqual([expect.stringContaining('staging row posProductCode')]);
  });

  it('fails closed when the staging row is not in the import staging category', async () => {
    const { prisma } = mockPrisma({ staging: stagingRow({ category: { name: 'Desserts' } }) });
    const plan = await planPluMapping(prisma, input);
    expect(plan.failures).toEqual([expect.stringContaining('staging row category')]);
  });

  it('fails closed when the staging row is available (would mean it is not actually staging data)', async () => {
    const { prisma } = mockPrisma({ staging: stagingRow({ isAvailable: true }) });
    const plan = await planPluMapping(prisma, input);
    expect(plan.failures).toEqual([expect.stringContaining('isAvailable')]);
  });

  it('fails closed when the staging row title does not match the expected title', async () => {
    const { prisma } = mockPrisma({ staging: stagingRow({ title: 'Something Else' }) });
    const plan = await planPluMapping(prisma, input);
    expect(plan.failures).toEqual([expect.stringContaining('staging row title')]);
  });

  it('fails closed when a third menu item already holds the code', async () => {
    const { prisma } = mockPrisma({ thirdOwner: { id: 'third-1', title: 'Someone Else' } });
    const plan = await planPluMapping(prisma, input);
    expect(plan.failures).toEqual([expect.stringContaining('a third MenuItem')]);
  });

  it('throws if the curated row does not exist', async () => {
    const { prisma } = mockPrisma({ curated: null });
    await expect(planPluMapping(prisma, input)).rejects.toThrow(
      'Curated MenuItem curated-1 not found',
    );
  });
});

describe('applyPluMapping', () => {
  it('writes both halves of the mapping inside one transaction when preconditions pass', async () => {
    const { prisma, updateMany } = mockPrisma();
    await applyPluMapping(prisma, input);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('never calls the transaction when preconditions fail', async () => {
    const { prisma } = mockPrisma({ curated: curatedRow({ posProductCode: '999' }) });
    await expect(applyPluMapping(prisma, input)).rejects.toThrow('Preconditions failed');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
