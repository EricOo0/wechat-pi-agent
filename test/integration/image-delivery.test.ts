import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";
import { SQLITE_MIGRATIONS } from "../../src/adapters/sqlite/migrations.js";
import { DeliverReply, type Channel, type PreparedImage } from "../../src/modules/messaging/index.js";

const prepared: PreparedImage = { encryptQueryParam: "private-download-ref", aesKey: "private-aes-key", ciphertextSize: 32 };
describe("image Outbox delivery with SQLite", () => {
  let directory: string;
  let path: string;
  let store: SqliteControlPlane;
  let db: DatabaseSync;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "image-delivery-"));
    path = join(directory, "state.db");
    store = new SqliteControlPlane(path);
    store.migrate();
    db = new DatabaseSync(path);
  });
  it("keeps the image upload credential database private", () => {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(path + "-wal").mode & 0o777).toBe(0o600);
    expect(statSync(path + "-shm").mode & 0o777).toBe(0o600);
  });
  afterEach(() => { db.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });

  function seed(parts: ("text" | "image")[]) {
    store.ingestBatch({ accountId: "account", previousCursor: "", nextCursor: "1", messages: [{ id: "in", accountId: "account", channelMessageId: "remote", peerId: "peer", senderId: "sender", text: "send screenshot", receivedAt: new Date(), raw: {} }] });
    const turn = store.claimNextTurn("runner", 30_000)!;
    // Seed published rows directly: Task approval has separate TaskManager tests.
    store.completeTurn({ turnId: turn.turn.id, chunks: parts.map(p => p === "text" ? "caption" : ""), finalResponse: "caption" });
    db.prepare("INSERT INTO image_artifacts(id,owner_id,task_id,revision,source_turn_id,tool_call_id,bytes,sha256,mime_type,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("img", "owner", "task", 1, turn.turn.id, "call", 16, "sha", "image/png", 1, 1, new Date().toISOString());
    parts.forEach((part, i) => { if (part === "image") db.prepare("UPDATE outbox SET artifact_id='img' WHERE turn_id=? AND chunk_index=?").run(turn.turn.id, i); });
    return turn.turn.id;
  }
  function fakeChannel() {
    return {
      getUpdates: vi.fn<Channel["getUpdates"]>(), checkReady: vi.fn<Channel["checkReady"]>(),
      sendText: vi.fn<Channel["sendText"]>().mockResolvedValue({}),
      prepareImage: vi.fn<NonNullable<Channel["prepareImage"]>>().mockResolvedValue(prepared),
      sendPreparedImage: vi.fn<NonNullable<Channel["sendPreparedImage"]>>().mockResolvedValue({}),
      imageCredentialScope: vi.fn(() => "credential-a"),
    };
  }
  const loadImage = () => Promise.resolve({ data: Buffer.alloc(16), mimeType: "image/png" as const });

  it("preserves text-before-image ordering across retries and hides persisted media refs from inspection", async () => {
    const turnId = seed(["text", "image"]);
    const channel = fakeChannel();
    channel.sendText.mockRejectedValueOnce(new Error("temporary"));
    const worker = new DeliverReply(store, channel, { ownerId: "worker", loadImage, retryDelaysMs: [0] });
    expect((await worker.execute()).status).toBe("retry_scheduled");
    expect(channel.prepareImage).not.toHaveBeenCalled();
    expect((await worker.execute()).status).toBe("sent");
    expect((await worker.execute()).status).toBe("sent");
    expect(channel.prepareImage).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT status FROM turns WHERE id=?").get(turnId)?.status).toBe("SUCCEEDED");
    const details = JSON.stringify(store.getTurnDetails(turnId));
    expect(details).not.toContain(prepared.aesKey);
    expect(details).not.toContain(prepared.encryptQueryParam);
  });

  it("persists successful upload across process restarts and reuploads only when credential scope changes", async () => {
    seed(["image"]);
    const first = fakeChannel();
    first.sendPreparedImage.mockRejectedValueOnce(new Error("send unavailable"));
    expect((await new DeliverReply(store, first, { ownerId: "one", loadImage, retryDelaysMs: [0] }).execute()).status).toBe("retry_scheduled");
    store.close(); store = new SqliteControlPlane(path); store.migrate();
    const second = fakeChannel();
    second.sendPreparedImage.mockRejectedValueOnce(new Error("still unavailable"));
    await new DeliverReply(store, second, { ownerId: "two", loadImage, retryDelaysMs: [0] }).execute();
    expect(second.prepareImage).not.toHaveBeenCalled();
    expect(second.sendPreparedImage.mock.calls[0]?.[1]).toEqual(prepared);
    second.imageCredentialScope.mockReturnValue("credential-b");
    expect((await new DeliverReply(store, second, { ownerId: "two", loadImage, retryDelaysMs: [0] }).execute()).status).toBe("sent");
    expect(second.prepareImage).toHaveBeenCalledTimes(1);
  });

  it("fences an uploader whose lease was reclaimed before upload finished", async () => {
    seed(["image"]);
    const channel = fakeChannel();
    channel.prepareImage.mockImplementationOnce(() => {
      db.prepare("UPDATE outbox SET lease_expires_at=? WHERE status='SENDING'").run(new Date(0).toISOString());
      store.recoverInterrupted(new Date());
      expect(store.claimNextOutbox("replacement", 30_000)?.attemptNo).toBe(2);
      return Promise.resolve(prepared);
    });
    await expect(new DeliverReply(store, channel, { ownerId: "old", loadImage }).execute()).rejects.toThrow("Outbox lease lost");
    expect(channel.sendPreparedImage).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status,lease_owner,prepared_image_json FROM outbox").get()).toMatchObject({ status: "SENDING", lease_owner: "replacement", prepared_image_json: null });
  });

  it("keeps later chunks blocked when an earlier image enters dead letter", async () => {
    seed(["image", "image"]);
    const channel = fakeChannel();
    channel.prepareImage.mockRejectedValue(new Error("upload failed"));
    const worker = new DeliverReply(store, channel, { ownerId: "worker", loadImage, maxAttempts: 1 });
    await worker.execute();
    expect((await worker.execute()).status).toBe("idle");
    expect(channel.prepareImage).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT status FROM outbox ORDER BY chunk_index").all().map(row => row.status)).toEqual(["DEAD_LETTER", "PENDING"]);
  });

  it("applies migration 10 to an existing version-9 database without changing text outbox columns", () => {
    const old = new DatabaseSync(join(directory, "old.db"));
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(m => m.version <= 9)) old.exec(migration.sql);
      const before = old.prepare("PRAGMA table_info(outbox)").all().map(row => row.name);
      old.exec(SQLITE_MIGRATIONS.find(m => m.version === 10)!.sql);
      const after = old.prepare("PRAGMA table_info(outbox)").all().map(row => row.name);
      expect(after).toEqual([...before, "artifact_id", "prepared_image_json", "prepared_image_scope"]);
      expect(old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_artifacts'").get()).toBeDefined();
    } finally { old.close(); }
  });
});
