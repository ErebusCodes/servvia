import { IsEnum } from 'class-validator';
import { ReservationStatus } from '@prisma/client';

export class TransitionReservationDto {
  @IsEnum(ReservationStatus)
  status: ReservationStatus;
}
