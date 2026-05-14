import assert from "node:assert/strict";
import { test } from "node:test";
import { createUpdaterEvent, createUpdaterProgressEvent } from "./updater-events.ts";

test("normalizes update info for renderer events", () => {
  const event = createUpdaterEvent("available", {
    version: "1.2.3",
    releaseName: "Fello 1.2.3",
    releaseDate: "2026-05-14T00:00:00.000Z",
  }, true);

  assert.deepEqual(event, {
    type: "available",
    manual: true,
    info: {
      version: "1.2.3",
      releaseName: "Fello 1.2.3",
      releaseDate: "2026-05-14T00:00:00.000Z",
    },
  });
});

test("normalizes download progress for renderer events", () => {
  const event = createUpdaterProgressEvent({
    percent: 42.34,
    transferred: 1234,
    total: 5678,
    bytesPerSecond: 9012,
  });

  assert.deepEqual(event, {
    type: "download-progress",
    percent: 42.3,
    transferred: 1234,
    total: 5678,
    bytesPerSecond: 9012,
  });
});
