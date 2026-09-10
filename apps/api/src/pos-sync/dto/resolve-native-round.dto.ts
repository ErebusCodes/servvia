import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A person's report after physically checking the till, settling a round that
 * nothing else can settle.
 *
 * THE OUTCOME IS SPELLED FROM THE BILL, NOT FROM THE PROTOCOL. `landed` /
 * `didNotLand` answer "is this food on the customer's table in IdealPOS right
 * now?" - which is the only question a manager standing at a till is actually
 * able to answer, and the only one that decides whether these lines may be
 * sent again. It deliberately does NOT ask whether our packet caused what they
 * see: they cannot tell, nobody can from the screen, and a field that invited
 * them to guess would turn a useful observation into a fabricated one.
 */
export class ResolveNativeRoundDto {
  /**
   * No default, and no boolean.
   *
   * A default would let a malformed or truncated request settle a round in
   * whichever direction the server happened to prefer, and one of the two
   * directions releases lines onto a customer's next bill. A boolean
   * (`landed: true/false`) would make the dangerous value the one you get by
   * omitting the field or sending `null` through a lax parser. Two explicit
   * strings mean a resolution can only happen when somebody named one.
   */
  @IsIn(['landed', 'didNotLand'])
  outcome: 'landed' | 'didNotLand';

  /**
   * WHAT THEY ACTUALLY SAW, in their own words. Required, for both outcomes.
   *
   * This is the evidence, and it is the only evidence this path will ever
   * have. A round settled by hand is an assertion by a named person; an
   * assertion with no statement attached is a button press, and a button press
   * is what somebody does to make a red banner go away. Requiring a sentence
   * does not stop a careless resolution, but it does mean that when a bill is
   * disputed next week the record says "3 mains on table 5, no drinks" instead
   * of nothing at all.
   *
   * The floor is deliberately low enough to type mid-service on a tablet and
   * high enough to exclude "ok".
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  basis: string;
}
