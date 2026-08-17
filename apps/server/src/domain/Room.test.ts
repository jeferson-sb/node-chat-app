import { describe, expect, it } from 'vitest';
import { generateRoomCode } from './Room.ts';

describe('generateRoomCode', () => {
  it('always generates a 6-digit numeric string', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateRoomCode()).toMatch(/^\d{6}$/);
    }
  });

  it('zero-pads codes shorter than 6 digits', () => {
    const code = generateRoomCode();

    expect(code).toHaveLength(6);
  });
});
