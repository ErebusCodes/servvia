import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    organizationId: string,
    createdById: string,
    dto: CreateCategoryDto,
  ): Promise<Category> {
    return this.prisma.category.create({
      data: {
        organizationId,
        createdById,
        name: dto.name,
        description: dto.description,
        imageUrl: dto.imageUrl,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        // Deliberately NOT defaulted to "all channels" — an omitted
        // visibleChannels on create leaves the schema's own deny-by-default
        // `@default([])` in effect, matching the deploy-invisible-first
        // principle described on CreateCategoryDto.visibleChannels.
        visibleChannels: dto.visibleChannels ?? [],
      },
    });
  }

  async findAll(organizationId: string): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string, organizationId: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { id, organizationId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  async update(id: string, organizationId: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.findOne(id, organizationId);
    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          imageUrl: dto.imageUrl,
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
          // undefined (not provided in this PATCH) leaves the existing
          // visibleChannels untouched — Prisma ignores an undefined field
          // on update, same convention as every other optional field here.
          visibleChannels: dto.visibleChannels,
        },
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      throw e;
    }
  }

  async remove(id: string, organizationId: string): Promise<Category> {
    await this.findOne(id, organizationId);
    try {
      return await this.prisma.category.delete({ where: { id } });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      throw e;
    }
  }
}
