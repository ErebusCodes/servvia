import {
  REDACTED,
  SECURITY_EVENTS,
  logSecurityEvent,
  redactSecurityFields,
  setSecurityEventSink,
} from './security-events';
import { runWithRequestContext } from './request-context';

// A real-looking access token, Authorization value and setup code, so the
// redaction is proven against the shapes that actually exist.
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdGFmZi0xIiwic2lkIjoieCJ9.c2lnbmF0dXJlLXZhbHVlLWhlcmU';
const SETUP_CODE = '3f2c9a8e-1b7d-4c5e-9f0a-2d4e6b8c0a1f.q8ZtW3mN5vR2xY7kP0jL4sD6fG9hJ1aB';

function capture(fn: () => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const previous = setSecurityEventSink((line) => lines.push(line));
  try {
    fn();
  } finally {
    setSecurityEventSink(previous);
  }
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('redactSecurityFields (Story 12.13)', () => {
  it('drops the value of every secret-named field, whatever it holds', () => {
    const safe = redactSecurityFields({
      password: 'hunter2-hunter2',
      newPassword: 'x',
      pin: '4821',
      staffPin: '4821',
      authorization: 'anything',
      cookie: 'refresh_token=abc',
      refresh_token: 'abc',
      code: 'abc',
      setupCode: 'abc',
      passwordHash: '$argon2id$v=19$...',
      client_secret: 'abc',
      email: 'owner@example.com',
      actorEmail: 'owner@example.com',
    });
    for (const value of Object.values(safe)) expect(value).toBe(REDACTED);
  });

  it('removes credentials and addresses from any other field', () => {
    const safe = redactSecurityFields({
      error: `jwt malformed: ${JWT}`,
      header: `Bearer ${JWT}`,
      basic: 'Basic dXNlcjpwYXNzd29yZA==',
      detail: `redeemed ${SETUP_CODE} for owner@example.com`,
    });
    const text = JSON.stringify(safe);
    expect(text).not.toContain(JWT);
    expect(text).not.toContain('dXNlcjpwYXNzd29yZA');
    expect(text).not.toContain(SETUP_CODE.split('.')[1]);
    expect(text).not.toContain('owner@example.com');
    expect(safe.detail).toBe(`redeemed ${REDACTED} for ${REDACTED}`);
  });

  it('keeps identifiers an investigation needs', () => {
    expect(
      redactSecurityFields({
        staff_id: '6ad9d21a-c6c1-4fcd-9b4f-d99af1530124',
        organization_id: '8d55c214-e4f4-481f-abc5-7ecbb7b83d47',
        role: 'manager',
        route: 'POST:/api/auth/login',
        client_ip: '10.0.0.7',
        limit: 10,
        missing: undefined,
      }),
    ).toEqual({
      staff_id: '6ad9d21a-c6c1-4fcd-9b4f-d99af1530124',
      organization_id: '8d55c214-e4f4-481f-abc5-7ecbb7b83d47',
      role: 'manager',
      route: 'POST:/api/auth/login',
      client_ip: '10.0.0.7',
      limit: 10,
    });
  });

  it('keeps one event on one line and bounds its size (log injection)', () => {
    const safe = redactSecurityFields({
      error: 'first\n{"event":"forged","level":"INFO"}\r\u0007',
      long: 'x'.repeat(5000),
      'weird key\n': 'v',
    });
    for (const control of ['\n', '\r', '\u0007']) expect(safe.error).not.toContain(control);
    expect(String(safe.long).length).toBeLessThanOrEqual(257);
    expect(Object.keys(safe)).toContain('weird_key_');
  });
});

describe('logSecurityEvent (Story 12.13)', () => {
  it('writes one JSON line in Core’s shape, with the request’s IDs', () => {
    const [line] = capture(() =>
      runWithRequestContext({ requestId: 'req-1', correlationId: 'corr-1' }, () =>
        logSecurityEvent('staff_session_refused', 'refused', { staff_id: 's1', kind: 'staff' }),
      ),
    );
    expect(line).toMatchObject({
      level: 'WARN',
      msg: 'refused',
      service: 'api',
      event: 'staff_session_refused',
      staff_id: 's1',
      kind: 'staff',
      request_id: 'req-1',
      correlation_id: 'corr-1',
    });
    expect(new Date(String(line.time)).toISOString()).toBe(line.time);
  });

  it('cannot be made to overwrite its own envelope by a field', () => {
    const [line] = capture(() =>
      runWithRequestContext({ requestId: 'req-1', correlationId: 'corr-1' }, () =>
        logSecurityEvent('login_failed', 'refused', { request_id: 'forged', event: 'forged' }),
      ),
    );
    expect(line.request_id).toBe('req-1');
    expect(line.event).toBe('login_failed');
  });

  it('redacts before writing, so no credential reaches the sink', () => {
    const [line] = capture(() =>
      logSecurityEvent('login_failed', `token ${JWT}`, {
        password: 'hunter2-hunter2',
        error: `Bearer ${JWT}`,
      }),
    );
    const text = JSON.stringify(line);
    expect(text).not.toContain(JWT);
    expect(text).not.toContain('hunter2');
  });

  it('never throws, even when the sink fails', () => {
    const previous = setSecurityEventSink(() => {
      throw new Error('disk full');
    });
    try {
      expect(() => logSecurityEvent('rate_limit_exceeded', 'x')).not.toThrow();
    } finally {
      setSecurityEventSink(previous);
    }
  });

  it('gives every event in the taxonomy a level', () => {
    for (const level of Object.values(SECURITY_EVENTS)) expect(['warn', 'error']).toContain(level);
  });
});
