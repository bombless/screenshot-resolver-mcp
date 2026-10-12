import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbPath = resolve(process.env.DATABASE_PATH ?? "data/songs.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS screenshots (
    id TEXT PRIMARY KEY,
    image_url TEXT NOT NULL,
    dataset_index INTEGER NOT NULL UNIQUE,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS recognition_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    model_note TEXT
  );
  CREATE TABLE IF NOT EXISTS recognized_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES recognition_batches(id),
    screenshot_id TEXT NOT NULL REFERENCES screenshots(id),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_songs_title ON recognized_songs(title);
  CREATE INDEX IF NOT EXISTS idx_songs_artist ON recognized_songs(artist);
  CREATE INDEX IF NOT EXISTS idx_songs_screenshot ON recognized_songs(screenshot_id);
`);

export type Screenshot = { id: string; imageUrl: string; datasetIndex: number };
export type RecognizedSong = { screenshotId: string; title: string; artist: string };

export function insertScreenshots(items: Screenshot[]) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO screenshots (id, image_url, dataset_index) VALUES (?, ?, ?)"
  );
  const tx = db.transaction((rows: Screenshot[]) => {
    for (const row of rows) insert.run(row.id, row.imageUrl, row.datasetIndex);
  });
  tx(items);
}

export function listScreenshots(offset: number, limit: number) {
  return db.prepare(
    "SELECT id, image_url AS imageUrl, dataset_index AS datasetIndex FROM screenshots ORDER BY dataset_index LIMIT ? OFFSET ?"
  ).all(limit, offset) as Screenshot[];
}

export function saveRecognition(songs: RecognizedSong[], modelNote?: string) {
  const tx = db.transaction(() => {
    const batch = db.prepare("INSERT INTO recognition_batches (model_note) VALUES (?)").run(modelNote ?? null);
    const insert = db.prepare(
      "INSERT INTO recognized_songs (batch_id, screenshot_id, title, artist) VALUES (?, ?, ?, ?)"
    );
    for (const song of songs) insert.run(batch.lastInsertRowid, song.screenshotId, song.title.trim(), song.artist.trim());
    return { batchId: Number(batch.lastInsertRowid), inserted: songs.length };
  });
  return tx();
}

export function searchSongs(q = "") {
  const term = `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
  return db.prepare(`
    SELECT s.id, s.title, s.artist, s.screenshot_id AS screenshotId,
           sc.image_url AS imageUrl, s.created_at AS createdAt, s.batch_id AS batchId
    FROM recognized_songs s JOIN screenshots sc ON sc.id = s.screenshot_id
    WHERE (? = '' OR s.title LIKE ? ESCAPE '\\' OR s.artist LIKE ? ESCAPE '\\')
    ORDER BY s.id DESC LIMIT 1000
  `).all(q.trim(), term, term);
}

export function screenshotExists(id: string) {
  return Boolean(db.prepare("SELECT 1 FROM screenshots WHERE id = ?").get(id));
}
