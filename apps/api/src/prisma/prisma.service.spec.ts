import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService, withUtcSession } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should expose PrismaClient methods', () => {
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
  });
});

describe('withUtcSession', () => {
  it('pins a plain URL to UTC', () => {
    expect(withUtcSession('postgresql://u@127.0.0.1:5432/db')).toBe(
      'postgresql://u@127.0.0.1:5432/db?options=-c%20TimeZone%3DUTC',
    );
  });

  it('keeps other parameters', () => {
    expect(withUtcSession('postgresql://u@h/db?schema=public&connection_limit=5')).toBe(
      'postgresql://u@h/db?schema=public&connection_limit=5&options=-c%20TimeZone%3DUTC',
    );
  });

  it('adds to existing options and leaves an explicit TimeZone alone', () => {
    expect(withUtcSession('postgresql://u@h/db?options=-c%20statement_timeout%3D5000')).toBe(
      'postgresql://u@h/db?options=-c%20statement_timeout%3D5000%20-c%20TimeZone%3DUTC',
    );
    const explicit = 'postgresql://u@h/db?options=-c%20TimeZone%3DPacific%2FAuckland';
    expect(withUtcSession(explicit)).toBe(explicit);
  });

  it('passes an absent or unparseable URL through', () => {
    expect(withUtcSession(undefined)).toBeUndefined();
    expect(withUtcSession('not a url')).toBe('not a url');
  });
});
