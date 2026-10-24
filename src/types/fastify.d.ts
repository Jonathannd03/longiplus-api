import type { AuthenticatedUser } from '../modules/identity/authenticated-user.interface.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
