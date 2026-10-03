import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  LocalStorageProvider,
  ObjectKeyOutsideRootError,
  resolveWithinRoot,
} from './local-storage.provider';
import { LocalMediaUploadController } from './local-media-upload.controller';
import { LocalMediaPublicController } from './local-media-public.controller';

// Story 2.3: the unauthenticated local upload emulation must not exist outside
// explicit development/test with the local provider, and even there must not
// escape its root or accept unbounded bodies.

function configWith(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function requestWith(
  chunks: Buffer[],
  headers: Record<string, string> = { 'content-type': 'image/jpeg' },
) {
  const stream = Readable.from(chunks) as Readable & { headers: Record<string, string> };
  stream.headers = headers;
  return stream;
}

describe('local media storage containment', () => {
  let base: string;
  let root: string;
  let publicRoot: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'servvia-media-containment-'));
    // The real layout: the public root is a sibling whose name extends the private root's.
    root = path.join(base, 'storage-assets');
    publicRoot = path.join(base, 'storage-assets-public');
    fs.mkdirSync(root);
    fs.mkdirSync(publicRoot);
  });

  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('accepts a nested key inside the root', () => {
    expect(resolveWithinRoot(root, 'venues/v1/a.jpg')).toBe(path.join(root, 'venues/v1/a.jpg'));
  });

  it.each([
    ['parent traversal', '../escape.txt'],
    [
      'sibling directory sharing the root prefix (the original defect)',
      '../storage-assets-public/evil.html',
    ],
    ['absolute path', '/etc/passwd'],
    ['the root itself', '.'],
    ['empty key', ''],
  ])('rejects %s', (_name, key) => {
    expect(() => resolveWithinRoot(root, key)).toThrow(ObjectKeyOutsideRootError);
  });

  it('writeLocal cannot write into the public sibling root', async () => {
    const provider = new LocalStorageProvider(root, publicRoot, 'http://localhost:3000', 'public');
    await expect(
      provider.writeLocal('../storage-assets-public/evil.html', Buffer.from('<script>')),
    ).rejects.toThrow(ObjectKeyOutsideRootError);
    expect(fs.existsSync(path.join(publicRoot, 'evil.html'))).toBe(false);
  });
});

describe('LocalMediaUploadController', () => {
  const dev = { NODE_ENV: 'development', MEDIA_MAX_FILE_SIZE_BYTES: 8 };
  const writeLocal = jest.fn().mockResolvedValue(undefined);
  const storage = { writeLocal } as unknown as LocalStorageProvider;
  const controller = (values: Record<string, unknown>) =>
    new LocalMediaUploadController(storage, configWith(values));

  beforeEach(() => writeLocal.mockClear());

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['an unset environment', { NODE_ENV: undefined }],
    [
      'development with the GCS provider active',
      { NODE_ENV: 'development', MEDIA_STORAGE_PROVIDER: 'gcs' },
    ],
  ])('does not exist (404) in %s, before reading the body', async (_name, values) => {
    const req = requestWith([Buffer.from('x')]);
    const read = jest.spyOn(req, 'on');
    await expect(controller(values).upload('k.jpg', req as never)).rejects.toThrow(
      NotFoundException,
    );
    expect(read).not.toHaveBeenCalled();
    expect(writeLocal).not.toHaveBeenCalled();
  });

  it('writes a body within the limit in development', async () => {
    await expect(
      controller(dev).upload(
        encodeURIComponent('venues/v1/a.jpg'),
        requestWith([Buffer.from('12345678')]) as never,
      ),
    ).resolves.toEqual({ objectKey: 'venues/v1/a.jpg' });
    expect(writeLocal).toHaveBeenCalledWith('venues/v1/a.jpg', Buffer.from('12345678'));
  });

  it('refuses a declared oversize body (413) without writing', async () => {
    const req = requestWith([Buffer.from('x')], {
      'content-type': 'image/jpeg',
      'content-length': '9',
    });
    await expect(controller(dev).upload('a.jpg', req as never)).rejects.toThrow(
      PayloadTooLargeException,
    );
    expect(writeLocal).not.toHaveBeenCalled();
  });

  it('refuses an oversize body with no Content-Length (413) without writing', async () => {
    const req = requestWith([Buffer.from('12345'), Buffer.from('6789')]);
    await expect(controller(dev).upload('a.jpg', req as never)).rejects.toThrow(
      PayloadTooLargeException,
    );
    expect(writeLocal).not.toHaveBeenCalled();
  });

  it.each([
    ['no Content-Type', {}],
    [
      'a form-encoded body (consumed by a body parser, so it would be stored empty)',
      { 'content-type': 'application/x-www-form-urlencoded' },
    ],
    ['a non-media type', { 'content-type': 'text/html' }],
  ])('refuses %s (415) without writing', async (_name, headers) => {
    await expect(
      controller(dev).upload('a.jpg', requestWith([Buffer.from('x')], headers) as never),
    ).rejects.toThrow(UnsupportedMediaTypeException);
    expect(writeLocal).not.toHaveBeenCalled();
  });

  it('refuses a malformed key encoding (400)', async () => {
    await expect(controller(dev).upload('%E0%A4%A', requestWith([]) as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a traversal key (400) and writes nothing', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'servvia-upload-traversal-'));
    try {
      const root = path.join(base, 'storage-assets');
      const publicRoot = path.join(base, 'storage-assets-public');
      const real = new LocalStorageProvider(root, publicRoot, 'http://localhost:3000', 'public');
      const ctl = new LocalMediaUploadController(real, configWith(dev));
      await expect(
        ctl.upload(
          encodeURIComponent('../storage-assets-public/evil.html'),
          requestWith([Buffer.from('x')]) as never,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(fs.existsSync(path.join(publicRoot, 'evil.html'))).toBe(false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('LocalMediaPublicController', () => {
  const readPublic = jest.fn();
  const storage = { readPublic } as unknown as LocalStorageProvider;

  it('does not exist (404) in production or with an unset environment', async () => {
    for (const env of ['production', undefined]) {
      const ctl = new LocalMediaPublicController(storage, configWith({ NODE_ENV: env }));
      await expect(ctl.get('a.jpg', {} as never)).rejects.toThrow(NotFoundException);
    }
    expect(readPublic).not.toHaveBeenCalled();
  });

  it('answers 404 for a key outside the public root', async () => {
    readPublic.mockRejectedValueOnce(new ObjectKeyOutsideRootError());
    const ctl = new LocalMediaPublicController(storage, configWith({ NODE_ENV: 'development' }));
    await expect(
      ctl.get(encodeURIComponent('../storage-assets/secret.jpg'), {} as never),
    ).rejects.toThrow(NotFoundException);
  });
});
