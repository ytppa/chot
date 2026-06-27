import type { FastifyReply } from 'fastify';

import { DomainError } from '../modules/common/domain-error.js';

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

/**
 * Sends domain and unexpected errors through one stable JSON envelope.
 */
export function sendApiError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DomainError) {
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.publicMessage
      }
    } satisfies ApiErrorResponse);
  }

  return reply.code(500).send({
    error: {
      code: 'internal_error',
      message: 'Internal server error.'
    }
  } satisfies ApiErrorResponse);
}

