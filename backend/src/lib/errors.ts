/**
 * Application error types.
 *
 * Services throw these; the Fastify error handler turns them into responses.
 * The distinction that matters: an AppError is something we chose to tell the
 * client about, so its message is safe to send. Anything else is a bug, and
 * its message must never reach the client — it could carry SQL, file paths, or
 * internal ids.
 */

export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Invalid request.', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.') {
    super(401, 'UNAUTHORIZED', message)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(403, 'FORBIDDEN', message)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super(404, 'NOT_FOUND', message)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That action conflicts with the current state.') {
    super(409, 'CONFLICT', message)
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'A dependency is unavailable. Please retry shortly.') {
    super(503, 'SERVICE_UNAVAILABLE', message)
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
