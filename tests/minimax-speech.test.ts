import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/main/config", () => ({ getConfigValue: vi.fn() }));
vi.mock("../src/main/secrets", () => ({ getSecret: vi.fn() }));

import { getConfigValue } from "../src/main/config";
import { getSecret } from "../src/main/secrets";
import { synthesizeMiniMaxSpeech } from "../src/main/minimax-speech";

const mockedGetConfigValue = vi.mocked(getConfigValue);
const mockedGetSecret = vi.mocked(getSecret);

describe("synthesizeMiniMaxSpeech", () => {
  beforeEach(() => {
    mockedGetConfigValue.mockReset();
    mockedGetSecret.mockReset();
    mockedGetSecret.mockImplementation((key) =>
      key === "MINIMAX_API_KEY" ? "global-key" : null,
    );
  });

  it("uses the current default model and decodes a successful response", async () => {
    // @lat: [[main-process#MiniMax speech synthesis]]
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
    // @lat: [[main-process#MiniMax speech synthesis]]
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
