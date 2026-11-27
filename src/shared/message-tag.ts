/**
 * A tag at the start of a message: `[Type name="value" other="value"]`.
 * The type and attribute names use letters, digits, `_` and `-`. Attribute values are
 * double-quoted and cannot contain a double quote.
 */
const TAG_PATTERN = /^\[([A-Za-z0-9_-]+)((?:\s+[A-Za-z0-9_-]+="[^"]*")*)\]\s*/;
const ATTRIBUTE_PATTERN = /([A-Za-z0-9_-]+)="([^"]*)"/g;

export type MessageTag = {
  type: string;
  attributes: Record<string, string>;
  /** The message text after the tag. */
  body: string;
};

/** Parses a leading tag. Returns null when the text does not start with one. */
export function parseLeadingTag(text: string): MessageTag | null {
  const match = TAG_PATTERN.exec(text);
  if (!match) return null;
  const attributes: Record<string, string> = {};
  for (const attribute of match[2].matchAll(ATTRIBUTE_PATTERN)) {
    attributes[attribute[1]] = attribute[2];
  }
  return { type: match[1], attributes, body: text.slice(match[0].length) };
}

/**
 * A block tag: an opening tag, a body, and a matching closing tag, e.g. [META] ...
 * [/META]. Same character rules as the leading tag, but unlike a leading tag it may
 * appear anywhere in the message and more than once.
 */
const BLOCK_TAG_PATTERN = /\[([A-Za-z0-9_-]+)\]([\s\S]*?)\[\/\1\]/g;

/**
 * Block tag types that only carry app metadata (for example the worker reporting
 * contract). They must travel with the text, but they are never shown.
 */
const HIDDEN_BLOCK_TYPES = new Set(["META"]);

/**
 * Removes every hidden block tag from the text. Only display and read paths call this:
 * copying keeps the raw text, where hidden blocks are still present.
 */
export function stripHiddenBlockTags(text: string): string {
  if (!text.includes("[/")) return text;
  const stripped = text.replace(BLOCK_TAG_PATTERN, (match, type: string) =>
    HIDDEN_BLOCK_TYPES.has(type) ? "\n" : match,
  );
  if (stripped === text) return text;
  // A removed block leaves the blank lines around it behind; collapse them.
  return stripped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
