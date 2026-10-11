import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/main/config", () => ({ getConfigValue: vi.fn() }));
vi.mock("../src/main/secrets", () => ({ getSecret: vi.fn() }));

import { getConfigValue } from "../src/main/config";
import { getSecret } from "../src/main/secrets";
import { synthesizeMiniMaxSpeech } from "../src/main/minimax-speech";

const mockedGetConfigValue = vi.mocked(getConfigValue);
const mockedGetSecret = vi.mocked(getSecret);

describe("synthesizeMiniMaxSpeech", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    mockedGetConfigValue.mockReset();
    mockedGetSecret.mockReset();
    mockedGetSecret.mockImplementation((key) =>
      key === "MINIMAX_API_KEY" ? "global-key" : null,
    );
  });

  it("uses the current default model and decodes a successful response", async () => {
    // @lat: [[speech-playback-tests#MiniMax encoded request]]
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { audio: "0001ff", status: 2 },
            base_resp: { status_code: 0 },
          }),
          { status: 200 },
        ),
    );

    await expect(
      synthesizeMiniMaxSpeech(" Hello ", undefined, fetchMock),
    ).resolves.toEqual({
      audio: new Uint8Array([0, 1, 255]),
      mimeType: "audio/mpeg",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.minimax.io/v1/t2a_v2");
    expect(init?.headers).toEqual({
      Authorization: "Bearer global-key",
      "Content-Type": "application/json",
    });
    expect(mockedGetSecret).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "speech-2.8-hd",
      text: "Hello",
      output_format: "hex",
      voice_setting: { voice_id: "English_expressive_narrator" },
      audio_setting: { format: "mp3" },
    });
  });

  it("keeps the China endpoint bound to the China credential", async () => {
    // @lat: [[speech-playback-tests#Regional key binding]]
    mockedGetConfigValue.mockImplementation((key) =>
      key === "tts.minimax.region" ? "cn" : null,
    );
    mockedGetSecret.mockImplementation((key) =>
      key === "MINIMAX_CN_API_KEY" ? "china-key" : null,
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { audio: "cafe", status: 2 },
            base_resp: { status_code: 0 },
          }),
          { status: 200 },
        ),
    );

    await synthesizeMiniMaxSpeech("Hello", "work", fetchMock);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.minimaxi.com/v1/t2a_v2",
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer china-key",
    });
  });

  it("surfaces API errors without returning response audio", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { status: 1 },
            base_resp: { status_code: 1004, status_msg: "Invalid request" },
          }),
          { status: 200 },
        ),
    );

    await expect(
      synthesizeMiniMaxSpeech("Hello", undefined, fetchMock),
    ).rejects.toThrow("MiniMax speech failed: Invalid request");
  });
});

// @lat: [[speech-playback-tests#Bounded cancellation]]
it("bounds an unresponsive fetch/body and aborts the vendor request on Stop", async () => {
  vi.useFakeTimers();
  mockedGetConfigValue.mockReset();
  mockedGetSecret.mockReturnValue("key");
  let signal!: AbortSignal;
  const fetchMock = vi.fn((_url, init) => {
    signal = init.signal;
    return new Promise<Response>(() => {});
  });
  const controller = new AbortController();
  const cancelled = synthesizeMiniMaxSpeech(
    "hello",
    "work",
    fetchMock,
    controller.signal,
  );
  const cancellation = expect(cancelled).rejects.toThrow("cancelled");
  controller.abort();
  await cancellation;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const hung = synthesizeMiniMaxSpeech("hello", "work", fetchMock);
  const timeout = expect(hung).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(45_000);
  await timeout;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const body = synthesizeMiniMaxSpeech(
    "hello",
    "work",
    vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }),
  );
  const bodyTimeout = expect(body).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(45_000);
  await bodyTimeout;
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

// @lat: [[speech-playback-tests#Playable formats and invalid responses]]
it("accepts encoded mp3/wav/flac and rejects PCM, invalid region, oversized text and malformed replies", async () => {
  mockedGetSecret.mockReturnValue("key");
  for (const [format, mimeType] of [
    ["mp3", "audio/mpeg"],
    ["wav", "audio/wav"],
    ["flac", "audio/flac"],
  ]) {
    mockedGetConfigValue.mockImplementation((key) =>
      key === "tts.minimax.format" ? format : null,
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { audio: "0102" },
          base_resp: { status_code: 0 },
        }),
      ),
    );
    await expect(
      synthesizeMiniMaxSpeech("hello", "work", fetchMock),
    ).resolves.toMatchObject({ mimeType });
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body).audio_setting.format,
    ).toBe(format);
  }
  const fetchMock = vi.fn();
  mockedGetConfigValue.mockImplementation((key) =>
    key === "tts.minimax.format" ? "pcm" : null,
  );
  await expect(
    synthesizeMiniMaxSpeech("hello", "work", fetchMock),
  ).rejects.toThrow("raw PCM");
  mockedGetConfigValue.mockImplementation((key) =>
    key === "tts.minimax.region" ? "invalid" : null,
  );
  await expect(
    synthesizeMiniMaxSpeech("hello", "work", fetchMock),
  ).rejects.toThrow("region");
  await expect(
    synthesizeMiniMaxSpeech("a".repeat(10_000), "work", fetchMock),
  ).rejects.toThrow("shorter");
  expect(fetchMock).not.toHaveBeenCalled();
  mockedGetConfigValue.mockReset();
  for (const response of [
    new Response("HTML", { status: 503 }),
    new Response("HTML"),
    new Response("null"),
    new Response(
      JSON.stringify({ data: { audio: "xyz" }, base_resp: { status_code: 0 } }),
    ),
  ]) {
    await expect(
      synthesizeMiniMaxSpeech(
        "hello",
        "work",
        vi.fn().mockResolvedValue(response),
      ),
    ).rejects.toThrow();
  }
});
