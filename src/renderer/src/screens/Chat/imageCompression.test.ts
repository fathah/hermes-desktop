import { afterEach, expect, it, vi } from "vitest";
import { compressImageToFit } from "./attachmentUtils";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockImageEncoding(maxWidth: number): void {
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 256;
      naturalHeight = 256;
      onload: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
  ) {
    callback(
      new Blob([new Uint8Array(this.width <= maxWidth ? 80 : 200)], { type }),
    );
  });
}

it("continues downsampling while the next actual dimensions exceed the minimum", async () => {
  mockImageEncoding(110);
  const file = new File([new Uint8Array(500)], "transparent.png", {
    type: "image/png",
  });
  const result = await compressImageToFit(file, 100);
  expect(result.size).toBe(80);
  expect(result.type).toBe("image/png");
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(5);
});

it("still refuses compression that would need a sub-64-pixel thumbnail", async () => {
  mockImageEncoding(32);
  const file = new File([new Uint8Array(500)], "transparent.png", {
    type: "image/png",
  });
  await expect(compressImageToFit(file, 100)).rejects.toThrow(
    "image-uncompressible",
  );
});
