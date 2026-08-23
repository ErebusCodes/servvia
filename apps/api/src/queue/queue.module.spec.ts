import { QUEUE_NAMES } from './queue.module';

describe('QUEUE_NAMES', () => {
  it('defines the four required queue names', () => {
    expect(QUEUE_NAMES.PRINT_JOBS).toBe('print-jobs');
    expect(QUEUE_NAMES.POS_SYNC).toBe('pos-sync');
    expect(QUEUE_NAMES.EMAILS).toBe('emails');
    expect(QUEUE_NAMES.CALENDAR).toBe('calendar');
  });
});
