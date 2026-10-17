import { test } from "node:test";
import assert from "node:assert";
import { createApp } from "../src/server.js";
import { AddressInfo } from "node:net";

const server = createApp();

server.listen(0, () => {
  console.log(
    `server listen on port ${(server.address() as AddressInfo).port}`,
  );
});

test("health endpoint pass", async () => {
  try {
    const health = await fetch(
      `http://localhost:${(server.address() as AddressInfo).port}/health`,
    );
    assert.strictEqual(health.status,'200');
  } finally {
    server.close();
  }
});
