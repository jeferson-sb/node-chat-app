/**
 * Base for errors that originate from business-rule violations rather
 * than infrastructure failures (a broken Redis connection, say) -
 * mirrors HTTPError's role for the Express layer
 * (infra/errors/HTTPError.ts), but for errors raised from domain/
 * application code that has no inherent notion of an HTTP status code.
 * `code` is a short, stable machine-readable identifier a caller (e.g.
 * the Socket.io `error` event payload built in
 * presentation/socketErrorHandler.ts) can switch on, distinct from
 * `message`, which is meant for a human/log line and may change wording
 * over time.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
