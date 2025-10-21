import express from "express";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import os from "os";
import { fileURLToPath } from "url";
import { minimatch } from "minimatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID || os.hostname();

const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "access.log");
const CONFIG_PATH = path.join(__dirname, "config.yaml");
const PHOTOS_DIR = path.join(__dirname, "photos");

fs.mkdirSync(LOG_DIR, { recursive: true });

// --- Load YAML configuration ---
let config = {};
try {
  const yamlText = fs.readFileSync(CONFIG_PATH, "utf8");
  config = yaml.load(yamlText);
} catch (err) {
  console.warn("⚠️ Could not load config.yaml:", err.message);
  config = { slides: [], default: { include: [] }, clients: {} };
}

// --- Log helper ---
function logClientAccess(client, ip) {
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `${ts} | client=${client} | ip=${ip}\n`);
}

// --- Static serving ---
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(PHOTOS_DIR));

// --- Expand file masks into real files ---
function expandFiles(fileField) {
  if (!fileField) return [];

  const patterns = Array.isArray(fileField) ? fileField : [fileField];
  const matched = new Set();

  // --- Recursively walk /photos directory ---
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        // Get relative path from photos root
        const relPath = path.relative(PHOTOS_DIR, fullPath).replace(/\\/g, "/");
        for (const pattern of patterns) {
          if (pattern.trim() === "") continue;
          if (minimatch(relPath, pattern)) matched.add(relPath);
        }
      }
    }
  }

  walk(PHOTOS_DIR);
  return [...matched];
}

// --- Build slideshow ---
function buildShow(clientId) {
  const slides = config.slides || [];
  const ids =
    config.clients?.[clientId]?.include ||
    config.default?.include ||
    [];

  const playlist = [];

  for (const id of ids) {
    const slide = slides.find((s) => s.id === id);
    if (!slide) continue;

    const matchedFiles = expandFiles(slide.file);
    const effects = Array.isArray(slide.effect)
      ? slide.effect
      : [slide.effect || "fade"];

    // No images → blank slide
    if (matchedFiles.length === 0) {
      playlist.push({
        id: slide.id,
        title: slide.title || "",
        file: "",
        effect: "none",
        duration: slide.duration || 5,
        url: null,
      });
      continue;
    }

    // Pair files and effects in sequence
    const maxLen = Math.max(matchedFiles.length, effects.length);
    for (let i = 0; i < maxLen; i++) {
      const file = matchedFiles[i % matchedFiles.length];
      const effect = effects[i % effects.length];
      playlist.push({
        id: slide.id,
        title: slide.title || "",
        file,
        effect,
        duration: slide.duration || 5,
        url: `/photos/${file}`,
      });
    }
  }

  return playlist;
}

// --- API endpoint ---
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
