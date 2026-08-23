import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { Table } from '@prisma/client';
import * as path from 'path';
import { existsSync } from 'fs';

const tableConfigPath = (() => {
  const cwd = process.cwd();
  const rootPath = path.resolve(cwd, 'shared/table-config.json');
  if (existsSync(rootPath)) return rootPath;
  const backendPath = path.resolve(cwd, '../../shared/table-config.json');
  if (existsSync(backendPath)) return backendPath;
  const devPath = path.resolve(__dirname, '../../../../shared/table-config.json');
  if (existsSync(devPath)) return devPath;
  return path.resolve(__dirname, '../../../../../shared/table-config.json');
})();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tableConfig = require(tableConfigPath) as Array<{
  tableNumber: string;
  capacity: number;
  name: string;
  sortOrder: number;
}>;

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  private async verifyVenueOwnership(venueId: string, organizationId: string): Promise<void> {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizationId },
    });
    if (!venue) {
      throw new NotFoundException('Venue not found in this organization');
    }
  }

  private canonicalTable(tableNumber: string) {
    const table = tableConfig.find((candidate) => candidate.tableNumber === tableNumber);
    if (!table) throw new BadRequestException('Table number must be between 1 and 18');
    return table;
  }

  async create(organizationId: string, venueId: string, dto: CreateTableDto): Promise<Table> {
    await this.verifyVenueOwnership(venueId, organizationId);
    const canonical = this.canonicalTable(dto.tableNumber);
    if (dto.capacity !== canonical.capacity) {
      throw new BadRequestException(`${canonical.name} must have capacity ${canonical.capacity}`);
    }

    const existing = await this.prisma.table.findFirst({
      where: { venueId, tableNumber: dto.tableNumber },
    });
    if (existing) {
      throw new ConflictException(`Table number "${dto.tableNumber}" already exists in this venue`);
    }

    if (dto.posTableCode) {
      await this.rejectIfPosTableCodeReused(venueId, dto.posTableCode);
    }

    return this.prisma.table.create({
      data: {
        venueId,
        tableNumber: dto.tableNumber,
        name: canonical.name,
        capacity: canonical.capacity,
        isActive: dto.isActive ?? true,
        sortOrder: canonical.sortOrder,
        posTableCode: dto.posTableCode,
      },
    });
  }

  /**
   * Pre-check only — the `@@unique([venueId, posTableCode])` DB constraint
   * is the actual enforcement (same pattern as OrdersService's idempotency
   * pre-checks). Rejects early with a clear message rather than letting a
   * P2002 surface as an opaque 500.
   */
  private async rejectIfPosTableCodeReused(
    venueId: string,
    posTableCode: string,
    excludeTableId?: string,
  ): Promise<void> {
    const conflicting = await this.prisma.table.findFirst({
      where: { venueId, posTableCode, ...(excludeTableId ? { id: { not: excludeTableId } } : {}) },
    });
    if (conflicting) {
      throw new ConflictException(
        `POS table code "${posTableCode}" is already assigned to another table in this venue`,
      );
    }
  }

  async findAll(organizationId: string, venueId: string): Promise<Table[]> {
    await this.verifyVenueOwnership(venueId, organizationId);

    return this.prisma.table.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string, venueId: string, organizationId: string): Promise<Table> {
    await this.verifyVenueOwnership(venueId, organizationId);

    const table = await this.prisma.table.findFirst({
      where: { id, venueId },
    });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    return table;
  }

  async update(
    id: string,
    venueId: string,
    organizationId: string,
    dto: UpdateTableDto,
  ): Promise<Table> {
    const current = await this.findOne(id, venueId, organizationId);
    const canonical = this.canonicalTable(dto.tableNumber ?? current.tableNumber);
    if (dto.capacity !== undefined && dto.capacity !== canonical.capacity) {
      throw new BadRequestException(`${canonical.name} must have capacity ${canonical.capacity}`);
    }

    if (dto.tableNumber) {
      const existing = await this.prisma.table.findFirst({
        where: {
          venueId,
          tableNumber: dto.tableNumber,
          id: { not: id },
        },
      });
      if (existing) {
        throw new ConflictException(
          `Table number "${dto.tableNumber}" already exists in this venue`,
        );
      }
    }

    if (dto.posTableCode) {
      await this.rejectIfPosTableCodeReused(venueId, dto.posTableCode, id);
    }

    return this.prisma.table.update({
      where: { id },
      data: {
        tableNumber: canonical.tableNumber,
        name: canonical.name,
        capacity: canonical.capacity,
        isActive: dto.isActive,
        sortOrder: canonical.sortOrder,
        posTableCode: dto.posTableCode,
      },
    });
  }

  async remove(id: string, venueId: string, organizationId: string): Promise<Table> {
    await this.findOne(id, venueId, organizationId);
    throw new BadRequestException('Canonical restaurant tables cannot be removed');
  }
}
