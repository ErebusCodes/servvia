import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Admin-triggered creation of this story's one tracer command type
 * (`connector.self_test.v1`). `idempotencyKey` is optional — if omitted, a
 * fresh key is generated so an ad-hoc admin click always creates a new
 * command; a caller that wants retry-safe creation supplies its own.
 */
export class CreateConnectorCommandDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
