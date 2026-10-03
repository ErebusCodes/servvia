/**
 * Runtime-environment checks, fail closed.
 *
 * Development and test behaviour (fixture routes, simulated printers,
 * 3-digit PINs, the checked-in default PIN and secrets, Table 19 validation
 * mode, the local upload emulation) is allowed only when NODE_ENV is exactly
 * `development` or `test`. Every other value, including an unset or
 * misspelt NODE_ENV, gets production behaviour. NODE_ENV is also required at
 * startup (environment.validation.ts), so this is a second line of defence,
 * not the only one.
 */
export const NON_PRODUCTION_ENVIRONMENTS: readonly string[] = ['development', 'test'];

// Called with no argument, these read process.env.NODE_ENV. Called with an
// argument (for example ConfigService.get('NODE_ENV')), they use it as given:
// an explicit `undefined` means unset, and so production. A default
// parameter would silently swap an explicit `undefined` for process.env.

export function isNonProductionRuntime(...args: [nodeEnv?: string]): boolean {
  const nodeEnv = args.length > 0 ? args[0] : process.env.NODE_ENV;
  return nodeEnv !== undefined && NON_PRODUCTION_ENVIRONMENTS.includes(nodeEnv);
}

export function isProductionRuntime(...args: [nodeEnv?: string]): boolean {
  return !isNonProductionRuntime(...args);
}
