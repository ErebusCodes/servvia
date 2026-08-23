import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Staff, StaffRole, ReservationStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { TransitionReservationDto } from './dto/transition-reservation.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.admin, StaffRole.manager)
@Controller('admin/reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  create(@Req() req: Request & { user: Staff }, @Body() dto: CreateReservationDto) {
    return this.reservationsService.create(req.user.organizationId, dto);
  }

  @Get()
  findAll(
    @Req() req: Request & { user: Staff },
    @Query('venueId') venueId?: string,
    @Query('date') date?: string,
    @Query('status') status?: ReservationStatus,
    @Query('search') search?: string,
  ) {
    return this.reservationsService.findAll(req.user.organizationId, {
      venueId,
      date,
      status,
      search,
    });
  }

  @Get(':id')
  findOne(@Req() req: Request & { user: Staff }, @Param('id', ParseUUIDPipe) id: string) {
    return this.reservationsService.findOne(id, req.user.organizationId);
  }

  @Patch(':id')
  update(
    @Req() req: Request & { user: Staff },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.reservationsService.update(id, req.user.organizationId, dto);
  }

  @Patch(':id/status')
  transitionStatus(
    @Req() req: Request & { user: Staff },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionReservationDto,
  ) {
    return this.reservationsService.transition(
      id,
      req.user.organizationId,
      dto.status,
      req.user.id,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request & { user: Staff }, @Param('id', ParseUUIDPipe) id: string) {
    return this.reservationsService.remove(id, req.user.organizationId);
  }
}
