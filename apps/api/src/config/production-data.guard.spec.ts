import { productionDataViolations } from './production-data.guard';

describe('productionDataViolations', () => {
  const prismaWith = (count: number) => {
    const calls: unknown[] = [];
    return {
      calls,
      printer: {
        count: (args: unknown) => {
          calls.push(args);
          return Promise.resolve(count);
        },
      },
    };
  };

  it('refuses production while an active simulated printer exists', async () => {
    const prisma = prismaWith(2);
    const violations = await productionDataViolations(prisma, 'production');
    expect(violations).toEqual([
      expect.stringMatching(/2 active printer\(s\) use the development-only "simulated"/),
    ]);
    expect(prisma.calls).toEqual([{ where: { connectionType: 'simulated', isActive: true } }]);
  });

  it('treats an unset environment as production (fail closed)', async () => {
    expect(await productionDataViolations(prismaWith(1), undefined)).toHaveLength(1);
  });

  it('passes production without simulated printers', async () => {
    expect(await productionDataViolations(prismaWith(0), 'production')).toEqual([]);
  });

  it('does not query outside production', async () => {
    const prisma = prismaWith(5);
    expect(await productionDataViolations(prisma, 'development')).toEqual([]);
    expect(prisma.calls).toHaveLength(0);
  });
});
