/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MediaAssetsService } from './media-assets.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { STORAGE_PROVIDER_PORT, StorageProviderPort } from './providers/storage-provider.port';
import { StaffRole } from '@prisma/client';

const mockPrisma: any = {
  venue: { findFirst: jest.fn() },
  mediaAsset: {
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  menuItem: {
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};

const mockAudit = { logAuthEvent: jest.fn() };

const mockStorage: jest.Mocked<StorageProviderPort> = {
  generateSignedUploadUrl: jest.fn(),
  verifyObject: jest.fn(),
  generateDeliveryUrl: jest.fn(),
  publishObject: jest.fn(),
  deleteObject: jest.fn(),
};

const PUBLIC_BUCKET = 'verdura-media-public-test';

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'GCS_MEDIA_BUCKET') return 'verdura-media-test';
    if (key === 'GCS_MEDIA_PUBLIC_BUCKET') return PUBLIC_BUCKET;
    if (key === 'GCS_SIGNED_URL_TTL_SECONDS') return 900;
    return undefined;
  }),
};

const orgId = 'org-1';
const venueId = 'venue-1';
const actor = { id: 'staff-1', email: 'owner@verdura.co.nz', role: StaffRole.admin };

const baseDto = {
  venueId,
  purpose: 'menu_item' as const,
  originalFilename: 'Tiramisu.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  checksum: 'a'.repeat(64),
};

