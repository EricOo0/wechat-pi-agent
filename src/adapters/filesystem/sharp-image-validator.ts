import sharp from "sharp";
import { ImageReplyError, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, type ImageValidator } from "../../modules/artifacts/index.js";
export class SharpImageValidator implements ImageValidator {
  public async validate(data: Buffer): Promise<{mimeType: "image/png" | "image/jpeg"; width: number; height: number}> {
    if (data.length > MAX_IMAGE_BYTES) throw new ImageReplyError("IMAGE_TOO_LARGE", "图片超过 10 MiB。");
    try {
      const image = sharp(data, {limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning"});
      const metadata = await image.metadata();
      if ((metadata.format !== "png" && metadata.format !== "jpeg") || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) !== 1) throw new Error("unsupported image");
      if (metadata.format === "png" && !data.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))) throw new Error("missing PNG end marker");
      if (metadata.format === "jpeg" && !data.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) throw new Error("missing JPEG end marker");
      await image.raw().toBuffer();
      return {mimeType: metadata.format === "png" ? "image/png" : "image/jpeg", width: metadata.width, height: metadata.height};
    } catch { throw new ImageReplyError("IMAGE_INVALID", "图片无效；仅支持完整的单帧 PNG/JPEG，最多 2500 万像素。"); }
  }
}
