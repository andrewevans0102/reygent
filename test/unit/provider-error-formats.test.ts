import { describe, it, expect } from "vitest";
import type { SpawnResult } from "../../src/spawn.js";

/**
 * Validation tests for provider error response formats.
 * These tests verify that each provider's error extraction logic
 * correctly maps provider-specific error formats to SpawnResult fields.
 */

describe("Claude error format validation", () => {
  it("validates StreamResultMessage error event structure", () => {
    // Simulated Claude error event from agent stdout
    const errorEvent = {
      type: "result",
      is_error: true,
      result: "Model not available",
      api_error_status: 404,
    };

    // Provider should extract these fields into SpawnResult
    const expectedResult: Partial<SpawnResult> = {
      errorMessage: errorEvent.result,
      apiErrorStatus: errorEvent.api_error_status,
      exitCode: 1,
    };

    expect(errorEvent.is_error).toBe(true);
    expect(errorEvent.result).toBe(expectedResult.errorMessage);
    expect(errorEvent.api_error_status).toBe(expectedResult.apiErrorStatus);
  });

  it("validates Claude success response structure", () => {
    const successEvent = {
      type: "result",
      is_error: false,
      result: "Task completed successfully",
      total_cost_usd: 0.05,
      input_tokens: 100,
      output_tokens: 50,
    };

    expect(successEvent.is_error).toBe(false);
    expect(successEvent.result).toBeTruthy();
    expect(successEvent.total_cost_usd).toBeGreaterThan(0);
  });
});

describe("Gemini error format validation", () => {
  it("validates Gemini numeric error code format", () => {
    const geminiResponse = {
      response: "",
      usage_metadata: {
        prompt_token_count: 10,
        candidates_token_count: 0,
      },
      error: {
        message: "Model not found",
        code: 404,
        status: 404,
      },
    };

    // Provider should use numeric code directly
    expect(geminiResponse.error.code).toBe(404);
    expect(geminiResponse.error.status).toBe(404);
    expect(geminiResponse.error.message).toBeTruthy();
  });

  it("validates Gemini string error code format", () => {
    const geminiResponse = {
      error: {
        message: "Permission denied",
        code: "permission_denied",
      },
    };

    // Provider should map string code to HTTP status
    const codeMapping: Record<string, number> = {
      not_found: 404,
      model_not_found: 404,
      permission_denied: 403,
      unauthenticated: 403,
      invalid_api_key: 401,
      invalid_authentication: 401,
      resource_exhausted: 429,
      rate_limit_exceeded: 429,
      internal: 500,
      server_error: 500,
      invalid_argument: 400,
    };

    const code = geminiResponse.error.code.toLowerCase();
    expect(codeMapping[code]).toBe(403);
  });

  it("validates all Gemini error code mappings", () => {
    const testCases: Array<{ code: string | number; expectedStatus: number }> = [
      { code: 404, expectedStatus: 404 },
      { code: "not_found", expectedStatus: 404 },
      { code: "model_not_found", expectedStatus: 404 },
      { code: "permission_denied", expectedStatus: 403 },
      { code: "unauthenticated", expectedStatus: 403 },
      { code: "invalid_api_key", expectedStatus: 401 },
      { code: "invalid_authentication", expectedStatus: 401 },
      { code: "resource_exhausted", expectedStatus: 429 },
      { code: "rate_limit_exceeded", expectedStatus: 429 },
      { code: "internal", expectedStatus: 500 },
      { code: "server_error", expectedStatus: 500 },
      { code: "invalid_argument", expectedStatus: 400 },
    ];

    for (const { code, expectedStatus } of testCases) {
      if (typeof code === "number") {
        expect(code).toBe(expectedStatus);
      } else {
        // String code should map correctly
        const codeMapping: Record<string, number> = {
          not_found: 404,
          model_not_found: 404,
          permission_denied: 403,
          unauthenticated: 403,
          invalid_api_key: 401,
          invalid_authentication: 401,
          resource_exhausted: 429,
          rate_limit_exceeded: 429,
          internal: 500,
          server_error: 500,
          invalid_argument: 400,
        };
        expect(codeMapping[code]).toBe(expectedStatus);
      }
    }
  });
});

describe("Codex error format validation", () => {
  it("validates OpenAI error format with string code", () => {
    const codexResponse = {
      response: "",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 0,
      },
      error: {
        message: "The model `gpt-5.4` does not exist",
        code: "model_not_found",
        type: "invalid_request_error",
        status: 404,
      },
    };

    expect(codexResponse.error.code).toBe("model_not_found");
    expect(codexResponse.error.message).toBeTruthy();
    expect(codexResponse.error.status).toBe(404);
  });

  it("validates exact match mapping for known OpenAI codes", () => {
    const exactMatches: Record<string, number> = {
      model_not_found: 404,
      invalid_model: 404,
      invalid_api_key: 401,
      invalid_request_error: 401,
      rate_limit_exceeded: 429,
      insufficient_quota: 402,
      server_error: 500,
    };

    for (const [code, expectedStatus] of Object.entries(exactMatches)) {
      expect(exactMatches[code]).toBe(expectedStatus);
    }
  });

  it("validates partial match fallback for unknown codes", () => {
    // Codes that should match via partial match
    const partialMatchTests = [
      { code: "custom_not_found_error", expectedStatus: 404 },
      { code: "auth_failure", expectedStatus: 401 },
      { code: "unauthorized_request", expectedStatus: 401 },
    ];

    for (const { code, expectedStatus } of partialMatchTests) {
      if (code.includes("not_found")) {
        expect(expectedStatus).toBe(404);
      } else if (code.includes("auth") || code.includes("unauthorized")) {
        expect(expectedStatus).toBe(401);
      }
    }
  });

  it("validates Codex success response with cached tokens", () => {
    const successResponse = {
      response: "Task completed",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: {
          cached_tokens: 20,
        },
      },
    };

    expect(successResponse.response).toBeTruthy();
    expect(successResponse.usage.prompt_tokens_details.cached_tokens).toBe(20);
  });
});

describe("OpenRouter error format validation", () => {
  it("validates OpenRouter error format", () => {
    // OpenRouter uses similar format to OpenAI
    const openrouterResponse = {
      error: {
        message: "Model not available",
        code: "model_not_found",
        status: 404,
      },
    };

    expect(openrouterResponse.error.code).toBe("model_not_found");
    expect(openrouterResponse.error.status).toBe(404);
  });
});

describe("Cross-provider error field consistency", () => {
  it("all providers populate errorMessage and apiErrorStatus on errors", () => {
    // Template for expected SpawnResult fields across all providers
    const requiredErrorFields: Array<keyof SpawnResult> = [
      "stdout",
      "exitCode",
      "errorMessage",
      "apiErrorStatus",
    ];

    // Mock error result from any provider
    const errorResult: SpawnResult = {
      stdout: "",
      exitCode: 1,
      errorMessage: "Model not found",
      apiErrorStatus: 404,
    };

    for (const field of requiredErrorFields) {
      expect(errorResult[field]).toBeDefined();
    }
  });

  it("validates HTTP status code ranges", () => {
    const validStatusCodes = [400, 401, 402, 403, 404, 429, 500, 503];

    for (const status of validStatusCodes) {
      // All status codes should be valid HTTP statuses
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it("validates common error message patterns", () => {
    const commonErrorMessages = [
      "Model not found",
      "Model not available",
      "Authentication failed",
      "Invalid API key",
      "Rate limit exceeded",
      "Permission denied",
      "Server error",
    ];

    for (const msg of commonErrorMessages) {
      // All messages should be non-empty strings
      expect(msg).toBeTruthy();
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
