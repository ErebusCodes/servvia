import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsString } from 'class-validator';
import { IsPinLength } from './pin-length.validator';

class TestPinDto {
  @IsString()
  @IsPinLength()
  pin!: string;
}

async function validatePin(pin: string): Promise<boolean> {
  const instance = plainToInstance(TestPinDto, { pin });
  const errors = await validate(instance);
  return errors.length === 0;
}

describe('IsPinLength', () => {
  const previousEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previousEnv;
  });

  describe('non-production (local development / test)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('accepts a 3-character PIN (the repository-wide local-dev default, "108")', async () => {
      await expect(validatePin('108')).resolves.toBe(true);
    });

    it('still accepts a 4-16 character PIN', async () => {
      await expect(validatePin('1088')).resolves.toBe(true);
      await expect(validatePin('1234567890123456')).resolves.toBe(true);
    });

    it('still rejects a 2-character PIN', async () => {
      await expect(validatePin('10')).resolves.toBe(false);
    });

    it('still rejects a 17-character PIN', async () => {
      await expect(validatePin('12345678901234567')).resolves.toBe(false);
    });
  });

  describe('production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('rejects a 3-character PIN — the development accommodation never applies in production', async () => {
      await expect(validatePin('108')).resolves.toBe(false);
    });

    it('still accepts a 4-16 character PIN, unchanged from before this accommodation existed', async () => {
      await expect(validatePin('1088')).resolves.toBe(true);
    });
  });
});
