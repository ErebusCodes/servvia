import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A truthful terminal report from the connector for a command it already
 * durably accepted. `resultType` is operation-specific and must never be
 * read as evidence of any Idealpos/EFTPOS/KDS/printer outcome — see
 * connector-command.service.ts's class doc comment. `idempotencyKey` lets
 * a connector safely repeat an identical report (e.g. after a dropped HTTP
 * response) without it being treated as a conflicting second report.
 */
export class ConnectorCommandReportDto {
  @IsIn(['succeeded', 'failed'])
  outcome!: 'succeeded' | 'failed';

  @IsString()
  @MaxLength(128)
  resultType!: string;

  @IsOptional()
  @IsObject()
  resultPayload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  failureReason?: string;

  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
}
