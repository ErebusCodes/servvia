import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Staff, StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MediaAssetsService } from './media-assets.service';
import { RequestUploadDto } from './dto/request-upload.dto';
import { AssociateMenuItemDto } from './dto/associate-menu-item.dto';

@Controller('admin/media-assets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.admin, StaffRole.manager)
export class MediaAssetsController {
  constructor(private readonly mediaAssets: MediaAssetsService) {}

  @Post('request-upload')
  async requestUpload(@Body() dto: RequestUploadDto, @Req() req: Request & { user: Staff }) {
    return this.mediaAssets.requestUpload(req.user.organizationId, req.user, dto);
  }

  @Post(':id/finalize')
  async finalize(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: Staff }) {
    return this.mediaAssets.finalizeUpload(req.user.organizationId, id, req.user);
  }

  @Get(':id/delivery-url')
  async deliveryUrl(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: Staff }) {
    return this.mediaAssets.getDeliveryUrl(req.user.organizationId, id);
  }

  // Explicit, separately-authorised private→public promotion — distinct
  // from finalize, per the story's "publication must be an explicit
  // server-authorised transition" requirement. Guarded by the same
  // admin/manager roles as every other menu-media action in this
  // controller (the narrowest existing menu-management permission — no
  // new role was introduced for this).
  @Post(':id/publish')
  async publish(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: Staff }) {
    return this.mediaAssets.publishAsset(req.user.organizationId, id, req.user);
  }

  @Post(':id/associate-menu-item')
  async associateMenuItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssociateMenuItemDto,
    @Req() req: Request & { user: Staff },
  ) {
    return this.mediaAssets.associateWithMenuItem(
      req.user.organizationId,
      req.user,
      id,
      dto.menuItemId,
    );
  }

  @Post(':id/archive')
  async archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: Staff }) {
    return this.mediaAssets.archiveAsset(req.user.organizationId, id, req.user);
  }
}
