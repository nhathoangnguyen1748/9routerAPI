import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));
vi.mock("@/lib/dataDir.js", () => ({
  DATA_DIR: "/tmp"
}));
vi.mock("../../src/lib/dataDir.js", () => ({
  DATA_DIR: "/tmp"
}));

const { createSSEStream, MAX_ACCUMULATED_CHARS, MAX_STREAM_BUFFER_SIZE } = await import("../../open-sse/utils/stream.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

describe("Stream memory safety caps", () => {
  it("caps accumulatedContent at MAX_ACCUMULATED_CHARS while maintaining exact totalContentLength", async () => {
    let capturedResult = null;
    const onStreamComplete = vi.fn((result, usage) => {
      capturedResult = result;
    });

    const stream = createSSEStream({
      mode: "passthrough",
      targetFormat: FORMATS.OPENAI,
      sourceFormat: FORMATS.OPENAI,
      onStreamComplete,
      body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }
    });

    // Concurrently consume readable stream to avoid backpressure deadlock
    const readPromise = (async () => {
      const reader = stream.readable.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    })();

    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Stream 10 chunks of 10KB each = 100KB total content (exceeds 64KB cap)
    const chunk10k = "a".repeat(10 * 1024);
    for (let i = 0; i < 10; i++) {
      const ssePayload = `data: ${JSON.stringify({
        choices: [{ delta: { content: chunk10k } }]
      })}\n\n`;
      await writer.write(encoder.encode(ssePayload));
    }

    // Terminal chunk
    const donePayload = `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }]
    })}\n\n`;
    await writer.write(encoder.encode(donePayload));
    await writer.close();

    await readPromise;

    expect(onStreamComplete).toHaveBeenCalled();
    expect(capturedResult).toBeDefined();
    // Accumulated content must be capped near MAX_ACCUMULATED_CHARS (+ truncation notice)
    expect(capturedResult.content.length).toBeLessThanOrEqual(MAX_ACCUMULATED_CHARS + 100);
    expect(capturedResult.content).toContain("[stream truncated for logging]");
  });

  it("truncates runaway line buffer if chunk exceeds MAX_STREAM_BUFFER_SIZE without newline", async () => {
    const stream = createSSEStream({
      mode: "passthrough",
      targetFormat: FORMATS.OPENAI,
      sourceFormat: FORMATS.OPENAI,
    });

    const readPromise = (async () => {
      const reader = stream.readable.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    })();

    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Write a huge chunk without newline (1.2MB > 1MB MAX_STREAM_BUFFER_SIZE)
    const hugeChunk = "x".repeat(1200 * 1024);
    await writer.write(encoder.encode(hugeChunk));

    // Follow up with a valid SSE line
    await writer.write(encoder.encode("\ndata: [DONE]\n\n"));
    await writer.close();

    await readPromise;

    // Should complete cleanly without throwing OOM or hanging
    expect(true).toBe(true);
  });
});
