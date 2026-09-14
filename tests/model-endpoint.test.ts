import { describe, expect, it } from "vitest";
import { normalizeModelEndpointUrl } from "../src/shared/model-endpoint";

describe("model endpoint identity", () => {
  it("normalizes scheme, host, default port, and trailing path slashes", () => {
    expect(normalizeModelEndpointUrl(" HTTPS://API.EXAMPLE:443/v1/ ")).toBe(
      "https://api.example/v1",
    );
  });

  it("preserves case-sensitive path, query, and credential components", () => {
    expect(
      normalizeModelEndpointUrl(
        "https://User:Secret@API.EXAMPLE/v1/TenantA?Key=Value#Route",
      ),
    ).toBe("https://User:Secret@api.example/v1/TenantA?Key=Value#Route");
    expect(
      normalizeModelEndpointUrl("https://api.example/v1/TenantA"),
    ).not.toBe(normalizeModelEndpointUrl("https://API.EXAMPLE/v1/tenanta"));
  });

  it("keeps invalid opaque values case-sensitive while trimming slashes", () => {
    expect(normalizeModelEndpointUrl(" Endpoint/TenantA/ ")).toBe(
      "Endpoint/TenantA",
    );
  });

  it("keeps IPv6 hosts valid", () => {
    expect(normalizeModelEndpointUrl("HTTPS://[2001:DB8::1]:8443/v1/")).toBe(
      "https://[2001:db8::1]:8443/v1",
    );
  });
});
