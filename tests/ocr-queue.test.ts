import { describe, it, expect, beforeEach } from "vitest";
import {
  loadOcrQueue,
  enqueueOcrJob,
  removeOcrJob,
  peekOcrJob,
} from "../src/renderer/src/screens/SpsAgent/lib/ocrQueue";

// Persistent OCR job queue (item 2, P2). jsdom provides localStorage; the queue
// is what makes a scanned-PDF batch survive restarts and drain sequentially.

const job = (id: string, filePath: string, title = id) => ({
  id,
  filePath,
  title,
  pageCount: 3,
  addedAt: 1,
});

describe("ocrQueue", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadOcrQueue()).toEqual([]);
    expect(peekOcrJob()).toBeNull();
  });

  it("enqueues FIFO and peeks the head", () => {
    enqueueOcrJob(job("a", "/a.pdf"));
    enqueueOcrJob(job("b", "/b.pdf"));
    expect(loadOcrQueue().map((j) => j.id)).toEqual(["a", "b"]);
    expect(peekOcrJob()?.id).toBe("a");
  });

  it("dedupes by filePath (a double-import doesn't queue twice)", () => {
    enqueueOcrJob(job("a", "/same.pdf"));
    enqueueOcrJob(job("a2", "/same.pdf"));
    expect(loadOcrQueue().map((j) => j.filePath)).toEqual(["/same.pdf"]);
    expect(loadOcrQueue()[0].id).toBe("a2"); // re-queue replaces in place at tail
  });

  it("removes by id and persists across reloads", () => {
    enqueueOcrJob(job("a", "/a.pdf"));
    enqueueOcrJob(job("b", "/b.pdf"));
    removeOcrJob("a");
    // simulate a "restart": loadOcrQueue reads the same localStorage
    expect(loadOcrQueue().map((j) => j.id)).toEqual(["b"]);
    expect(peekOcrJob()?.id).toBe("b");
  });
});
