import { describe, expect, it } from "vitest";
import { detectProviderFromUrl } from "../src/renderer/src/screens/Models/detect-provider";

describe("detectProviderFromUrl", () => {
  it("returns null for empty input", () => {
    expect(detectProviderFromUrl("")).toBeNull();
    expect(detectProviderFromUrl("   ")).toBeNull();
  });

  it("identifies hosted providers by hostname", () => {
    expect(detectProviderFromUrl("https://openrouter.ai/api/v1")).toBe(
      "openrouter",
    );
    expect(detectProviderFromUrl("https://api.anthropic.com")).toBe(
      "anthropic",
    );
    expect(detectProviderFromUrl("https://api.openai.com/v1")).toBe("openai");
    expect(detectProviderFromUrl("https://api.aimlapi.com/v1")).toBe("aimlapi");
    expect(
      detectProviderFromUrl("https://generativelanguage.googleapis.com/v1beta"),
    ).toBe("google");
    expect(detectProviderFromUrl("https://api.x.ai/v1")).toBe("xai");
    expect(detectProviderFromUrl("https://api.xiaomimimo.com/v1")).toBe(
      "xiaomi",
    );
    expect(
      detectProviderFromUrl("https://inference-api.nousresearch.com/v1"),
    ).toBe("nous");
    expect(
      detectProviderFromUrl(
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      ),
    ).toBe("qwen");
    expect(detectProviderFromUrl("https://api.minimax.chat/v1")).toBe(
      "minimax",
    );
  });

  it("identifies well-known local provider ports by provider", () => {
    expect(detectProviderFromUrl("http://localhost:11434")).toBe("ollama");
    expect(detectProviderFromUrl("http://127.0.0.1:11434/v1")).toBe("ollama");
    expect(detectProviderFromUrl("http://192.168.1.50:11434")).toBe("ollama");
    expect(detectProviderFromUrl("http://10.0.0.5:8000")).toBe("vllm");
    expect(detectProviderFromUrl("http://172.20.0.3:1234")).toBe("lmstudio");
    expect(detectProviderFromUrl("http://hermes.local:8080")).toBe("llamacpp");
  });

  it("identifies private-network and loopback addresses with unknown ports as custom", () => {
    expect(detectProviderFromUrl("http://localhost:9999")).toBe("custom");
    expect(detectProviderFromUrl("http://192.168.1.50:9999")).toBe("custom");
    expect(detectProviderFromUrl("http://hermes.local:9999")).toBe("custom");
  });

  it("identifies well-known local-LLM ports on any host", () => {
    // Ollama on a LAN VM with a public-looking hostname
    expect(
      detectProviderFromUrl("http://ollama.andrea-house.com:11434/v1"),
    ).toBe("ollama");
    // LM Studio
    expect(
      detectProviderFromUrl("http://my-workstation.example.com:1234/v1"),
    ).toBe("lmstudio");
    // Atomic Chat
    expect(detectProviderFromUrl("http://atomic-box.example.com:1337/v1")).toBe(
      "atomicchat",
    );
    // vLLM
    expect(detectProviderFromUrl("http://gpu-rig.example.com:8000")).toBe(
      "vllm",
    );
    // llama.cpp server
    expect(detectProviderFromUrl("http://llama.example.com:8080")).toBe(
      "llamacpp",
    );
  });

  it("excludes 172.x outside the RFC1918 range", () => {
    expect(detectProviderFromUrl("http://172.15.0.1:11434")).toBe("ollama"); // port hits
    expect(detectProviderFromUrl("http://172.32.0.1:9999")).toBeNull();
  });

  it("returns null for unknown public URLs without a local-LLM port", () => {
    expect(detectProviderFromUrl("https://example.com/v1")).toBeNull();
    expect(detectProviderFromUrl("https://api.example.com:443")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(detectProviderFromUrl("HTTPS://API.OPENAI.COM")).toBe("openai");
    expect(detectProviderFromUrl("HTTP://LOCALHOST:11434")).toBe("ollama");
  });

  it("tolerates bare host:port without a scheme", () => {
    expect(detectProviderFromUrl("localhost:1234")).toBe("lmstudio");
    expect(detectProviderFromUrl("192.168.1.10:8080")).toBe("llamacpp");
  });
});
