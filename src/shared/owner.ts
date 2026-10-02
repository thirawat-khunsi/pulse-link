import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export const OWNER_COOKIE = 'pl_owner';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'fastify' {
  interface FastifyRequest {
    /** Anonymous owner identity from the `pl_owner` cookie (SPEC §4). */
    ownerToken: string;
  }
}

export interface OwnerCookieOptions {
  /** Mark the cookie Secure (production). */
  secure: boolean;
}

/**
 * Resolve `request.ownerToken` for every route in `scope`, issuing a new `pl_owner`
 * cookie when it is missing or malformed. Requires @fastify/cookie on the scope.
 */
export function registerOwnerCookie(scope: FastifyInstance, options: OwnerCookieOptions): void {
  scope.decorateRequest('ownerToken', '');
  scope.addHook('onRequest', async (request, reply) => {
    const existing = request.cookies[OWNER_COOKIE];
    if (existing && UUID_PATTERN.test(existing)) {
      request.ownerToken = existing.toLowerCase();
      return;
    }
    const token = randomUUID();
    request.ownerToken = token;
    reply.setCookie(OWNER_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: options.secure,
      maxAge: ONE_YEAR_SECONDS,
    });
  });
}
