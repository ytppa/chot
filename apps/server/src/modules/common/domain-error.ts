export type DomainErrorOptions = {
  code: string;
  statusCode: number;
  publicMessage: string;
};

/**
 * Carries a safe API error code and message from domain services to HTTP routes.
 */
export class DomainError extends Error {
  public readonly code: string;

  public readonly statusCode: number;

  public readonly publicMessage: string;

  public constructor(options: DomainErrorOptions) {
    super(options.publicMessage);
    this.name = 'DomainError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.publicMessage = options.publicMessage;
  }
}

/**
 * Creates a service unavailable error for routes that need a configured dependency.
 */
export function createServiceUnavailableError(): DomainError {
  return new DomainError({
    code: 'service_unavailable',
    statusCode: 503,
    publicMessage: 'Service is not available.'
  });
}

