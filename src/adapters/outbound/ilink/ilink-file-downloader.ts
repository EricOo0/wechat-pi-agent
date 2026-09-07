import { FileInputError, MAX_FILE_BYTES, type InboundFileReference } from "../../../domain/files/user-file.js";
import { decryptIfNeeded, readLimitedBody, validateCdnUrl } from "./ilink-image-downloader.js";
export class ILinkFileDownloader {
  public constructor(private readonly cdnBaseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}
  public async download(file: InboundFileReference, signal?: AbortSignal): Promise<Buffer> {
    if (!file.name.toLowerCase().endsWith(".pdf")) throw new FileInputError("FILE_UNSUPPORTED", "当前仅支持 PDF 文件。");
    if ((file.declaredBytes??0)>MAX_FILE_BYTES) throw new FileInputError("FILE_TOO_LARGE", "PDF 超过 20 MiB，请缩小文件后重新发送。");
    try {
      const media=file.media;
      if (!media || (!media.full_url&&!media.encrypt_query_param)) throw new Error("missing media");
      const url=media.full_url?new URL(media.full_url):new URL(`download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param??"")}`,this.cdnBaseUrl.replace(/\/?$/, "/"));
      validateCdnUrl(url);
      const timeout=AbortSignal.timeout(30_000);
      const response=await this.fetchImpl(url,{redirect:"error",signal:signal?AbortSignal.any([signal,timeout]):timeout});
      if(!response.ok)throw new Error("CDN failed");
      const bytes=decryptIfNeeded(await readLimitedBody(response,MAX_FILE_BYTES+16),undefined,media.aes_key);
      if(bytes.length>MAX_FILE_BYTES)throw new FileInputError("FILE_TOO_LARGE","PDF 超过 20 MiB，请缩小文件后重新发送。");
      if(bytes.subarray(0,5).toString()!=="%PDF-")throw new FileInputError("FILE_INVALID","文件不是有效的 PDF，请重新导出后发送。");
      return bytes;
    } catch(error) {
      if(signal?.aborted)throw new DOMException("Aborted","AbortError");
      if(error instanceof FileInputError)throw error;
      throw new FileInputError("FILE_DOWNLOAD_FAILED","文件下载或解密失败，请重新发送。");
    }
  }
}
