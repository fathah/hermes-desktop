import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import {
  remoteAddModel,
  remoteGetModelConfig,
  remoteListModels,
  remoteRemoveModel,
  remoteSetModelConfig,
  remoteUpdateModel,
} from "../src/main/remote-models";

let server: http.Server | null = null;

function startServer(
  handler: http.RequestListener,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (!address || typeof address === "string") {
        throw new Error("Unexpected server address");
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server!.close(() => done())),
      });
    });
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe("remote dashboard models", () => {
  it("reads configured rows from /api/model/library", async () => {
    const { url } = await startServer((req, res) => {
      expect(req.headers["x-hermes-session-token"]).toBe("token");
      expect(req.url).toBe("/api/model/library");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          models: [
            {
              id: "remote:active:custom:deepseek-v4-pro",
              name: "DeepSeek V4 Pro",
              provider: "custom",
              model: "deepseek-v4-pro",
              baseUrl: "https://api.deepseek.com/v1",
              createdAt: 0,
            },
            {
              id: "bad",
              provider: "",
              model: "ignored",
            },
          ],
        }),
      );
    });

    const models = await remoteListModels({ remoteUrl: url, apiKey: "token" });
    expect(models).toEqual([
      {
        id: "remote:active:custom:deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider: "custom",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com/v1",
        createdAt: 0,
      },
    ]);
  });

  it("falls back to a configured-only /api/model/options view for older remotes", async () => {
    const { url } = await startServer((req, res) => {
      expect(req.headers["x-hermes-session-token"]).toBe("token");
      if (req.url === "/api/model/library") {
        res.statusCode = 404;
        res.end("missing");
        return;
      }
      expect(req.url).toBe("/api/model/options");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          provider: "custom",
          model: "deepseek-v4-pro",
          providers: [
            {
              slug: "nous",
              name: "Nous Portal",
              authenticated: true,
              models: Array.from({ length: 26 }, (_, i) => `nous-${i}`),
              total_models: 26,
            },
            {
              slug: "openai-codex",
              name: "OpenAI Codex",
              authenticated: true,
              models: ["gpt-5.5"],
              total_models: 1,
            },
            {
              slug: "my-endpoint",
              name: "My Endpoint",
              is_user_defined: true,
              source: "user-config",
              api_url: "http://remote/v1",
              models: ["local-model"],
              total_models: 1,
            },
          ],
        }),
      );
    });

    const models = await remoteListModels({ remoteUrl: url, apiKey: "token" });
    expect(models.map((model) => `${model.provider}/${model.model}`)).toEqual([
      "custom/deepseek-v4-pro",
      "my-endpoint/local-model",
    ]);
    expect(models.some((model) => model.provider === "nous")).toBe(false);
    expect(models.some((model) => model.provider === "openai-codex")).toBe(
      false,
    );
  });

  it("reads the remote current model and writes changes through dashboard REST", async () => {
    const seenBodies: unknown[] = [];
    let current = {
      provider: "openai-codex",
      model: "gpt-5.5",
      baseUrl: "https://chatgpt.com/backend-api/codex",
    };
    const { url } = await startServer((req, res) => {
      if (req.url === "/api/model/library") {
        res.statusCode = 404;
        res.end(JSON.stringify({ detail: "not found" }));
        return;
      }
      if (req.url === "/api/model/options") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            provider: current.provider,
            model: current.model,
            providers: [
              {
                slug: current.provider,
                api_url: current.baseUrl,
                models: [current.model],
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/api/model/set" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          seenBodies.push(parsed);
          current = {
            provider: parsed.provider,
            model: parsed.model,
            baseUrl: parsed.base_url,
          };
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await expect(
      remoteGetModelConfig({ remoteUrl: url, apiKey: "token" }),
    ).resolves.toEqual({
      provider: "openai-codex",
      model: "gpt-5.5",
      baseUrl: "https://chatgpt.com/backend-api/codex",
    });

    await expect(
      remoteSetModelConfig(
        { remoteUrl: url, apiKey: "token" },
        "custom",
        "deepseek-v4-pro",
        "https://api.deepseek.com/v1",
      ),
    ).resolves.toBe(true);
    expect(seenBodies).toEqual([
      {
        scope: "main",
        provider: "custom",
        model: "deepseek-v4-pro",
        base_url: "https://api.deepseek.com/v1",
      },
    ]);
  });

  it("writes configured model rows through dashboard REST", async () => {
    const seen: Array<{ url?: string; method?: string; body?: unknown }> = [];
    const { url } = await startServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        seen.push({
          url: req.url,
          method: req.method,
          body: body ? JSON.parse(body) : undefined,
        });
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/api/model/library" && req.method === "POST") {
          res.end(
            JSON.stringify({
              id: "remote:library:1",
              name: "Local DeepSeek",
              provider: "custom",
              model: "deepseek-v4-pro",
              baseUrl: "https://api.deepseek.com/v1",
              createdAt: 123,
            }),
          );
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await expect(
      remoteAddModel(
        { remoteUrl: url, apiKey: "token" },
        "Local DeepSeek",
        "custom",
        "deepseek-v4-pro",
        "https://api.deepseek.com/v1",
      ),
    ).resolves.toEqual({
      id: "remote:library:1",
      name: "Local DeepSeek",
      provider: "custom",
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.com/v1",
      createdAt: 123,
    });
    await expect(
      remoteUpdateModel(
        { remoteUrl: url, apiKey: "token" },
        "remote:library:1",
        { name: "Renamed", provider: "custom", model: "deepseek-v4-pro" },
      ),
    ).resolves.toBe(true);
    await expect(
      remoteRemoveModel(
        { remoteUrl: url, apiKey: "token" },
        "remote:library:1",
      ),
    ).resolves.toBe(true);

    expect(seen).toEqual([
      {
        url: "/api/model/library",
        method: "POST",
        body: {
          name: "Local DeepSeek",
          provider: "custom",
          model: "deepseek-v4-pro",
          baseUrl: "https://api.deepseek.com/v1",
        },
      },
      {
        url: "/api/model/library/remote%3Alibrary%3A1",
        method: "PATCH",
        body: {
          name: "Renamed",
          provider: "custom",
          model: "deepseek-v4-pro",
        },
      },
      {
        url: "/api/model/library/remote%3Alibrary%3A1",
        method: "DELETE",
        body: undefined,
      },
    ]);
  });

  it("preserves the active custom model base URL from the remote library", async () => {
    const { url } = await startServer((req, res) => {
      expect(req.headers["x-hermes-session-token"]).toBe("token");
      if (req.url === "/api/model/library") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            models: [
              {
                id: "remote:active:custom:deepseek-v4-pro",
                provider: "custom",
                model: "deepseek-v4-pro",
                baseUrl: "https://api.deepseek.com/v1",
              },
            ],
          }),
        );
        return;
      }
      throw new Error(`unexpected request ${req.url}`);
    });

    await expect(
      remoteGetModelConfig({ remoteUrl: url, apiKey: "token" }),
    ).resolves.toEqual({
      provider: "custom",
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.com/v1",
    });
  });

  it("does not replace the active model when the remote library add endpoint is missing", async () => {
    const seen: Array<{ url?: string; method?: string; body?: unknown }> = [];
    const { url } = await startServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        seen.push({
          url: req.url,
          method: req.method,
          body: body ? JSON.parse(body) : undefined,
        });
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/api/model/library" && req.method === "POST") {
          res.statusCode = 404;
          res.end(JSON.stringify({ detail: "not found" }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ detail: "not found" }));
      });
    });

    await expect(
      remoteAddModel(
        { remoteUrl: url, apiKey: "token" },
        "DeepSeek Pro",
        "custom",
        "deepseek-v4-pro",
        "https://api.deepseek.com/v1",
      ),
    ).rejects.toThrow();

    expect(seen).toEqual([
      {
        url: "/api/model/library",
        method: "POST",
        body: {
          name: "DeepSeek Pro",
          provider: "custom",
          model: "deepseek-v4-pro",
          baseUrl: "https://api.deepseek.com/v1",
        },
      },
    ]);
  });
});
