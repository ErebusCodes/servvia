import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Two selection shapes are accepted on the same DTO, deliberately — which
 * shape a given entry used is decided and enforced in
 * `OrdersService.resolveModifiers` (exactly one of the two, never both,
 * never neither), not here; the DTO only validates each field's own type:
 *
 * - ID-based (`modifierGroupId` + `optionId`): the strict, authoritative
 *   path this story introduces for the staff/tablet order-creation
 *   surfaces (`OrdersService.createStaffOrder`, used by both
 *   `/api/admin/orders` and `/api/tablet/orders`). The server resolves
 *   name/price from real `MenuItem.modifierGroups` data — the client never
 *   supplies a trusted price. See Story 15-3.
 * - Name-based (`name`, with an optional but never-trusted
 *   `priceDeltaCents` the server only ever uses as a legacy lookup key) —
 *   kept exactly as it worked before this story, for the public kiosk
 *   order path only (`OrdersService.create`), which Window Display's
 *   separate, pre-existing, out-of-scope ordering flow still relies on.
 *   Story 15-3 does not touch or strengthen this path; it only adds the
 *   new ID-based one alongside it.
 */
export class OrderItemModifierDto {
  @IsOptional()
  @IsUUID()
  modifierGroupId?: string;

  @IsOptional()
  @IsUUID()
  optionId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // Legacy path only — never trusted as an authoritative price even there;
  // see OrdersService.resolveModifiers's non-strict branch.
  @IsOptional()
  @IsInt()
  priceDeltaCents?: number;
}

export class CreateOrderItemDto {
  @IsUUID()
  menuItemId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemModifierDto)
  @IsOptional()
  selectedModifiers?: OrderItemModifierDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * Optional per-seat assignment for the Order Tablet dine-in flow. Must be
   * an integer when present; a non-positive value is normalized to "no seat"
   * (null) in OrdersService.resolveOrderItems, consistently with
   * buildIdealposOrderPayload — never stored or emitted as seat 0. Absent =
   * no seat.
   */
  @IsOptional()
  @IsInt()
  seat?: number;

  /**
   * The per-unit price (base + resolved modifier deltas) the caller
   * currently displays for this line, in integer cents. Optional — only
   * the strict (staff/tablet) path sends it. When present, the server
   * compares it to the freshly-resolved authoritative price and fails
   * closed with a 409 conflict (carrying the authoritative line) rather
   * than silently accepting a materially different amount than what was
   * reviewed. See Story 15-3.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedUnitPriceCents?: number;
}

export class CreateOrderDto {
  @IsUUID()
  venueId: string;

  @IsUUID()
  @IsOptional()
  tableId?: string;

  @IsString()
  @IsOptional()
  tableNumber?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsNotEmpty()
  stripePaymentIntentId: string;

  /**
   * Client-generated once per checkout attempt (e.g. persisted in kiosk
   * session state for the duration of that attempt) and resent unchanged on
   * every retry of the same attempt. Scoped per venue — see Story 6-1.
   *
   * Minimum length is a defense-in-depth guard against trivially-guessable
   * keys (sequential integers, timestamps) on this unauthenticated endpoint
   * — a caller who already knows a venue's id and correctly guesses another
   * caller's key learns only whether that key was already used (see Story
   * 6-1 review notes on kiosk endpoint auth, tracked separately as E6-S10).
   * A client-generated UUID/random-token satisfies this trivially.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  @MaxLength(255)
  idempotencyKey: string;
}
