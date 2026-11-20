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
