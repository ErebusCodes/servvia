// Sets environment variables required by Joi validation in ConfigModule
// so that tests importing AppModule don't crash on startup.
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars!';
process.env.JWT_REFRESH_EXPIRY = '7d';
