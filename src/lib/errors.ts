/**
 * Generic HTTP error carrying a status code + safe client message.
 * The global error handler translates these into JSON responses.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
