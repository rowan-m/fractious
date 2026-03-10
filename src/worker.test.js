import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../wasm/pkg/fractious_lib.js', () => {
    return {
        default: vi.fn().mockResolvedValue(),
        find_best_anchor: vi.fn().mockImplementation(() => {
            throw new Error('Test Wasm Error');
        }),
        calculate_reference: vi.fn(),
    };
});

describe('Worker error handling', () => {
    let mockSelf;

    beforeEach(async () => {
        mockSelf = {
            onmessage: null,
            postMessage: vi.fn(),
        };
        vi.stubGlobal('self', mockSelf);

        // Mock console.error to keep test output clean
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should catch errors and post an error message', async () => {
        // Dynamically import to ensure self is mocked before evaluation
        await import('./worker.js');

        // Trigger the message handler
        const event = {
            data: {
                type: 'calculate_reference',
                payload: {
                    centerX: "0",
                    centerY: "0",
                    scale: 1,
                    aspect: 1,
                    iter: 100,
                    abortBuffer: null
                }
            }
        };

        // Call the handler and wait for it to complete
        await mockSelf.onmessage(event);

        expect(console.error).toHaveBeenCalledWith("Worker error:", expect.any(Error));
        expect(mockSelf.postMessage).toHaveBeenCalledWith({
            type: 'error',
            error: 'Error: Test Wasm Error'
        });
    });
});
