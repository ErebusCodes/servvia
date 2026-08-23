import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { MenuItemsService } from './menu-items.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffRole, Staff } from '@prisma/client';
import { Request } from 'express';

@Controller('admin/menu/items')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.admin, StaffRole.manager)
export class MenuItemsController {
  constructor(private readonly menuItemsService: MenuItemsService) {}

  @Post()
  async create(@Body() dto: CreateMenuItemDto, @Req() req: Request & { user: Staff }) {
    return this.menuItemsService.create(req.user.organizationId, req.user.id, dto);
  }

  @Get()
  async findAll(@Req() req: Request & { user: Staff }) {
    return this.menuItemsService.findAll(req.user.organizationId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: Staff }) {
    return this.menuItemsService.findOne(id, req.user.organizationId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemDto,
    @Req() req: Request & { user: Staff },
  ) {
    return this.menuItemsService.update(id, req.user.organizationId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: Staff },
  ): Promise<void> {
    return this.menuItemsService.remove(id, req.user.organizationId);
  }
}
