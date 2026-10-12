import { createHash } from "node:crypto";
import { insertScreenshots, type Screenshot } from "./store.js";

const dataset = process.env.HF_DATASET ?? "for1096/songs";
const config = process.env.HF_CONFIG ?? "default";
const split = process.env.HF_SPLIT ?? "train";
const api = "https://datasets-server.huggingface.co/rows";

function extractImageUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (typeof item.src === "string") return item.src;
  if (typeof item.url === "string") return item.url;
  for (const child of Object.values(item)) {
    const found = extractImageUrl(child);
    if (found) return found;
  }
}

export async function ensureScreenshots(offset: number, limit: number): Promise<Screenshot[]> {
  const url = new URL(api);
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("config", config);
  url.searchParams.set("split", split);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(limit));
  const response = await fetch(url, { headers: { "User-Agent": "screenshot-resolver-mcp/0.1" } });
  if (!response.ok) throw new Error(`Hugging Face dataset API failed: ${response.status} ${await response.text()}`);
  const payload = await response.json() as { rows?: Array<{ row_idx?: number; row: Record<string, unknown> }> };
  const rows = payload.rows ?? [];
  const items: Screenshot[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const imageValue = row.row.image ?? row.row.images ?? row.row.file;
    const imageUrl = typeof imageValue === "string" ? imageValue : extractImageUrl(imageValue);
    if (!imageUrl) continue;
    const datasetIndex = row.row_idx ?? offset + i;
    const id = createHash("sha256").update(`${dataset}:${split}:${datasetIndex}:${imageUrl}`).digest("hex").slice(0, 24);
    items.push({ id, imageUrl, datasetIndex });
  }
  insertScreenshots(items);
  return items;
}
