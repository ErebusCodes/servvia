import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MediaService } from './media.service';

/**
 * @deprecated Legacy local-disk media upload — bypasses the MediaAsset
 * pipeline entirely (no signed URL, no server-side verification, no
 * publish/approval step, writes straight into the three frontends'
 * public/menu-images/ directories). Superseded by MediaAssetsController
 * (request-upload → finalize → publish → associate-menu-item) — see
 * _bmad-output/implementation-artifacts for the story that migrated the
 * last remaining consumer (Admin Console's MenuManagementPage) off this
 * endpoint. Confirmed zero consumers remain anywhere in this repository as
 * of that story (`grep -rn "admin/media/" apps/*\/src`). Left registered
 * rather than deleted — a working, tested module with no proven-safe
 * reason to remove it beyond "nothing calls it today" — but must not gain
 * new callers. Route: POST /api/admin/media/:folder.
 */
@Controller('admin/media')
@UseGuards(JwtAuthGuard, RolesGuard, StaffSessionOnlyGuard)
@Roles(StaffRole.admin, StaffRole.manager)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post(':folder')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  async upload(@Param('folder') folder: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.mediaService.upload(folder, file.buffer, file.mimetype);
  }

  @Delete(':folder/:filename')
  async remove(@Param('folder') folder: string, @Param('filename') filename: string) {
    await this.mediaService.remove(`${folder}/${filename}`);
  }
}
