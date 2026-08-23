import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaService } from './media.service';

describe('MediaService', () => {
  let service: MediaService;
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'verdura-media-test-'));
    process.env.MEDIA_STORAGE_PATH = storageRoot;
    process.env.MEDIA_BASE_URL = 'http://localhost:3000';
    process.env.PORT = '3000';

    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [MediaService],
    }).compile();

    service = module.get<MediaService>(MediaService);
  });

  afterEach(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true });
    delete process.env.MEDIA_STORAGE_PATH;
    delete process.env.MEDIA_BASE_URL;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upload()', () => {
    it('writes the file under the configured storage root', async () => {
      const { key } = await service.upload('menu', Buffer.from('fake-image-bytes'), 'image/jpeg');
      expect(key).toMatch(/^menu\/[a-f0-9-]+\.jpg$/);
      const written = await fs.readFile(path.join(storageRoot, key));
      expect(written.toString()).toBe('fake-image-bytes');
    });

    it('returns a URL built from MEDIA_BASE_URL and the storage key', async () => {
      const { key, url } = await service.upload('menu', Buffer.from('x'), 'image/png');
      expect(url).toBe(`http://localhost:3000/media/${key}`);
    });

    it('generates a unique filename per upload', async () => {
      const a = await service.upload('menu', Buffer.from('x'), 'image/png');
      const b = await service.upload('menu', Buffer.from('x'), 'image/png');
      expect(a.key).not.toBe(b.key);
    });

    it('rejects unsupported mime types', async () => {
      await expect(service.upload('menu', Buffer.from('<script>'), 'text/html')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects empty files', async () => {
      await expect(service.upload('menu', Buffer.alloc(0), 'image/jpeg')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects files over the configured size limit', async () => {
      process.env.MEDIA_MAX_FILE_SIZE_BYTES = '10';
      const module: TestingModule = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
        providers: [MediaService],
      }).compile();
      const limited = module.get<MediaService>(MediaService);

      await expect(
        limited.upload('menu', Buffer.from('this-buffer-is-longer-than-ten-bytes'), 'image/jpeg'),
      ).rejects.toThrow(BadRequestException);
      delete process.env.MEDIA_MAX_FILE_SIZE_BYTES;
    });

    it('rejects a folder containing path traversal segments', async () => {
      await expect(service.upload('../../etc', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getPublicUrl()', () => {
    it('returns a URL containing the given key', () => {
      const url = service.getPublicUrl('menu/item-abc.webp');
      expect(url).toBe('http://localhost:3000/media/menu/item-abc.webp');
    });
  });

  describe('remove()', () => {
    it('deletes a previously uploaded file', async () => {
      const { key } = await service.upload('menu', Buffer.from('x'), 'image/jpeg');
      const filePath = path.join(storageRoot, key);
      expect(fsSync.existsSync(filePath)).toBe(true);

      await service.remove(key);
      expect(fsSync.existsSync(filePath)).toBe(false);
    });

    it('does not throw when removing a key that does not exist', async () => {
      await expect(
        service.remove('menu/11111111-1111-1111-1111-111111111111.jpg'),
      ).resolves.toBeUndefined();
    });

    it('rejects a key that attempts to escape the storage root', async () => {
      await expect(service.remove('../../etc/passwd')).rejects.toThrow(BadRequestException);
    });
  });
});
