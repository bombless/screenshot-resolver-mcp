# Screenshot Resolver MCP

A TypeScript MCP server for examining karaoke screenshots and keeping an append-only record of model-recognized song titles and artists. Includes a small searchable web page.

## Two MCP tools

- **`get_screenshots`** — fetches up to 20 images from the configured Hugging Face dataset at the requested offset. The tool returns each stable `screenshotId` and the image content so the connected model can inspect the screenshots. Page with offsets `0, 20, 40, ...`.
- **`save_song_recognition`** — accepts `{ screenshotId, title, artist }` records and persists them as a new recognition batch. It never updates or replaces prior records; repeat recognition results remain visible as history.

## Run locally

Requires Node.js 20+.

```sh
npm install
npm run dev
```

The web index is at http://localhost:3000/ and the MCP Streamable HTTP endpoint is http://localhost:3000/mcp.

## Configuration

- `PORT` (default `3000`)
- `DATABASE_PATH` (default `data/songs.sqlite`; directory is created automatically)
- `HF_DATASET` (default `for1096/songs`)
- `HF_CONFIG` (default `default`)
- `HF_SPLIT` (default `train`)

The server uses the Hugging Face datasets-server rows API. If the dataset's configuration/split differs, set the matching values with environment variables. Publicly accessible image URLs are required.

## Persistence semantics

Every call to `save_song_recognition` creates a batch row and appends individual song rows in one SQLite transaction. There is no update/upsert path. Original model output is retained even if a later model call disagrees. A screenshot ID must have been issued by `get_screenshots` before it can be saved.

The web index shows individual recognition records, including their screenshot source, batch ID, and timestamp. Duplicate song rows are intentionally not removed: this preserves what each recognition call returned. Querying is case-insensitive according to SQLite's default LIKE behavior and returns at most 1,000 matching records.

## ChatGPT connection

Deploy the service to an HTTPS host that supports long-lived Node.js processes, then configure ChatGPT's MCP connector with the deployed `/mcp` URL. Do not expose the database file publicly. This initial version has no authentication; put it behind an access-control layer before exposing the recognition archive to the public internet.
