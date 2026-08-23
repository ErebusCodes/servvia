import { AppModule, configValidationSchema } from './app.module';

describe('AppModule', () => {
  it('should be defined', () => {
    expect(AppModule).toBeDefined();
  });

  describe('configValidationSchema', () => {
    const validBaseConfig = {
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: 'postgresql://localhost:5432/db',
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    };

    it('should validate a valid configuration', () => {
      const config = {
        ...validBaseConfig,
        INTERNAL_SERVICE_TOKEN: 'c'.repeat(32),
      };
      const result = configValidationSchema.validate(config);
      expect(result.error).toBeUndefined();
      const value = result.value as { INTERNAL_SERVICE_TOKEN: string };
      expect(value.INTERNAL_SERVICE_TOKEN).toBe('c'.repeat(32));
    });

    it('should throw an error if INTERNAL_SERVICE_TOKEN is absent', () => {
      const config = {
        ...validBaseConfig,
      };
      const result = configValidationSchema.validate(config);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('"INTERNAL_SERVICE_TOKEN" is required');
    });

    it('should throw an error if INTERNAL_SERVICE_TOKEN is less than 32 characters', () => {
      const config = {
        ...validBaseConfig,
        INTERNAL_SERVICE_TOKEN: 'short-token',
      };
      const result = configValidationSchema.validate(config);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain(
        '"INTERNAL_SERVICE_TOKEN" length must be at least 32 characters long',
      );
    });
  });
});
