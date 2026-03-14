import { describe, it, expect } from 'vitest';
import { calculatePrecision, calculateUpgradedIter } from './worker.js';

describe('worker.js pure functions', () => {
    describe('calculatePrecision', () => {
        it('should clamp bits to a minimum of 128', () => {
            // scale = 2 => log2(2) = 1 => bits = ceil(-1) + 128 = 127
            expect(calculatePrecision(2)).toBe(128);
        });

        it('should clamp bits to a maximum of 4096', () => {
            // Very small scale should result in max bits
            expect(calculatePrecision(Math.pow(2, -5000))).toBe(4096);
        });

        it('should calculate bits correctly between 128 and 4096', () => {
            // scale = 2^-100 => log2(2^-100) = -100 => bits = ceil(100) + 128 = 228
            expect(calculatePrecision(Math.pow(2, -100))).toBe(228);
        });
    });

    describe('calculateUpgradedIter', () => {
        it('should upgrade iterations by 1.5x searchLimit when anchorIter >= searchLimit', () => {
            const iter = 1000;
            const anchorIter = 5000;
            const searchLimit = 5000;
            const expected = Math.floor(searchLimit * 1.5);
            expect(calculateUpgradedIter(iter, anchorIter, searchLimit)).toBe(expected);
        });

        it('should upgrade iterations by 1.25x anchorIter when anchorIter < searchLimit and anchorIter > iter', () => {
            const iter = 1000;
            const anchorIter = 2000;
            const searchLimit = 5000;
            const expected = Math.floor(anchorIter * 1.25);
            expect(calculateUpgradedIter(iter, anchorIter, searchLimit)).toBe(expected);
        });

        it('should return iter when anchorIter < searchLimit and anchorIter <= iter', () => {
            const iter = 1000;
            const anchorIter = 500;
            const searchLimit = 5000;
            expect(calculateUpgradedIter(iter, anchorIter, searchLimit)).toBe(iter);
        });

        it('should clamp iterations to a maximum of 2,500,000', () => {
            const iter = 1000000;
            const anchorIter = 2000000;
            const searchLimit = 2000000;
            // floor(2,000,000 * 1.5) = 3,000,000
            expect(calculateUpgradedIter(iter, anchorIter, searchLimit)).toBe(2500000);
        });
    });
});
