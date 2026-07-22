import { afterEach, describe, expect, it } from "vitest";
import { getHccApiBaseUrl } from "../src/main/hcc";

// @lat: [[hcc-os#Endpoint ownership]]
describe("HCC API endpoint ownership", () => {
  const original = process.env.HCC_API_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.HCC_API_URL;
    else process.env.HCC_API_URL = original;
  });

  it("defaults to the command-center API independently of Hermes remote mode", () => {
    delete process.env.HCC_API_URL;
    expect(getHccApiBaseUrl()).toBe("http://127.0.0.1:9200");
  });

  it("accepts an explicit HCC endpoint and removes trailing slashes", () => {
    process.env.HCC_API_URL = "https://hcc.example.test///";
    expect(getHccApiBaseUrl()).toBe("https://hcc.example.test");
  });
});
