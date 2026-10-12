import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ensureScreenshots } from "./dataset.js";
import { listScreenshots, saveRecognition, screenshotExists, searchSongs } from "./store.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => res.type("html").send(page));
app.get("/api/songs", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
  res.json({ query: q, songs: searchSongs(q) });
});
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = new McpServer({ name: "screenshot-resolver-mcp", version: "0.1.0" });
server.registerTool("get_screenshots", {
  title: "Get 20 karaoke screenshots",
  description: "Fetch the next batch of up to 20 screenshots from the configured Hugging Face dataset. Inspect the returned images and keep each screenshotId paired with its image.",
  inputSchema: { offset: z.number().int().min(0).default(0).describe("Zero-based dataset offset; use 0, 20, 40, ... to page through the dataset.") }
}, async ({ offset }) => {
  const screenshots = await ensureScreenshots(offset, 20);
  const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
    { type: "text", text: JSON.stringify({ offset, count: screenshots.length, screenshots: screenshots.map(({ id, datasetIndex }) => ({ screenshotId: id, datasetIndex })) }) }
  ];
  for (const shot of screenshots) {
    const response = await fetch(shot.imageUrl);
    if (!response.ok) {
      content.push({ type: "text", text: `Image fetch failed for screenshotId=${shot.id}: HTTP ${response.status}; source URL: ${shot.imageUrl}` });
      continue;
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      content.push({ type: "text", text: `Skipped non-image response for screenshotId=${shot.id} (${mimeType}). Source: ${shot.imageUrl}` });
      continue;
    }
    const data = Buffer.from(await response.arrayBuffer()).toString("base64");
    content.push({ type: "text", text: `Screenshot screenshotId=${shot.id}, datasetIndex=${shot.datasetIndex}` });
    content.push({ type: "image", data, mimeType });
  }
  return { content };
});

server.registerTool("save_song_recognition", {
  title: "Save recognized song titles and artists",
  description: "Persist model-recognized songs for screenshots previously returned by get_screenshots. This is append-only: every submission creates a new batch and inserts new rows; existing recognition records are never overwritten or updated. Submit an empty songs array if a batch contains no identifiable songs.",
  inputSchema: {
    songs: z.array(z.object({
      screenshotId: z.string().min(1),
      title: z.string().trim().min(1).max(300),
      artist: z.string().trim().min(1).max(300)
    })).max(2000).describe("Songs identified in the screenshots. Keep the screenshotId from get_screenshots for each song."),
    modelNote: z.string().max(1000).optional().describe("Optional model/version or recognition notes.")
  }
}, async ({ songs, modelNote }) => {
  const unknownIds = [...new Set(songs.map(s => s.screenshotId).filter(id => !screenshotExists(id)))];
  if (unknownIds.length) {
    return { isError: true, content: [{ type: "text", text: `Unknown screenshotId(s); fetch screenshots first: ${unknownIds.join(", ")}` }] };
  }
  const result = saveRecognition(songs, modelNote);
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...result, appendOnly: true, message: "Saved as a new immutable recognition batch; existing rows were not changed." }) }] };
});

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);
app.all("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Screenshot Resolver MCP listening on :${port}; MCP endpoint /mcp`));

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Screenshot Resolver — Song Index</title>
<style>
:root{color-scheme:light dark;font:16px system-ui,sans-serif}body{max-width:1100px;margin:2rem auto;padding:0 1rem}
h1{margin-bottom:.3rem}.muted{opacity:.7}form{display:flex;gap:.5rem;margin:1.5rem 0}input,button{font:inherit;padding:.65rem;border:1px solid #888;border-radius:.5rem}input{flex:1;min-width:0}button{cursor:pointer}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #8885;vertical-align:top}img{max-width:180px;max-height:140px;object-fit:contain}
@media(max-width:650px){table,tbody,tr,td{display:block}thead{display:none}td{border:0;padding:.3rem}.item{border-bottom:1px solid #8885;padding:1rem 0}img{max-width:100%}}
</style></head><body><h1>Song recognition index</h1><p class="muted">Append-only model recognition history. Search by title or artist; repeated recognitions are preserved.</p>
<form id="search"><input id="q" placeholder="Search song title or artist"><button>Search</button></form><p id="count" class="muted"></p>
<table><thead><tr><th>Song</th><th>Artist</th><th>Screenshot</th><th>Saved at</th><th>Batch</th></tr></thead><tbody id="rows"></tbody></table>
<script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){const q=document.querySelector('#q').value;const r=await fetch('/api/songs?q='+encodeURIComponent(q));const d=await r.json();document.querySelector('#count').textContent=d.songs.length+' record(s) (latest 1,000 matching records maximum)';document.querySelector('#rows').innerHTML=d.songs.map(s=>'<tr class="item"><td>'+esc(s.title)+'</td><td>'+esc(s.artist)+'</td><td><a href="'+esc(s.imageUrl)+'" target="_blank" rel="noreferrer">#'+esc(s.screenshotId.slice(0,8))+' — view image</a></td><td>'+esc(s.createdAt)+'</td><td>'+esc(s.batchId)+'</td></tr>').join('')||'<tr><td colspan="5">No recognition records yet.</td></tr>'}
document.querySelector('#search').addEventListener('submit',e=>{e.preventDefault();load()});load();
</script></body></html>`;
