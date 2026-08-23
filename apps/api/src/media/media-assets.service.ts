import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { MediaAsset, MenuItem, StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { STORAGE_PROVIDER_PORT, StorageProviderPort } from './providers/storage-provider.port';
import { RequestUploadDto } from './dto/request-upload.dto';
import {
  DEFAULT_LOCAL_PRIVATE_BUCKET,
  DEFAULT_LOCAL_PUBLIC_BUCKET,
  MAX_SIZE_BYTES,
  buildObjectKey,
  extensionForMimeType,
  mediaTypeForMimeType,
} from './media-assets.constants';

export interface RequestUploadResult {
  mediaAssetId: string;
  reused: boolean;
  uploadUrl?: string;
  requiredHeaders?: Record<string, string>;
  expiresAt?: Date;
}

// Actor identity for audit logging — deliberately narrower than the full
// Staff type so this service never depends on more of the auth model than
// it needs.
interface Actor {
  id: string;
  email: string;
  role: StaffRole;
}

@Injectable()
export class MediaAssetsService {
  private readonly logger = new Logger(MediaAssetsService.name);
  private readonly bucket: string;
  private readonly publicBucket: string;
  private readonly signedUrlTtlSeconds: number;
  /**
   * The provider actually active on THIS running process — 'gcs' or
   * 'local'. Distinct from `MediaAsset.storageProvider`, which records
   * which provider each individual row's bytes actually live under.
   * Recorded once so both new-asset creation and the checksum-dedup lookup
   * agree on the same value — see the dedup query in requestUpload() for
   * why they must never disagree.
   */
  private readonly activeProvider: 'gcs' | 'local';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER_PORT) private readonly storage: StorageProviderPort,
  ) {
    this.bucket = this.config.get<string>('GCS_MEDIA_BUCKET') || DEFAULT_LOCAL_PRIVATE_BUCKET;
    this.publicBucket =
      this.config.get<string>('GCS_MEDIA_PUBLIC_BUCKET') || DEFAULT_LOCAL_PUBLIC_BUCKET;
    this.signedUrlTtlSeconds = this.config.get<number>('GCS_SIGNED_URL_TTL_SECONDS') ?? 900;
    this.activeProvider =
      this.config.get<string>('MEDIA_STORAGE_PROVIDER') === 'gcs' ? 'gcs' : 'local';
  }

  private async assertVenueInOrganization(venueId: string, organizationId: string): Promise<void> {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, organizationId } });
    if (!venue) {
      // Same response for "doesn't exist" and "belongs to another
      // organization" — never confirms cross-tenant existence.
      throw new ForbiddenException('venueId is not accessible to this organization');
    }
  }

  async requestUpload(
    organizationId: string,
    actor: Actor,
    dto: RequestUploadDto,
  ): Promise<RequestUploadResult> {
    await this.assertVenueInOrganization(dto.venueId, organizationId);

    const mediaType = mediaTypeForMimeType(dto.mimeType);
    if (!mediaType) {
      throw new BadRequestException(`Unsupported mimeType: ${dto.mimeType}`);
    }
    const extension = extensionForMimeType(mediaType, dto.mimeType);
    if (!extension) {
      throw new BadRequestException(`Unsupported mimeType: ${dto.mimeType}`);
    }
    if (dto.sizeBytes > MAX_SIZE_BYTES[mediaType]) {
      throw new BadRequestException(
        `File exceeds the ${MAX_SIZE_BYTES[mediaType] / (1024 * 1024)} MiB limit for ${mediaType}`,
      );
    }

    // Dedup: reuse an already-approved asset with the same checksum, venue,
    // purpose, AND storage provider rather than uploading an identical
    // duplicate — "do not upload identical duplicates" is enforced here,
    // not left to the client. storageProvider must match: reusing a row
    // whose bytes live under a different provider than the one this
    // process is actually running (e.g. a real GCS-migrated asset reused
    // while MEDIA_STORAGE_PROVIDER=local in dev) returns a mediaAssetId
    // that resolves to a delivery URL no object exists at under the
    // active provider — a real defect found via browser validation, not a
    // hypothetical: this repository's own local dev database mixes
    // GCS-created rows (the 46 migrated menu photos) with whatever a
    // developer uploads while running the local provider.
    const existing = await this.prisma.mediaAsset.findFirst({
      where: {
        venueId: dto.venueId,
        purpose: dto.purpose,
        checksum: dto.checksum,
        storageProvider: this.activeProvider,
        status: 'approved',
        deletedAt: null,
      },
    });
    if (existing) {
      return { mediaAssetId: existing.id, reused: true };
    }

    const mediaId = randomUUID();
    const objectKey = buildObjectKey({
      venueId: dto.venueId,
      purpose: dto.purpose,
      mediaId,
      originalFilename: dto.originalFilename,
      extension,
    });

    const asset = await this.prisma.mediaAsset.create({
      data: {
        id: mediaId,
        organizationId,
        venueId: dto.venueId,
        purpose: dto.purpose,
        mediaType,
        storageProvider: this.activeProvider,
        bucket: this.bucket,
        objectKey,
        originalFilename: dto.originalFilename,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        checksum: dto.checksum,
        altText: dto.altText,
        status: 'pending_upload',
        createdById: actor.id,
      },
    });

    const signed = await this.storage.generateSignedUploadUrl({
      bucket: this.bucket,
      objectKey,
      contentType: dto.mimeType,
      maxSizeBytes: MAX_SIZE_BYTES[mediaType],
      ttlSeconds: this.signedUrlTtlSeconds,
      checksum: dto.checksum,
    });

    await this.audit.logAuthEvent({
      organizationId,
      venueId: dto.venueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'media_asset.upload_requested',
      resource: 'MediaAsset',
      resourceId: asset.id,
      after: { purpose: dto.purpose, mimeType: dto.mimeType, sizeBytes: dto.sizeBytes },
    });

    return {
      mediaAssetId: asset.id,
      reused: false,
      uploadUrl: signed.uploadUrl,
      requiredHeaders: signed.requiredHeaders,
      expiresAt: signed.expiresAt,
    };
  }

  /**
   * Idempotent: calling this more than once for the same asset is always
   * safe — an asset already past `pending_upload` returns its current
   * state without re-verifying or re-transitioning.
   */
  async finalizeUpload(
    organizationId: string,
    mediaAssetId: string,
    actor: Actor,
  ): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, organizationId },
    });
    if (!asset) {
      throw new NotFoundException('MediaAsset not found');
    }
    if (asset.status !== 'pending_upload') {
      // Already finalized (or terminally failed/rejected) — idempotent no-op.
      return asset;
    }

    const verification = await this.storage.verifyObject({
      bucket: asset.bucket,
      objectKey: asset.objectKey,
    });
    if (!verification.exists) {
      return this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: 'failed' } });
    }

    await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: 'validating' },
    });

    const problems: string[] = [];
    if (verification.sizeBytes !== undefined && verification.sizeBytes !== asset.sizeBytes) {
      problems.push(`size mismatch: declared ${asset.sizeBytes}, actual ${verification.sizeBytes}`);
    }
    if (!verification.declaredChecksum || verification.declaredChecksum !== asset.checksum) {
      problems.push('checksum mismatch or missing');
    }

    const finalStatus = problems.length === 0 ? 'approved' : 'rejected';
    const updated = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: finalStatus },
    });

    if (finalStatus === 'rejected') {
      // Best-effort cleanup; deleteObject() never throws (see providers).
      await this.storage.deleteObject({ bucket: asset.bucket, objectKey: asset.objectKey });
    }

    await this.audit.logAuthEvent({
      organizationId,
      venueId: asset.venueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: finalStatus === 'approved' ? 'media_asset.approved' : 'media_asset.rejected',
      resource: 'MediaAsset',
      resourceId: asset.id,
      after: finalStatus === 'rejected' ? { problems } : undefined,
    });

    return updated;
  }

  async getDeliveryUrl(
    organizationId: string,
    mediaAssetId: string,
  ): Promise<{ url: string; asset: MediaAsset }> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, organizationId, deletedAt: null },
    });
    if (!asset) {
      throw new NotFoundException('MediaAsset not found');
    }
    if (asset.status !== 'approved') {
      // Never resolves a delivery URL for anything but an approved asset —
      // this is the enforcement point that keeps unapproved/rejected
      // originals from ever being rendered.
      throw new BadRequestException(`MediaAsset is not approved (status: ${asset.status})`);
    }
    // asset.bucket always names the PRIVATE originals bucket — it is never
    // overwritten by publishAsset(). A published copy lives at the same
    // object key in the separate public bucket, so the bucket to resolve
    // against is chosen from the asset's current visibility, not the
    // column that only ever tracks where the original was uploaded.
    const bucket = asset.visibility === 'public' ? this.publicBucket : asset.bucket;
    const url = await this.storage.generateDeliveryUrl({
      bucket,
      objectKey: asset.objectKey,
      visibility: asset.visibility,
      ttlSeconds: this.signedUrlTtlSeconds,
    });
    return { url, asset };
  }

  /**
   * The explicit, authorised private→public promotion. Requires the asset
   * to already be `approved` (verified in finalizeUpload) — publication is
   * a distinct, separately-audited transition from approval, never
   * implied by it. Idempotent: republishing an already-public asset is a
   * safe no-op; a compare-and-set update guards two concurrent publish
   * calls from both logging a transition.
   */
  async publishAsset(
    organizationId: string,
    mediaAssetId: string,
    actor: Actor,
  ): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, organizationId, deletedAt: null },
    });
    if (!asset) {
      throw new NotFoundException('MediaAsset not found');
    }
    if (asset.visibility === 'public') {
      return asset;
    }
    if (asset.status !== 'approved') {
      throw new BadRequestException(
        `MediaAsset must be approved before it can be published (status: ${asset.status})`,
      );
    }

    await this.storage.publishObject({
      sourceBucket: asset.bucket,
      destinationBucket: this.publicBucket,
      objectKey: asset.objectKey,
      contentType: asset.mimeType,
      checksum: asset.checksum,
    });

    // Never trust the copy call alone — verify the object that actually
    // exists at the public destination before treating it as live, same
    // "never trust a client/provider success claim alone" principle as
    // finalizeUpload's verifyObject step.
    const verification = await this.storage.verifyObject({
      bucket: this.publicBucket,
      objectKey: asset.objectKey,
    });
    if (!verification.exists || verification.declaredChecksum !== asset.checksum) {
      throw new BadRequestException(
        'Publication verification failed — the public object does not match the approved original',
      );
    }

    const { count } = await this.prisma.mediaAsset.updateMany({
      where: { id: asset.id, visibility: 'private' },
      data: { visibility: 'public' },
    });
    const updated = await this.prisma.mediaAsset.findFirstOrThrow({ where: { id: asset.id } });

    if (count > 0) {
      // Only the request that actually flipped private→public logs the
      // transition — a losing concurrent caller observes the same
      // (already-idempotent) publishObject/verifyObject result above and
      // returns the winner's row without a duplicate audit entry.
      await this.audit.logAuthEvent({
        organizationId,
        venueId: asset.venueId,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'media_asset.published',
        resource: 'MediaAsset',
        resourceId: asset.id,
      });
    }

    return updated;
  }

  /**
   * The one place MenuItem.imageUrl is written from a MediaAsset — never
   * reachable except through an asset that is already approved AND
   * published. MenuItem has no venueId of its own in this schema (a
   * single-venue-MVP, organization-wide catalog — see
   * apps/api/prisma/schema.prisma), so the cross-tenant boundary enforced
   * here is organizationId on both sides, the only scoping concept the
   * MenuItem model actually has; this is a deliberate, documented decision
   * (see the story handoff), not an oversight.
   */
  async associateWithMenuItem(
    organizationId: string,
    actor: Actor,
    mediaAssetId: string,
    menuItemId: string,
  ): Promise<{ menuItem: MenuItem; mediaAsset: MediaAsset }> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, organizationId, deletedAt: null },
    });
    if (!asset) {
      throw new NotFoundException('MediaAsset not found');
    }
    if (asset.status !== 'approved' || asset.visibility !== 'public') {
      throw new BadRequestException(
        'MediaAsset must be published before it can be associated with a menu item',
      );
    }
    if (asset.purpose !== 'menu_item') {
      // A published `branding`/`promotion`/`venue_gallery`/etc. asset must
      // never be attachable to a MenuItem just because it happens to be
      // approved+public — purpose is set once at upload time and is not a
      // client-supplied claim at association time.
      throw new BadRequestException(
        `MediaAsset has purpose "${asset.purpose}", not "menu_item" — cannot associate with a menu item`,
      );
    }

    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, organizationId, deletedAt: null },
    });
    if (!menuItem) {
      throw new NotFoundException('MenuItem not found');
    }

    const deliveryUrl = await this.storage.generateDeliveryUrl({
      bucket: this.publicBucket,
      objectKey: asset.objectKey,
      visibility: 'public',
    });

    const previousImageUrl = menuItem.imageUrl;
    // A single update statement: either this fully lands, or it throws and
    // nothing changes — there is no partial state for the caller to roll
    // back. Idempotent by construction (writing the same URL twice is a
    // no-op the second time).
    const updatedMenuItem = await this.prisma.menuItem.update({
      where: { id: menuItem.id },
      data: { imageUrl: deliveryUrl },
    });

    await this.audit.logAuthEvent({
      organizationId,
      venueId: asset.venueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'media_asset.associated_menu_item',
      resource: 'MenuItem',
      resourceId: menuItem.id,
      before: { imageUrl: previousImageUrl },
      after: { imageUrl: deliveryUrl, mediaAssetId: asset.id },
    });

    if (previousImageUrl && previousImageUrl !== deliveryUrl) {
      await this.superviseReplacedAsset(organizationId, previousImageUrl, asset.id).catch(
        (error: unknown) => {
          // Best-effort only — a failure to archive the superseded asset
          // must never fail (or appear to fail) the association that just
          // succeeded and was already audited above.
          this.logger.warn(
            `Failed to archive superseded media asset for menuItem ${menuItem.id}: ${(error as Error).message}`,
          );
        },
      );
    }

    return { menuItem: updatedMenuItem, mediaAsset: asset };
  }

  /**
   * MenuItem stores only imageUrl, not a mediaAssetId (see this file's
   * "smallest coherent existing model" note in the story handoff) — so the
   * previously-associated MediaAsset, if any, can only be recovered by
   * parsing the object key back out of the URL this same service
   * generates. Heuristic and best-effort by design: never archives an
   * asset still referenced by another current MenuItem (a shared stock
   * photo must survive), and never deletes bytes — archiving only changes
   * status, per the established lifecycle.
   */
  private extractObjectKeyFromDeliveryUrl(url: string): string | null {
    const gcsPrefix = `https://storage.googleapis.com/${this.publicBucket}/`;
    if (url.startsWith(gcsPrefix)) {
      return decodeURIComponent(url.slice(gcsPrefix.length));
    }
    const localMarker = '/media-assets/public/';
    const localIdx = url.indexOf(localMarker);
    if (localIdx !== -1) {
      return decodeURIComponent(url.slice(localIdx + localMarker.length));
    }
    return null;
  }

  private async superviseReplacedAsset(
    organizationId: string,
    previousImageUrl: string,
    newAssetId: string,
  ): Promise<void> {
    const objectKey = this.extractObjectKeyFromDeliveryUrl(previousImageUrl);
    if (!objectKey) return;

    const previousAsset = await this.prisma.mediaAsset.findFirst({
      where: {
        organizationId,
        objectKey,
        visibility: 'public',
        status: 'approved',
        deletedAt: null,
      },
    });
    if (!previousAsset || previousAsset.id === newAssetId) return;

    const stillReferenced = await this.prisma.menuItem.count({
      where: { organizationId, imageUrl: previousImageUrl, deletedAt: null },
    });
    if (stillReferenced > 0) return;

    await this.prisma.mediaAsset.updateMany({
      where: { id: previousAsset.id, status: 'approved' },
      data: { status: 'archived' },
    });
  }

  async archiveAsset(
    organizationId: string,
    mediaAssetId: string,
    actor: Actor,
  ): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, organizationId },
    });
    if (!asset) {
      throw new NotFoundException('MediaAsset not found');
    }
    const updated = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: 'archived' },
    });
    await this.audit.logAuthEvent({
      organizationId,
      venueId: asset.venueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'media_asset.archived',
      resource: 'MediaAsset',
      resourceId: asset.id,
    });
    return updated;
  }
}
