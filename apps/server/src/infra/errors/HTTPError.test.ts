import { describe, expect, it } from 'vitest';
import HTTPError from './HTTPError.ts';

describe('HTTPError', () => {
  it('defaults statusCode to 400', () => {
    const error = new HTTPError('bad request');

    expect(error.message).toBe('bad request');
    expect(error.statusCode).toBe(400);
  });

  it('accepts a custom statusCode', () => {
    const error = new HTTPError('not found', 404);

    expect(error.statusCode).toBe(404);
  });
});
