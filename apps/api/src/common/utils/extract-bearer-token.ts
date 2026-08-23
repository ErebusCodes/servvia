/**
 * Extracts the token from an `Authorization: Bearer <token>` header, or
 * undefined if the header is missing, malformed, or the token is empty.
 * Shared by ConnectorAuthGuard and the connector enrollment-exchange
 * endpoint so both parse credentials identically.
 */
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return undefined;
  }
  const token = authorizationHeader.slice('Bearer '.length);
  return token.length > 0 ? token : undefined;
}
