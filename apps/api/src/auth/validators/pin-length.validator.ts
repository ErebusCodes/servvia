import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * PIN length floor for venue-scoped device PINs (KDS terminal auth, Order
 * Tablet unlock). Production always requires 4-16 characters. A narrow,
 * explicitly-tested localhost/development accommodation additionally
 * permits the repository's single canonical local-dev PIN length of 3
 * (matching `INSECURE_DEFAULT_PIN`, see insecure-default-pin.util.ts) when
 * `NODE_ENV !== 'production'`. The floor is re-evaluated per validation
 * call against the live `process.env.NODE_ENV`, so it can never be baked
 * into a running production process — see pin-length.validator.spec.ts,
 * which asserts a 3-character PIN is rejected whenever NODE_ENV is
 * 'production', regardless of this decorator's dev branch.
 */
export function IsPinLength(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPinLength',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const minLength = process.env.NODE_ENV === 'production' ? 4 : 3;
          return value.length >= minLength && value.length <= 16;
        },
        defaultMessage() {
          return 'pin must be between 4 and 16 characters';
        },
      },
    });
  };
}
