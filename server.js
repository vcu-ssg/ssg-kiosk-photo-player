import express from "express";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Identify kiosk
const CLIENT_ID = process.env.CLIENT_ID || os.hostname();

// Paths
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "access.log");
const CONFIG_PATH = path.join(__dirname, "config.yaml");
const PHOTOS_DIR = path.join(__dirname, "photos");

// Ensure logs directory exists
fs.mkdirSync(LOG_DIR, { recursive: true });

// --- Load YAML configuration ---
let config = {};
try {
  const yamlText = fs.readFileSync(CONFIG_PATH, "utf8");
  config = yaml.load(yamlText);
} catch (err) {
  console.warn("⚠️ Could not load config.yaml, using defaults:", err.message);
  config = {
    slides: [],
    default: { include: [] },
    clients: {}
  };
}

// --- Helper: Log client activity ---
function logClientAccess(client, ip) {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | client=${client} | ip=${ip}\n`;
  fs.appendFile(LOG_FILE, entry, (err) => {
    if (err) console.error("⚠️ Failed to write log:", err.message);
  });
}

// --- Express static serving ---
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(PHOTOS_DIR));

// --- Helper: build slideshow for client ---
function buildShow(clientId) {
  const slides = config.slides || [];
  const ids =
    config.clients?.[clientId]?.include ||
    config.default?.include ||
    [];

  // Map to full slide objects with absolute URLs
  const playlist = ids
    .map((id) => slides.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => ({
      id: s.id,
      title: s.title || "",
      file: s.file,
      effect: s.effect || "fade",
      duration: s.duration || 5,
      url: s.file ? `/photos/${s.file}` : null,

    }));

  return playlist;
}

// --- API: structured slideshow ---
app.get("/api/slideshow", (req, res) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  logClientAccess(CLIENT_ID, ip);

  const show = buildShow(CLIENT_ID);
  res.json({ client: CLIENT_ID, slides: show });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`📸 Photo kiosk running at http://localhost:${PORT}`);
  console.log(`🖥️  Client ID: ${CLIENT_ID}`);
  console.log(`🛠️  Loaded config from: ${CONFIG_PATH}`);
  console.log(`🪵  Logging client activity to: ${LOG_FILE}`);
});
