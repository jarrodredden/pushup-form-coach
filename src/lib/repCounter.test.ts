import { describe, expect, it } from 'vitest';
import { createRepCounter } from './repCounter';

describe('rep counter', () => {
  it('increments completed reps in order', () => {
    const counter = createRepCounter();
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.next()).toBe(3);
  });
});
