/* eslint-disable @typescript-eslint/unbound-method */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ConnectorAuthGuard } from './connector-auth.guard';
import { ConnectorIdentity, ConnectorService } from '../../connector/connector.service';

function contextWithHeader(authorization?: string): ExecutionContext {
  const request = { headers: { authorization } } as Request & { connector?: ConnectorIdentity };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ConnectorAuthGuard', () => {
  it('rejects a missing Authorization header', async () => {
    const connectorService = { authenticate: jest.fn() } as unknown as ConnectorService;
    const guard = new ConnectorAuthGuard(connectorService);

    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(connectorService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const connectorService = { authenticate: jest.fn() } as unknown as ConnectorService;
    const guard = new ConnectorAuthGuard(connectorService);

    await expect(guard.canActivate(contextWithHeader('Basic abc123'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when ConnectorService.authenticate resolves null', async () => {
    const connectorService = {
      authenticate: jest.fn().mockResolvedValue(null),
    } as unknown as ConnectorService;
    const guard = new ConnectorAuthGuard(connectorService);

    await expect(
      guard.canActivate(contextWithHeader('Bearer installation-1.wrong-secret')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('attaches request.connector and allows the request through on success', async () => {
    const identity: ConnectorIdentity = {
      installationId: 'installation-1',
      organizationId: 'org-1',
      venueId: 'venue-1',
    };
    const connectorService = {
      authenticate: jest.fn().mockResolvedValue(identity),
    } as unknown as ConnectorService;
    const guard = new ConnectorAuthGuard(connectorService);
    const request = {
      headers: { authorization: 'Bearer installation-1.right-secret' },
    } as Request & { connector?: ConnectorIdentity };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.connector).toEqual(identity);
    expect(connectorService.authenticate).toHaveBeenCalledWith('installation-1.right-secret');
  });
});