describe('MediaAssetsService', () => {
  let service: MediaAssetsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaAssetsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: ConfigService, useValue: mockConfig },
        { provide: STORAGE_PROVIDER_PORT, useValue: mockStorage },
      ],
    }).compile();
    service = module.get<MediaAssetsService>(MediaAssetsService);
  });

  describe('requestUpload()', () => {
    it('rejects a venue that does not belong to the caller organization', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);
      await expect(service.requestUpload(orgId, actor, baseDto)).rejects.toThrow(
        ForbiddenException,
      );
      // Confirms the lookup is scoped by BOTH id and organizationId, not id alone.
      expect(mockPrisma.venue.findFirst).toHaveBeenCalledWith({
        where: { id: venueId, organizationId: orgId },
      });
    });

    it('rejects an unsupported MIME type', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: venueId });
      await expect(
        service.requestUpload(orgId, actor, { ...baseDto, mimeType: 'application/pdf' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a file over the size limit for its media type', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: venueId });
      await expect(
        service.requestUpload(orgId, actor, { ...baseDto, sizeBytes: 999 * 1024 * 1024 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reuses an existing approved asset with the same venue/purpose/checksum/provider instead of uploading a duplicate', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: venueId });
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({ id: 'existing-asset-id' });

      const result = await service.requestUpload(orgId, actor, baseDto);

      expect(result).toEqual({ mediaAssetId: 'existing-asset-id', reused: true });
      expect(mockPrisma.mediaAsset.create).not.toHaveBeenCalled();
      expect(mockStorage.generateSignedUploadUrl).not.toHaveBeenCalled();
      // The dedup lookup must be scoped to the provider actually active on
      // this process — reusing a row whose bytes live under a different
      // provider produces a delivery URL nothing was ever uploaded to.
      // Real defect found via browser validation (2026-08-18): a checksum
      // match against a real GCS-migrated asset was reused while running
      // MEDIA_STORAGE_PROVIDER=local, producing a 404 on the resulting
      // delivery URL.
      expect(mockPrisma.mediaAsset.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ storageProvider: 'local' }),
      });
    });

    it('does NOT reuse an approved asset whose bytes live under a different storage provider than the one currently active', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: venueId });
      // Simulate the real scenario: no row matches when the dedup query is
      // correctly scoped by storageProvider (a real mock DB would filter
      // out a gcs-originated row when queried with storageProvider:'local'
      // — this test proves the query is actually scoped, not merely that
      // an unscoped mock happens to return null).
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(null);
      mockPrisma.mediaAsset.create.mockImplementation(({ data }: any) => Promise.resolve(data));
      mockStorage.generateSignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://storage.googleapis.com/signed-put',
        bucket: 'verdura-media-test',
        objectKey: 'ignored',
        expiresAt: new Date('2026-01-01T00:15:00Z'),
        requiredHeaders: { 'Content-Type': 'image/jpeg' },
      });

      const result = await service.requestUpload(orgId, actor, baseDto);

      expect(result.reused).toBe(false);
      expect(mockPrisma.mediaAsset.create).toHaveBeenCalledTimes(1);
      const created = mockPrisma.mediaAsset.create.mock.calls[0][0].data;
      expect(created.storageProvider).toBe('local');
    });

    it('creates a pending_upload asset and returns a signed URL when no duplicate exists', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: venueId });
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(null);
      mockPrisma.mediaAsset.create.mockImplementation(({ data }: any) => Promise.resolve(data));
      mockStorage.generateSignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://storage.googleapis.com/signed-put',
        bucket: 'verdura-media-test',
        objectKey: 'ignored',
        expiresAt: new Date('2026-01-01T00:15:00Z'),
        requiredHeaders: { 'Content-Type': 'image/jpeg' },
      });

      const result = await service.requestUpload(orgId, actor, baseDto);

      expect(result.reused).toBe(false);
      expect(result.uploadUrl).toBe('https://storage.googleapis.com/signed-put');
      expect(mockPrisma.mediaAsset.create).toHaveBeenCalledTimes(1);
      const created = mockPrisma.mediaAsset.create.mock.calls[0][0].data;
      expect(created.status).toBe('pending_upload');
      expect(created.venueId).toBe(venueId);
      // Never lets the client choose the object key — server-derived only.
      expect(created.objectKey).toMatch(
        new RegExp(`^venues/${venueId}/menu-items/.+/original/tiramisu\\.jpg$`),
      );
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'media_asset.upload_requested', resourceId: created.id }),
      );
    });
  });

  describe('finalizeUpload()', () => {
    const pendingAsset = {
      id: 'asset-1',
      organizationId: orgId,
      venueId,
      bucket: 'verdura-media-test',
      objectKey: 'venues/venue-1/menu-items/asset-1/original/tiramisu.jpg',
      sizeBytes: 1024,
      checksum: 'a'.repeat(64),
      status: 'pending_upload',
    };

    it('is idempotent: an already-finalized asset is returned unchanged without re-verifying', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({ ...pendingAsset, status: 'approved' });

      const result = await service.finalizeUpload(orgId, 'asset-1', actor);

      expect(result.status).toBe('approved');
      expect(mockStorage.verifyObject).not.toHaveBeenCalled();
      expect(mockPrisma.mediaAsset.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an asset outside the caller organization', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(null);
      await expect(service.finalizeUpload(orgId, 'asset-1', actor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('marks the asset failed if the object never actually landed in the bucket', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(pendingAsset);
      mockStorage.verifyObject.mockResolvedValue({ exists: false });
      mockPrisma.mediaAsset.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...pendingAsset, ...data }),
      );

      const result = await service.finalizeUpload(orgId, 'asset-1', actor);

      expect(result.status).toBe('failed');
      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
    });

    it('rejects and deletes the object on checksum mismatch', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(pendingAsset);
      mockStorage.verifyObject.mockResolvedValue({
        exists: true,
        sizeBytes: 1024,
        declaredChecksum: 'b'.repeat(64), // does not match pendingAsset.checksum
      });
      mockPrisma.mediaAsset.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...pendingAsset, ...data }),
      );

      const result = await service.finalizeUpload(orgId, 'asset-1', actor);

      expect(result.status).toBe('rejected');
      expect(mockStorage.deleteObject).toHaveBeenCalledWith({
        bucket: pendingAsset.bucket,
        objectKey: pendingAsset.objectKey,
      });
    });

    it('rejects on size mismatch even when the checksum matches', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(pendingAsset);
      mockStorage.verifyObject.mockResolvedValue({
        exists: true,
        sizeBytes: 999,
        declaredChecksum: pendingAsset.checksum,
      });
      mockPrisma.mediaAsset.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...pendingAsset, ...data }),
      );

      const result = await service.finalizeUpload(orgId, 'asset-1', actor);

      expect(result.status).toBe('rejected');
    });

    it('approves when size and checksum both match', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(pendingAsset);
      mockStorage.verifyObject.mockResolvedValue({
        exists: true,
        sizeBytes: 1024,
        declaredChecksum: pendingAsset.checksum,
      });
      mockPrisma.mediaAsset.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...pendingAsset, ...data }),
      );

      const result = await service.finalizeUpload(orgId, 'asset-1', actor);

      expect(result.status).toBe('approved');
      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'media_asset.approved' }),
      );
    });
  });

  describe('getDeliveryUrl()', () => {
    it('refuses to resolve a delivery URL for anything but an approved asset', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        id: 'asset-1',
        status: 'pending_upload',
      });
      await expect(service.getDeliveryUrl(orgId, 'asset-1')).rejects.toThrow(BadRequestException);
      expect(mockStorage.generateDeliveryUrl).not.toHaveBeenCalled();
    });

    it('resolves a delivery URL for an approved asset', async () => {
      const approved = {
        id: 'asset-1',
        status: 'approved',
        bucket: 'verdura-media-test',
        objectKey: 'venues/venue-1/menu-items/asset-1/original/tiramisu.jpg',
        visibility: 'private',
      };
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(approved);
      mockStorage.generateDeliveryUrl.mockResolvedValue('https://signed-get-url');

      const result = await service.getDeliveryUrl(orgId, 'asset-1');

      expect(result.url).toBe('https://signed-get-url');
      expect(mockStorage.generateDeliveryUrl).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: 'verdura-media-test' }),
      );
    });

    it('resolves against the PUBLIC bucket, not the private asset.bucket column, once visibility is public', async () => {
      const published = {
        id: 'asset-1',
        status: 'approved',
        bucket: 'verdura-media-test', // private original bucket — never overwritten
        objectKey: 'venues/venue-1/menu-items/asset-1/original/tiramisu.jpg',
        visibility: 'public',
      };
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(published);
      mockStorage.generateDeliveryUrl.mockResolvedValue(
        'https://storage.googleapis.com/public/tiramisu.jpg',
      );

      await service.getDeliveryUrl(orgId, 'asset-1');

      expect(mockStorage.generateDeliveryUrl).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: PUBLIC_BUCKET, visibility: 'public' }),
      );
    });
  });

  describe('publishAsset()', () => {
    const approvedAsset = {
      id: 'asset-1',
      organizationId: orgId,
      venueId,
      bucket: 'verdura-media-test',
      objectKey: 'venues/venue-1/menu-items/asset-1/original/tiramisu.jpg',
      mimeType: 'image/jpeg',
      checksum: 'a'.repeat(64),
      status: 'approved',
      visibility: 'private',
    };

    it('throws NotFoundException for an asset outside the caller organization', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(null);
      await expect(service.publishAsset(orgId, 'asset-1', actor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to publish an asset that is not yet approved', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({ ...approvedAsset, status: 'validating' });
      await expect(service.publishAsset(orgId, 'asset-1', actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorage.publishObject).not.toHaveBeenCalled();
    });

    it('is idempotent: an already-public asset is returned unchanged without re-copying', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({ ...approvedAsset, visibility: 'public' });

      const result = await service.publishAsset(orgId, 'asset-1', actor);

      expect(result.visibility).toBe('public');
      expect(mockStorage.publishObject).not.toHaveBeenCalled();
      expect(mockPrisma.mediaAsset.updateMany).not.toHaveBeenCalled();
    });

    it('copies to the public bucket, verifies the copy, and flips visibility to public', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(approvedAsset);
      mockStorage.verifyObject.mockResolvedValue({
        exists: true,
        declaredChecksum: approvedAsset.checksum,
      });
      mockPrisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.mediaAsset.findFirstOrThrow.mockResolvedValue({
        ...approvedAsset,
        visibility: 'public',
      });

      const result = await service.publishAsset(orgId, 'asset-1', actor);

      expect(mockStorage.publishObject).toHaveBeenCalledWith({
        sourceBucket: approvedAsset.bucket,
        destinationBucket: PUBLIC_BUCKET,
        objectKey: approvedAsset.objectKey,
        contentType: approvedAsset.mimeType,
        checksum: approvedAsset.checksum,
      });
      expect(mockStorage.verifyObject).toHaveBeenCalledWith({
        bucket: PUBLIC_BUCKET,
        objectKey: approvedAsset.objectKey,
      });
      expect(mockPrisma.mediaAsset.updateMany).toHaveBeenCalledWith({
        where: { id: 'asset-1', visibility: 'private' },
        data: { visibility: 'public' },
      });
      expect(result.visibility).toBe('public');
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'media_asset.published' }),
      );
    });

    it('never flips visibility if the post-copy verification fails', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(approvedAsset);
      mockStorage.verifyObject.mockResolvedValue({
        exists: true,
        declaredChecksum: 'wrong-checksum',
      });

      await expect(service.publishAsset(orgId, 'asset-1', actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.mediaAsset.updateMany).not.toHaveBeenCalled();
    });

    it('does not double-log when a concurrent caller already won the compare-and-set', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(approvedAsset);
      mockStorage.verifyObject.mockResolvedValue({
        exists: true,
        declaredChecksum: approvedAsset.checksum,
      });
      // count: 0 — another concurrent request already flipped visibility first.
      mockPrisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.mediaAsset.findFirstOrThrow.mockResolvedValue({
        ...approvedAsset,
        visibility: 'public',
      });

      const result = await service.publishAsset(orgId, 'asset-1', actor);

      expect(result.visibility).toBe('public');
      expect(mockAudit.logAuthEvent).not.toHaveBeenCalled();
    });
  });

  describe('associateWithMenuItem()', () => {
    const publicAsset = {
      id: 'asset-1',
      organizationId: orgId,
      venueId,
      purpose: 'menu_item',
      objectKey: 'venues/venue-1/menu-items/asset-1/original/tiramisu.jpg',
      status: 'approved',
      visibility: 'public',
    };
    const menuItemId = 'item-1';
    const deliveryUrl =
      'https://storage.googleapis.com/verdura-media-public-test/venues/venue-1/menu-items/asset-1/original/tiramisu.jpg';

    it('throws NotFoundException when the MediaAsset does not belong to the caller organization', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(null);
      await expect(
        service.associateWithMenuItem(orgId, actor, 'asset-1', menuItemId),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.menuItem.update).not.toHaveBeenCalled();
    });

    it('refuses to associate an asset that has not been published yet', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({ ...publicAsset, visibility: 'private' });
      await expect(
        service.associateWithMenuItem(orgId, actor, 'asset-1', menuItemId),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.menuItem.update).not.toHaveBeenCalled();
    });

    it('refuses to associate a published asset whose purpose is not menu_item (e.g. a branding/promotion asset)', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({ ...publicAsset, purpose: 'branding' });
      await expect(
        service.associateWithMenuItem(orgId, actor, 'asset-1', menuItemId),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.menuItem.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.menuItem.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the MenuItem does not belong to the caller organization (cross-tenant denial)', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(publicAsset);
      mockPrisma.menuItem.findFirst.mockResolvedValue(null);

      await expect(
        service.associateWithMenuItem(orgId, actor, 'asset-1', menuItemId),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.menuItem.findFirst).toHaveBeenCalledWith({
        where: { id: menuItemId, organizationId: orgId, deletedAt: null },
      });
      expect(mockPrisma.menuItem.update).not.toHaveBeenCalled();
    });

    it('atomically writes the resolved delivery URL onto the MenuItem and audits the transition', async () => {
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(publicAsset);
      mockPrisma.menuItem.findFirst.mockResolvedValue({
        id: menuItemId,
        organizationId: orgId,
        imageUrl: null,
      });
      mockStorage.generateDeliveryUrl.mockResolvedValue(deliveryUrl);
      mockPrisma.menuItem.update.mockResolvedValue({ id: menuItemId, imageUrl: deliveryUrl });

      const result = await service.associateWithMenuItem(orgId, actor, 'asset-1', menuItemId);

      expect(mockPrisma.menuItem.update).toHaveBeenCalledWith({
        where: { id: menuItemId },
        data: { imageUrl: deliveryUrl },
      });
      expect(result.menuItem.imageUrl).toBe(deliveryUrl);
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'media_asset.associated_menu_item',
          resourceId: menuItemId,
        }),
      );
    });

    it('archives the previously-associated MediaAsset on replacement, but only when no other current MenuItem still references it', async () => {
      const previousUrl =
        'https://storage.googleapis.com/verdura-media-public-test/venues/venue-1/menu-items/old-asset/original/old.jpg';
      mockPrisma.mediaAsset.findFirst
        .mockResolvedValueOnce(publicAsset) // the new asset being associated
        .mockResolvedValueOnce({ id: 'old-asset-id', organizationId: orgId }); // superviseReplacedAsset's lookup
      mockPrisma.menuItem.findFirst.mockResolvedValue({
        id: menuItemId,
        organizationId: orgId,
        imageUrl: previousUrl,
      });
      mockStorage.generateDeliveryUrl.mockResolvedValue(deliveryUrl);
      mockPrisma.menuItem.update.mockResolvedValue({ id: menuItemId, imageUrl: deliveryUrl });
      mockPrisma.menuItem.count.mockResolvedValue(0); // no other MenuItem still uses the old image
      mockPrisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });

      await service.associateWithMenuItem(orgId, actor, 'asset-1', menuItemId);

      expect(mockPrisma.mediaAsset.updateMany).toHaveBeenCalledWith({
        where: { id: 'old-asset-id', status: 'approved' },
        data: { status: 'archived' },
      });
    });

    it('never archives the previously-associated MediaAsset if another current MenuItem still references the same image', async () => {
      const previousUrl =
        'https://storage.googleapis.com/verdura-media-public-test/venues/venue-1/menu-items/old-asset/original/old.jpg';
      mockPrisma.mediaAsset.findFirst
        .mockResolvedValueOnce(publicAsset)
        .mockResolvedValueOnce({ id: 'old-asset-id', organizationId: orgId });
      mockPrisma.menuItem.findFirst.mockResolvedValue({
        id: menuItemId,
        organizationId: orgId,
        imageUrl: previousUrl,
      });
      mockStorage.generateDeliveryUrl.mockResolvedValue(deliveryUrl);
      mockPrisma.menuItem.update.mockResolvedValue({ id: menuItemId, imageUrl: deliveryUrl });
      mockPrisma.menuItem.count.mockResolvedValue(1); // another MenuItem still references it — must survive
      mockPrisma.mediaAsset.updateMany.mockClear();

      await service.associateWithMenuItem(orgId, actor, 'asset-1', menuItemId);

      expect(mockPrisma.mediaAsset.updateMany).not.toHaveBeenCalled();
    });
  });
});
