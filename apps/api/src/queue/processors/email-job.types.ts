export interface EmailJobPayload {
  type: 'reservation-confirmed' | 'reservation-cancelled';
  guestName: string;
  guestEmail: string;
  bookingRef: string;
  /** ISO date string, e.g. '2026-07-01' */
  reservationDate: string;
  reservationTime: string;
  partySize: number;
  venueName: string;
}

export type ReservationEmailPayload = Omit<EmailJobPayload, 'type'>;
