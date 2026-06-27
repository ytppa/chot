import type { z } from 'zod';

import { DomainError } from '../modules/common/domain-error.js';

/**
 * Validates unknown request input with Zod and returns typed data.
 */
export function parseRequestData<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DomainError({
      code: 'validation_error',
      statusCode: 400,
      publicMessage: 'Invalid request payload.'
    });
  }

  return result.data;
}

