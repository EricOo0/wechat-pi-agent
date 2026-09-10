export interface ReplyChunkerOptions {
  maxChunkLength?: number;
}

export class ReplyChunker {
  private readonly maxChunkLength: number;

  public constructor(options: ReplyChunkerOptions | number = {}) {
    const maxChunkLength = typeof options === "number" ? options : (options.maxChunkLength ?? 3500);
    if (!Number.isSafeInteger(maxChunkLength) || maxChunkLength <= 0) {
      throw new RangeError("maxChunkLength must be a positive safe integer");
    }
    this.maxChunkLength = maxChunkLength;
  }

  public chunk(text: string): readonly string[] {
    if (text.length === 0) {
      return [];
    }

    const remaining = Array.from(text);
    const chunks: string[] = [];
    while (remaining.length > this.maxChunkLength) {
      const window = remaining.slice(0, this.maxChunkLength);
      const splitAt = this.findSplitPoint(window);
      chunks.push(remaining.splice(0, splitAt).join(""));
    }
    if (remaining.length > 0) {
      chunks.push(remaining.join(""));
    }
    return chunks;
  }

  private findSplitPoint(window: readonly string[]): number {
    for (let index = window.length - 1; index > 0; index -= 1) {
      const character = window[index];
      if (character === "\n") {
        return index + 1;
      }
    }
    for (let index = window.length - 1; index > 0; index -= 1) {
      const character = window[index];
      if (character !== undefined && /\s/u.test(character)) {
        return index + 1;
      }
    }
    return window.length;
  }
}
