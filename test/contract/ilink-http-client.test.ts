import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ILinkHttpClient } from "../../src/adapters/outbound/ilink/ilink-http-client.js";

interface SeenRequest {
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function fakeServer(handler: (request: SeenRequest, response: ServerResponse) => void): Promise<string> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      handler({ url: request.url ?? "", headers: request.headers, body: raw ? JSON.parse(raw) as unknown : undefined }, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("unexpected server address");
  return `http://127.0.0.1:${address.port}/`;
}

describe("ILinkHttpClient", () => {
  it("passes the opaque cursor and maps a text update", async () => {
    let seen: SeenRequest | undefined;
    const baseUrl = await fakeServer((request, response) => {
      seen = request;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ret: 0,
        get_updates_buf: "next/opaque==",
        msgs: [{
          seq: 7,
          message_id: 42,
          from_user_id: "user-1",
          message_type: 1,
          create_time_ms: 1_700_000_000_000,
          context_token: "secret-context",
          item_list: [{ type: 1, text_item: { text: "hello" } }],
        }],
      }));
    });
    const client = new ILinkHttpClient({ baseUrl, botToken: "secret", mediaDir: "/tmp/wechat-pi-agent-test-media" });
    const batch = await client.getUpdates("bot-1", "cursor/opaque==", new AbortController().signal);

    expect(seen?.url).toBe("/ilink/bot/getupdates");
    expect(seen?.headers.authorization).toBe("Bearer secret");
    expect(seen?.body).toMatchObject({ get_updates_buf: "cursor/opaque==" });
    expect(batch.nextCursor).toBe("next/opaque==");
    expect(batch.messages).toHaveLength(1);
    expect(batch.messages[0]).toMatchObject({ channelMessageId: "42", senderId: "user-1", text: "hello", contextToken: "secret-context" });
  });

  it("reuses stable client and run ids when sending", async () => {
    let seen: SeenRequest | undefined;
    const baseUrl = await fakeServer((request, response) => {
      seen = request;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ret: 0 }));
    });
    const client = new ILinkHttpClient({ baseUrl, botToken: "secret", mediaDir: "/tmp/wechat-pi-agent-test-media" });
    await client.sendText({
      id: "out-1",
      turnId: "turn-1",
      accountId: "bot-1",
      peerId: "user-1",
      contextToken: "context",
      chunkIndex: 0,
      text: "reply",
      clientId: "stable-client",
      runId: "stable-run",
    }, new AbortController().signal);

    expect(seen?.url).toBe("/ilink/bot/sendmessage");
    expect(seen?.body).toMatchObject({
      msg: {
        to_user_id: "user-1",
        context_token: "context",
        client_id: "stable-client",
        run_id: "stable-run",
        item_list: [{ type: 1, text_item: { text: "reply" } }],
      },
    });
  });
});
