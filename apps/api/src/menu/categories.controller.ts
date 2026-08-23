import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffRole, Staff } from '@prisma/client';
import { Request } from 'express';

@Controller('admin/menu/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Roles(StaffRole.admin)
  async create(@Body() dto: CreateCategoryDto, @Req() req: Request & { user: Staff }) {
    return this.categoriesService.create(req.user.organizationId, req.user.id, dto);
  }

  @Get()
  @Roles(StaffRole.admin, StaffRole.manager)
  async findAll(@Req() req: Request & { user: Staff }) {
    return this.categoriesService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @Roles(StaffRole.admin, StaffRole.manager)
  async findOne(@Param('id') id: string, @Req() req: Request & { user: Staff }) {
    return this.categoriesService.findOne(id, req.user.organizationId);
  }

  @Patch(':id')
  @Roles(StaffRole.admin)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() req: Request & { user: Staff },
  ) {
    return this.categoriesService.update(id, req.user.organizationId, dto);
  }

  @Delete(':id')
  @Roles(StaffRole.admin)
  async remove(@Param('id') id: string, @Req() req: Request & { user: Staff }) {
    return this.categoriesService.remove(id, req.user.organizationId);
  }
}
