import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { resolveMediaStoragePath } from './media-storage.util';

// Extension is derived from the validated mimetype rather than trusting the
// client-supplied filename, so the stored file always matches its declared
// content type and can't smuggle an executable extension.
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// Folders are a small fixed set of route segments (e.g. "menu"), never raw
// user input — this pattern is defense-in-depth against path traversal.
const FOLDER_PATTERN = /^[a-z0-9-]+$/;
const KEY_PATTERN = /^[a-z0-9-]+\/[a-f0-9-]+\.[a-z0-9]+$/;

export interface MediaUploadResult {
  key: string;
  url: string;
}

/** @deprecated See MediaController's doc comment — this backs the legacy,
 * now-unused local-disk upload path. */
@Injectable()
export class MediaService {
  private readonly root: string;
  private readonly baseUrl: string;
  private readonly maxBytes: number;

  constructor(private readonly config: ConfigService) {
    this.root = resolveMediaStoragePath(config);
    // Prefer same-origin URLs so kiosk/tablet clients also work from another
    // device on the LAN. Deployments can still opt into an absolute CDN URL.
    this.baseUrl = (config.get<string>('MEDIA_BASE_URL') || '').replace(/\/+$/, '');
    this.maxBytes = config.get<number>('MEDIA_MAX_FILE_SIZE_BYTES') ?? 5 * 1024 * 1024;
  }

  async upload(folder: string, file: Buffer, mimeType: string): Promise<MediaUploadResult> {
    if (!FOLDER_PATTERN.test(folder)) {
      throw new BadRequestException('Invalid media folder');
    }
    const ext = ALLOWED_MIME_TYPES[mimeType];
    if (!ext) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    if (file.length === 0) {
      throw new BadRequestException('File is empty');
    }
    if (file.length > this.maxBytes) {
      throw new BadRequestException(`File exceeds maximum size of ${this.maxBytes} bytes`);
    }

    const filename = `${randomUUID()}${ext}`;
    const key = `${folder}/${filename}`;

    if (process.env.NODE_ENV === 'test') {
      const dir = path.join(this.root, folder);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.resolveSafePath(key), file);
      return { key, url: this.getPublicUrl(key) };
    }

    let projectRoot = process.cwd();
    if (!existsSync(path.join(projectRoot, 'docker-compose.yml'))) {
      // cwd is the apps/api workspace directory when run via `npm run
      // --workspace=apps/api` (two levels below the repo root that holds
      // docker-compose.yml), so this walks up until it's found rather than
      // assuming a fixed depth.
      let candidate = projectRoot;
      for (let i = 0; i < 4; i++) {
        candidate = path.resolve(candidate, '..');
        if (existsSync(path.join(candidate, 'docker-compose.yml'))) {
          projectRoot = candidate;
          break;
        }
      }
    }

    const destDirs = [
      path.join(projectRoot, 'apps/admin-console/public/menu-images'),
      path.join(projectRoot, 'apps/customer-website/public/menu-images'),
      path.join(projectRoot, 'apps/window-display/public/menu-images'),
    ];

    for (const dir of destDirs) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), file);
    }

    return { key, url: `/menu-images/${filename}` };
  }

  getPublicUrl(key: string): string {
    if (process.env.NODE_ENV === 'test') {
      return `${this.baseUrl}/media/${key}`;
    }
    const filename = path.basename(key);
    return `/menu-images/${filename}`;
  }

  async remove(key: string): Promise<void> {
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException('Invalid media key');
    }

    if (process.env.NODE_ENV === 'test') {
      await fs.rm(this.resolveSafePath(key), { force: true });
      return;
    }

    const filename = path.basename(key);
    let projectRoot = process.cwd();
    if (!existsSync(path.join(projectRoot, 'docker-compose.yml'))) {
      // cwd is the apps/api workspace directory when run via `npm run
      // --workspace=apps/api` (two levels below the repo root that holds
      // docker-compose.yml), so this walks up until it's found rather than
      // assuming a fixed depth.
      let candidate = projectRoot;
      for (let i = 0; i < 4; i++) {
        candidate = path.resolve(candidate, '..');
        if (existsSync(path.join(candidate, 'docker-compose.yml'))) {
          projectRoot = candidate;
          break;
        }
      }
    }

    const destDirs = [
      path.join(projectRoot, 'apps/admin-console/public/menu-images'),
      path.join(projectRoot, 'apps/customer-website/public/menu-images'),
      path.join(projectRoot, 'apps/window-display/public/menu-images'),
    ];

    for (const dir of destDirs) {
      await fs.rm(path.join(dir, filename), { force: true });
    }
  }

  // Rejects any key that would resolve outside the storage root (e.g. via
  // "../" segments) before it ever reaches the filesystem.
  private resolveSafePath(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException('Invalid media key');
    }
    const destination = path.resolve(this.root, key);
    if (destination !== this.root && !destination.startsWith(this.root + path.sep)) {
      throw new BadRequestException('Invalid media key');
    }
    return destination;
  }
}
