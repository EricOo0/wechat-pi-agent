import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";

/** A provider may echo a signed input URL in its error. Scrub before Pi persists it. */
export function redactFileErrors(stream: AssistantMessageEventStream): AssistantMessageEventStream {
  const iterator = stream[Symbol.asyncIterator].bind(stream);
  stream[Symbol.asyncIterator] = async function* () {
    for await (const event of { [Symbol.asyncIterator]: iterator }) {
      if (event.type === "error") {
        Object.assign(event.error, redact(event.error));
      }
      yield event;
    }
  };
  return stream;
}
function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/https?:\/\/[^\s"<>\\]*\?[^\s"<>\\]*/g, "[signed URL redacted]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
}
