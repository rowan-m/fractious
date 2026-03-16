import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPostMessage = vi.fn();
const mockSelf = {
  postMessage: mockPostMessage,
  onmessage: null,
};

vi.stubGlobal("self", mockSelf);

// Mock the wasm dependency to throw an error
vi.mock("../wasm/pkg/fractious_lib.js", () => {
  return {
    default: vi.fn().mockResolvedValue(), // init
    find_best_anchor: vi.fn().mockImplementation(() => {
      throw new Error("Test worker error");
    }),
    calculate_reference: vi.fn(),
  };
});

describe("worker.js", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should catch errors and post an error message", async () => {
    // Dynamically import worker.js so it registers `self.onmessage` after mocking
    await import("./worker.js");

    const messageEvent = {
      data: {
        type: "calculate_reference",
        payload: {
          centerX: 0,
          centerY: 0,
          scale: 1,
          aspect: 1,
          iter: 100,
        },
      },
    };

    // Suppress console.error for the expected error to keep test output clean
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Call the worker's onmessage handler
    await self.onmessage(messageEvent);

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "error",
      error: "Error: Test worker error",
    });

    consoleErrorSpy.mockRestore();
  });
});
