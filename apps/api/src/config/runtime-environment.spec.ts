import { isNonProductionRuntime, isProductionRuntime } from './runtime-environment';

// Fail closed: only an explicit development/test environment is non-production.
describe('runtime environment', () => {
  it.each(['development', 'test'])('%s is non-production', (env) => {
    expect(isNonProductionRuntime(env)).toBe(true);
    expect(isProductionRuntime(env)).toBe(false);
  });

  it.each([['production'], [undefined], [''], ['prod'], ['Development'], ['staging']])(
    '%p gets production behaviour',
    (env) => {
      expect(isProductionRuntime(env)).toBe(true);
    },
  );
});
