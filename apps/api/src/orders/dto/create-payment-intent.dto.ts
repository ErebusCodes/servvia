import { IsInt, Max, Min } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsInt()
  @Min(50)
  @Max(1_000_000)
  amountCents: number;
}
