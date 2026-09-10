import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, utimes, mkdir, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { ImageReplyService, MAX_IMAGE_BYTES, type ImageArtifact } from "../src/modules/artifacts/index.js";
import { SqliteImageArtifactRepository } from "../src/adapters/sqlite/sqlite-image-artifact-repository.js";
import { LocalImageStorage } from "../src/adapters/filesystem/local-image-storage.js";
import { SharpImageValidator } from "../src/adapters/filesystem/sharp-image-validator.js";
import { createImageTools } from "../src/adapters/pi/tools/image-tools.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
const paths: string[] = [];
const repos: SqliteImageArtifactRepository[] = [];
afterEach(async () => { for (const repo of repos.splice(0)) repo.close(); for (const path of paths.splice(0)) await rm(path,{recursive:true,force:true}); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(),"images-test-")); paths.push(root);
  const dbPath = join(root,"db.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE image_artifacts(id TEXT PRIMARY KEY,owner_id TEXT,task_id TEXT,revision INTEGER,source_turn_id TEXT,tool_call_id TEXT,bytes INTEGER,sha256 TEXT,mime_type TEXT,width INTEGER,height INTEGER,created_at TEXT,deleted_at TEXT,UNIQUE(owner_id,source_turn_id,tool_call_id)); CREATE TABLE image_reply_selections(owner_id TEXT,task_id TEXT,revision INTEGER,artifact_id TEXT,ordinal INTEGER,PRIMARY KEY(owner_id,task_id,revision,artifact_id),UNIQUE(owner_id,task_id,revision,ordinal));`);
  db.close();
  const repository = new SqliteImageArtifactRepository(dbPath); repos.push(repository);
  const service = new ImageReplyService(repository,new LocalImageStorage(join(root,"images")),new SharpImageValidator());
  const data = await sharp({create:{width:4,height:3,channels:3,background:"red"}}).png().toBuffer();
  const context = {ownerId:"a".repeat(64),taskId:"task",revision:1,turnId:"turn",toolCallId:"call"};
  return {root,repository,service,data,context};
}
describe("image reply artifacts", () => {
  it("validates a complete image and snapshots bytes, idempotently reusing a tool result", async () => {
    const {service,data,context,repository} = await fixture();
    let reads = 0;
    const read = () => { reads++; return Promise.resolve(Buffer.from(data)); };
    const image = await service.prepare(context,"x.png",read);
    expect(image).toMatchObject({width:4,height:3,mimeType:"image/png"});
    expect(await service.prepare(context,"changed.png",read)).toEqual(image);
    expect(reads).toBe(1);
    expect(await service.readForDelivery(image.id)).toEqual(data);
    expect(repository.get("b".repeat(64),image.id)).toBeUndefined();
    expect(() => service.assertReady("b".repeat(64),[image.id])).toThrow("不属于");
  });
  it("does not persist denied, malformed, truncated or oversized inputs", async () => {
    const {service,data,context,repository} = await fixture();
    await expect(service.prepare(context,"secret",() => Promise.reject(new Error("denied")))).rejects.toThrow("denied");
    for (const value of [Buffer.from("not an image"),data.subarray(0,data.length-15),Buffer.alloc(MAX_IMAGE_BYTES+1)]) {
      await expect(service.prepare(context,"x",()=>Promise.resolve(value))).rejects.toThrow();
    }
    expect(repository.usedBytes(context.ownerId)).toBe(0);
  });
  it("preserves selection order, enforces max 3 and isolates task revision", async () => {
    const {service,data,context,repository} = await fixture();
    const images: ImageArtifact[] = [];
    for (let index=0;index<4;index++) images.push(await service.prepare({...context,toolCallId:`c${index}`},"x",()=>Promise.resolve(data)));
    for (const image of images.slice(0,3)) repository.select(image);
    repository.select(images[0]!);
    expect(repository.selected(context.ownerId,"task",1).map(x=>x.id)).toEqual(images.slice(0,3).map(x=>x.id));
    expect(()=>repository.select(images[3]!)).toThrow("最多 3");
    expect(repository.selected(context.ownerId,"task",2)).toEqual([]);
    repository.clear(context.ownerId,"task",1);
    expect(repository.selected(context.ownerId,"task",1)).toEqual([]);
  });
  it("enforces quota transactionally without disturbing existing snapshots", async () => {
    const {service,data,context,repository} = await fixture();
    const image = await service.prepare(context,"x",()=>Promise.resolve(data));
    expect(() => repository.saveWithinQuota({...image,id:`img_${"b".repeat(32)}`,toolCallId:"next"}, image.bytes)).toThrow("配额");
    expect(repository.usedBytes(context.ownerId)).toBe(image.bytes);
    expect(await service.readForDelivery(image.id)).toEqual(data);
  });
  it("sweeps only old unregistered snapshots and ignores links and unrelated files", async () => {
    const {service,data,context,root} = await fixture();
    const image = await service.prepare(context,"x",()=>Promise.resolve(data));
    const directory = join(root,"images",context.ownerId);
    const orphan = join(directory,`img_${"c".repeat(32)}`);
    const recent = join(directory,`img_${"d".repeat(32)}`);
    const unrelated = join(directory,"keep.txt");
    await Promise.all([writeFile(orphan,data),writeFile(recent,data),writeFile(unrelated,data)]);
    const old = new Date(Date.now()-48*60*60*1000);
    await Promise.all([utimes(orphan,old,old),utimes(unrelated,old,old),utimes(join(directory,image.id),old,old)]);
    const outside = join(root,"outside"); await mkdir(outside);
    const outsideImage = join(outside,`img_${"e".repeat(32)}`);
    await writeFile(outsideImage,data); await utimes(outsideImage,old,old);
    await symlink(outside,join(root,"images","f".repeat(64)));
    expect(await service.sweepOrphans()).toBe(1);
    await expect(stat(orphan)).rejects.toThrow();
    await Promise.all([stat(recent),stat(unrelated),stat(outsideImage)]);
    expect(await service.readForDelivery(image.id)).toEqual(data);
  });
  it("reply_image delegates selection/clear to task gates and returns metadata only", async () => {
    const {service,data,context,repository} = await fixture();
    const select = vi.fn((image: ImageArtifact)=>repository.select(image));
    const clear = vi.fn(()=>repository.clear(context.ownerId,context.taskId,context.revision));
    const tool = createImageTools(service,()=>context,()=>Promise.resolve(data),select,clear)[0]!;
    const result = await tool.execute("tool",{path:"private.png"},undefined,undefined,{} as ExtensionContext);
    expect(select).toHaveBeenCalledOnce();
    expect(result.details.selectedImageIds).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(data.toString("base64"));
    expect(JSON.stringify(result)).not.toContain("private.png");
    await tool.execute("clear",{action:"clear"},undefined,undefined,{} as ExtensionContext);
    expect(clear).toHaveBeenCalledOnce();
    expect(repository.selected(context.ownerId,context.taskId,context.revision)).toEqual([]);
  });
  it("cancellation immediately after authorized read never selects or persists an image", async () => {
    const {service,data,context,repository} = await fixture();
    const controller = new AbortController();
    const select = vi.fn();
    const tool = createImageTools(service,()=>context,()=>{controller.abort();return Promise.resolve(data);},select)[0]!;
    await expect(tool.execute("tool",{path:"x.png"},controller.signal,undefined,{} as ExtensionContext)).rejects.toThrow();
    expect(select).not.toHaveBeenCalled();
    expect(repository.usedBytes(context.ownerId)).toBe(0);
  });
  it("detects snapshot corruption and retains protected files during cleanup", async () => {
    const {service,data,context,root,repository} = await fixture();
    const image = await service.prepare(context,"x",()=>Promise.resolve(data));
    expect(await service.cleanup("9999",()=>true)).toBe(0);
    await writeFile(join(root,"images",context.ownerId,image.id),"changed");
    await expect(service.readForDelivery(image.id)).rejects.toThrow("校验失败");
    expect(await service.cleanup("9999",()=>false)).toBe(1);
    expect(repository.getById(image.id)).toBeUndefined();
    expect(repository.usedBytes(context.ownerId)).toBe(0);
  });
});
