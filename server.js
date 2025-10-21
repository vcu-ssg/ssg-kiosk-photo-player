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

// --- Identify this kiosk instance ---
const CLIENT_ID = process.env.CLIENT_ID || os.hostname();

// --- Ensure logs directory exists ---
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "access.log");
fs.mkdirSync(LOG_DIR, { recursive: true });

// --- Load configuration file ---
const CONFIG_PATH = path.join(__dirname, "config.yaml");
let config = {};
try {
  const yamlText = fs.readFileSync(CONFIG_PATH, "utf8");
  config = yaml.load(yamlText);
} catch (err) {
  console.warn("⚠️ Could not load config.yaml — using defaults:", err.message);
  config = { default: { include: ["*.JPG", "*.jpg", "*.png"] }, clients: {} };
}

// --- Serve static assets ---
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(path.join(__dirname, "photos")));

// --- Helper: filter files by glob pattern ---
function filterFiles(files, patterns) {
  const matched = new Set();
  for (const pattern of patterns) {
    for (const file of files) {
      if (minimatch(file, pattern)) matched.add(file);
    }
  }
  return [...matched];
}

// --- Helper: append to access log ---
function logClientAccess(clientId, reqHost, ip) {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | client=${clientId} | reqHost=${reqHost} | ip=${ip}\n`;
  fs.appendFile(LOG_FILE, entry, (err) => {
    if (err) console.error("⚠️ Failed to write to access.log:", err.message);
  });
}

// --- API endpoint: /api/photos ---
app.get("/api/photos", (req, res) => {
  const reqHost = (req.hostname || "unknown").toLowerCase();
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";

  // Log every access for future config.yaml updates
  logClientAccess(CLIENT_ID, reqHost, ip);

  const photosDir = path.join(__dirname, "photos");
  fs.readdir(photosDir, (err, files) => {
    if (err) {
      console.error("Error reading photos directory:", err);
      return res.status(500).json({ error: "Cannot read photos" });
    }

    const allImages = files.filter((f) => f.match(/\.(jpg|jpeg|png|gif)$/i));

    // Determine which config section applies
    const clientConfig = config.clients?.[CLIENT_ID] || config.default;
    const includePatterns = clientConfig?.include || config.default.include;

    const filtered = filterFiles(allImages, includePatterns);
    res.json(filtered);
  });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`📸 Photo kiosk running at http://localhost:${PORT}`);
  console.log(`🖥️  Client ID: ${CLIENT_ID}`);
  console.log(`🛠️  Loaded config from: ${CONFIG_PATH}`);
  console.log(`🪵  Logging client activity to: ${LOG_FILE}`);
});
