import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ModifierGroupDto } from './dto/modifier-group.dto';
import { MenuItem, Prisma } from '@prisma/client';

@Injectable()
export class MenuItemsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assigns a stable id to any group/option an author submitted without one
   * (a genuinely new entry) and preserves any id already supplied (an edit
   * to an existing entry) — see Story 15-3. Also enforces the business
   * rules the DTO layer can't express per-field: `maxSelections` must be at
   * least `minSelections`, and a `required` group must require at least
   * one selection. Returns plain JSON-serializable objects for the Prisma
   * `Json` column (still embedded per DL-017 — not a schema change).
   */
  private normalizeModifierGroups(groups: ModifierGroupDto[] | undefined): Prisma.InputJsonValue {
    if (!groups) return [];
    return groups.map((group) => {
      if (group.maxSelections < group.minSelections) {
        throw new BadRequestException(
          `Modifier group "${group.name}": maxSelections cannot be less than minSelections`,
        );
      }
      if (group.required && group.minSelections < 1) {
        throw new BadRequestException(
          `Modifier group "${group.name}": a required group must have minSelections >= 1`,
        );
      }
      const options = group.options.map((option) => ({
        id: option.id ?? randomUUID(),
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
        isAvailable: option.isAvailable,
        sortOrder: option.sortOrder,
      }));
      const optionIds = new Set(options.map((o) => o.id));
      if (optionIds.size !== options.length) {
        throw new BadRequestException(
          `Modifier group "${group.name}": duplicate option ids are not allowed`,
        );
      }
      return {
        id: group.id ?? randomUUID(),
        name: group.name,
        required: group.required,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        options,
      };
    });
  }

  async create(
    organizationId: string,
    createdById: string,
    dto: CreateMenuItemDto,
  ): Promise<MenuItem> {
    const category = await this.prisma.category.findFirst({
      where: { id: dto.categoryId, organizationId },
    });
    if (!category) {
      throw new BadRequestException('categoryId does not belong to this organization');
    }
    if (dto.posProductCode) {
      await this.rejectIfPosProductCodeReused(organizationId, dto.posProductCode);
    }
    return this.prisma.menuItem.create({
      data: {
        organizationId,
        createdById,
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        priceCents: dto.priceCents,
        subCategory: dto.subCategory,
        imageUrl: dto.imageUrl,
        imageThumbnailUrl: dto.imageThumbnailUrl,
        nutritionalDetails: dto.nutritionalDetails ?? {},
        modifierGroups: this.normalizeModifierGroups(dto.modifierGroups),
        isSpicy: dto.isSpicy ?? false,
        isAvailable: dto.isAvailable ?? true,
        sortOrder: dto.sortOrder ?? 0,
        posProductCode: dto.posProductCode,
      },
    });
  }

  /**
   * Pre-check only — the `@@unique([organizationId, posProductCode])` DB
   * constraint is the actual enforcement. Rejects early with a clear
   * message rather than letting a P2002 surface as an opaque 500.
   */
  private async rejectIfPosProductCodeReused(
    organizationId: string,
    posProductCode: string,
    excludeMenuItemId?: string,
  ): Promise<void> {
    const conflicting = await this.prisma.menuItem.findFirst({
      where: {
        organizationId,
        posProductCode,
        deletedAt: null,
        ...(excludeMenuItemId ? { id: { not: excludeMenuItemId } } : {}),
      },
    });
    if (conflicting) {
      throw new ConflictException(
        `POS product code "${posProductCode}" is already assigned to another menu item ("${conflicting.title}")`,
      );
    }
  }

  async findAll(organizationId: string): Promise<MenuItem[]> {
    return this.prisma.menuItem.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string, organizationId: string): Promise<MenuItem> {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('MenuItem not found');
    return item;
  }

  async update(id: string, organizationId: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    if (dto.categoryId !== undefined) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, organizationId },
      });
      if (!category) {
        throw new BadRequestException('categoryId does not belong to this organization');
      }
    }
    if (dto.posProductCode) {
      await this.rejectIfPosProductCodeReused(organizationId, dto.posProductCode, id);
    }
    const { count } = await this.prisma.menuItem.updateMany({
      where: { id, organizationId, deletedAt: null },
      data: {
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        priceCents: dto.priceCents,
        subCategory: dto.subCategory,
        imageUrl: dto.imageUrl,
        imageThumbnailUrl: dto.imageThumbnailUrl,
        nutritionalDetails: dto.nutritionalDetails,
        // undefined (not provided in this PATCH) must leave existing
        // modifierGroups untouched — normalizeModifierGroups(undefined)
        // would otherwise produce [] and silently wipe them.
        modifierGroups:
          dto.modifierGroups !== undefined
            ? this.normalizeModifierGroups(dto.modifierGroups)
            : undefined,
        isSpicy: dto.isSpicy,
        isAvailable: dto.isAvailable,
        sortOrder: dto.sortOrder,
        posProductCode: dto.posProductCode,
      },
    });
    if (count === 0) throw new NotFoundException('MenuItem not found');
    return this.prisma.menuItem.findFirst({
      where: { id, organizationId, deletedAt: null },
    }) as Promise<MenuItem>;
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const { count } = await this.prisma.menuItem.updateMany({
      where: { id, organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('MenuItem not found');
  }
}
