/** Keep readable context, omit opaque/binary credentials, and make size limits explicit. */
export function traceSnapshot(value: unknown): unknown {
  let remaining = 2_000_000;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, key = "", depth = 0): unknown => {
    if (/^(authorization|apiKey|access_token|refresh_token|aes_key|encrypt_query_param|thinkingSignature|textSignature|signature|encrypted_content)$/i.test(key)) return "[redacted or opaque]";
    if (typeof item === "string") {
      if (/^data:[^;,]+;base64,/.test(item)) return { omitted: "binary data", mimeType: item.slice(5, item.indexOf(';')), encodedCharacters: item.length };
      const safe = item.replace(/https?:\/\/[^\s"<>\\]*\?[^\s"<>\\]*/g, "[signed URL redacted]");
      const limit = Math.min(1_000_000, remaining);
      remaining -= Math.min(safe.length, limit);
      return safe.length > limit ? { truncated: true, originalCharacters: safe.length, preview: safe.slice(0, limit) } : safe;
    }
    if (depth > 32 || remaining <= 0) return { truncated: true, reason: "snapshot limit" };
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    if (Array.isArray(item)) { const result = item.map(entry => visit(entry, "", depth + 1)); seen.delete(item); return result; }
    const obj = item as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(obj).map(([name, entry]) => {
      if ((name === "data" && (obj.type === "image" || obj.type === "base64" || typeof obj.mimeType === "string" || typeof obj.mime_type === "string")) || name === "file_data") {
        return [name, { omitted: "binary data", encodedCharacters: typeof entry === "string" ? entry.length : undefined }];
      }
      return [name, visit(entry, name, depth + 1)];
    }));
    seen.delete(item);
    return result;
  };
  return visit(value);
}
