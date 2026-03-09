import { describe, it, expect } from 'vitest';

describe('Basic test harness', () => {
    it('should be able to run a simple test', () => {
        expect(1 + 1).toBe(2);
    });
});
