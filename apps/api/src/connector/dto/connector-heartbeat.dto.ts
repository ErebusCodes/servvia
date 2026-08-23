import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Self-reported by the connector on every authenticated heartbeat. Purely
 * descriptive — the backend never infers Idealpos/EFTPOS/printer state from
 * this payload, only stores what the connector claims about itself.
 */
export class ConnectorHeartbeatDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  version?: string;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}
