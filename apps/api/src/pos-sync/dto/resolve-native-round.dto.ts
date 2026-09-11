import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A person's report after physically checking the till.
 *
 * THE OUTCOME IS SPELLED FROM THE BILL, NOT FROM THE PROTOCOL. It answers "is
 * this food on the customer's table in IdealPOS right now?" - the only question
 * a manager standing at a till is actually able to answer. It deliberately does
 * NOT ask whether our packet caused what they see: they cannot tell, nobody can
 * from the screen, and a field that invited them to guess would turn a useful
 * observation into a fabricated one.
 *
 * THE TWO ANSWERS ARE NOT OPPOSITES, and the vocabulary says so. `present` is
 * an OBSERVATION and settles the round. `notFound` is a FAILURE TO OBSERVE: it
 * is recorded, and it changes nothing - no state, no line, no unblocked table.
 * They are not named as a pair (`landed`/`didNotLand`, `yes`/`no`) precisely
 * because naming them as a pair is what makes people expect them to do
 * symmetrical things.
 */
export class ResolveNativeRoundDto {
  /**
   * No default, and no boolean.
   *
   * A default would let a malformed or truncated request settle a round in
   * whichever direction the server happened to prefer. A boolean
   * (`present: true/false`) would make the consequential value the one you get
   * by omitting the field or sending `null` through a lax parser. Two explicit
   * strings mean a resolution can only happen when somebody named one.
   */
  @IsIn(['present', 'notFound'])
  outcome: 'present' | 'notFound';

  /**
   * WHAT THEY ACTUALLY SAW, in their own words. Required, for both outcomes.
   *
   * This is the evidence, and it is the only evidence this path will ever
   * have. A round settled by hand is an assertion by a named person; an
   * assertion with no statement attached is a button press, and a button press
   * is what somebody does to make a red banner go away. Requiring a sentence
   * does not stop a careless attestation, but it does mean that when a bill is
   * disputed next week the record says "3 mains on table 5, no drinks" instead
   * of nothing at all.
   *
   * Required on `notFound` too, where it is the whole point of the request:
   * that outcome exists only to record what somebody looked at and did not
   * find, so a manager, a supplier or an incident review can pick the thread up
   * later.
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
