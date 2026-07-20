import { randomUUID } from "crypto";
import type {
  TextContent,
  ImageContent,
  AudioContent,
  ResourceLink,
  EmbeddedResource,
  EnvVariable,
} from "@agentclientprotocol/sdk";
import type { TextPart, ImagePart, FilePart } from "ai";

export function toEnvVariables(env: Record<string, string> | undefined): EnvVariable[] | undefined {
  if (!env) return undefined;
  const entries = Object.entries(env);
  if (entries.length === 0) return undefined;
  return entries.map(([name, value]) => ({ name, value }));
}

export function textContentToTextPart(textContent: TextContent): TextPart {
  return {
    type: "text",
    text: textContent.text,
  };
}

export function imageContentToImagePart(imageContent: ImageContent): ImagePart {
  if (typeof imageContent.data === "string" && imageContent.data.length > 0) {
    return {
      type: "image",
      image: imageContent.data,
      mediaType: imageContent.mimeType,
    };
  }
  return {
    type: "image",
    image: imageContent.uri ? toUrlOrString(imageContent.uri) : "",
    mediaType: imageContent.mimeType,
  };
}

export function audioContentToFilePart(audioContent: AudioContent): FilePart {
  return {
    type: "file",
    data: audioContent.data,
    mediaType: audioContent.mimeType || "audio/mpeg",
    filename: "audio",
  };
}

export function embeddedResourceToFilePart(embeddedResource: EmbeddedResource): FilePart {
  const resource = embeddedResource.resource;
  if ("text" in resource) {
    return {
      type: "file",
      data: Buffer.from(resource.text, "utf8").toString("base64"),
      mediaType: resource.mimeType || "text/plain",
      filename: getFilenameFromUri(resource.uri) || "resource.txt",
    };
  }
  return {
    type: "file",
    data: resource.blob,
    mediaType: resource.mimeType || "application/octet-stream",
    filename: getFilenameFromUri(resource.uri) || "resource.bin",
  };
}

export function resourceLinkToFilePart(resourceLink: ResourceLink): FilePart {
  return {
    type: "file",
    data: toUrlOrString(resourceLink.uri),
    mediaType: resourceLink.mimeType || "application/octet-stream",
    filename: resourceLink.name || getFilenameFromUri(resourceLink.uri) || "resource",
  };
}
export function filePartToEmbeddedResourceResource(filePart: FilePart): EmbeddedResource {
  let blob: string;
  const data = filePart.data;
  if (typeof data === "string") {
    blob = data;
  } else if (data instanceof URL) {
    blob = data.toString();
  } else if (data instanceof ArrayBuffer) {
    blob = Buffer.from(new Uint8Array(data)).toString("base64");
  } else if (data instanceof Uint8Array) {
    blob = Buffer.from(data).toString("base64");
  } else if (typeof data === "object" && data !== null && "type" in data) {
    // Handle tagged file data types from AI SDK v7
    const tagged = data as {
      type: string;
      data?: unknown;
      url?: URL;
      text?: string;
      reference?: unknown;
    };
    switch (tagged.type) {
      case "data":
        if (typeof tagged.data === "string") {
          blob = tagged.data;
        } else if (tagged.data instanceof Uint8Array) {
          blob = Buffer.from(tagged.data).toString("base64");
        } else {
          blob = String(tagged.data ?? "");
        }
        break;
      case "url":
        blob = tagged.url?.toString() ?? "";
        break;
      case "text":
        blob = tagged.text ?? "";
        break;
      default:
        blob = JSON.stringify(data);
        break;
    }
  } else {
    blob = JSON.stringify(data);
  }

  return {
    resource: {
      uri: filePart.filename ?? `generated://response-file-${randomUUID()}`,
      mimeType: filePart.mediaType,
      blob,
    },
  };
}

function toUrlOrString(value: string): URL | string {
  try {
    return new URL(value);
  } catch {
    return value;
  }
}

function getFilenameFromUri(uri: string): string | undefined {
  const clean = uri.split("?")[0]?.split("#")[0] || "";
  const segments = clean.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : undefined;
}
