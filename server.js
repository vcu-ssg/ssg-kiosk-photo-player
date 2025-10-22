// -------------------------------------------
// Photo Kiosk Server with Pre-Caching, Downscaling & Animation Controls
// -------------------------------------------

import express from "express";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import os from "os";
import { fileURLToPath } from "url";
import { minimatch } from "minimatch";
import { glob } from "glob";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID || os.hostname();

// --- Directories ---
const PHOTOS_DIR = path.join(__dirname, "photos");
const CACHE_DIR = path.join(__dirname, "cache");
const LOG_DIR = path.join(__dirname, "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

// --- Logging ---
const LOG_FILE = path.join(LOG_DIR, "access.log");
function log(msg) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `${timestamp} | ${msg}\n`);
}

// --- Load config.yaml ---
const CONFIG_PATH = path.join(__dirname, "config.yaml");
let config = {};
try {
  const yamlText = fs.readFileSync(CONFIG_PATH, "utf8");
  config = yaml.load(yamlText);
  if (!config.default) config.default = { include: ["*.JPG", "*.jpg", "*.png"] };
  if (!config.clients) config.clients = {};
  log(`✅ Loaded config.yaml from ${CONFIG_PATH}`);
} catch (err) {
  console.warn("⚠️ Could not load config.yaml — using defaults:", err.message);
  config = { default: { include: ["*.JPG", "*.jpg", "*.png"] }, clients: {} };
}

// --- Serve static assets ---
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(PHOTOS_DIR));
app.use("/cache", express.static(CACHE_DIR));

// --- Helper: pattern filter ---
function filterFiles(files, patterns) {
  const matched = new Set();
  for (const pattern of patterns) {
    for (const file of files) {
      if (minimatch(file, pattern)) matched.add(file);
    }
  }
  return [...matched];
}

// --- Helper: downscale + cache (lazy) ---
async function ensureCached(filePath, maxWidth = 1920, maxHeight = 1080) {
  try {
    const relPath = path.relative(PHOTOS_DIR, filePath);
    const cachedPath = path.join(CACHE_DIR, relPath);
    const cachedDir = path.dirname(cachedPath);
    fs.mkdirSync(cachedDir, { recursive: true });

    if (!fs.existsSync(cachedPath)) {
      const image = sharp(filePath);
      const metadata = await image.metadata();
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        await image
          .rotate() // disable EXIF rotation
          .resize({
            width: Math.min(metadata.width, maxWidth),
            height: Math.min(metadata.height, maxHeight),
            fit: "inside",
            withoutEnlargement: true,
          })
          .withMetadata() // normalize metadata
          .toFile(cachedPath);
        log(`🖼️ Cached resized ${relPath}`);
      } else {
        fs.copyFileSync(filePath, cachedPath);
      }
    }
    return `/cache/${relPath.replace(/\\/g, "/")}`;
  } catch (err) {
    console.error("⚠️ Cache error:", err);
    return `/photos/${path.relative(PHOTOS_DIR, filePath).replace(/\\/g, "/")}`;
  }
}

// --- Helper: preload all frames for a slide ---
async function prepareFrames(pattern) {
  const matches = (await glob(pattern, { cwd: PHOTOS_DIR })).sort();
  const fullPaths = matches.map((f) => path.join(PHOTOS_DIR, f));
  const cached = [];
  for (const fp of fullPaths) {
    const c = await ensureCached(fp);
    cached.push(c);
  }
  return cached;
}

// --- Build slideshow JSON for a client ---

// --- Build slideshow JSON for a client ---
async function buildSlideshow(clientId) {
  const masterSlides = config.slides || [];
  const clients = config.clients || {};
  const defaultCfg = config.default || {};

  // determine which playlist to use
  let clientCfg = clients[clientId];
  if (!clientCfg) {
    log(`⚠️ No client section for ${clientId}; using default playlist.`);
    clientCfg = defaultCfg;
  }

  // Determine list of IDs to include
  const includeIds = clientCfg.include || defaultCfg.include || [];
  if (!includeIds.length) {
    log(`⚠️ No include list for ${clientId}; using all master slides.`);
  }

  const expanded = [];

  // Build playlist by mapping IDs to master slide definitions
  for (const id of includeIds.length ? includeIds : masterSlides.map(s => s.id)) {
    const slide = masterSlides.find(s => s.id === id);
    if (!slide) {
      log(`⚠️ Slide ID '${id}' not found in master slides`);
      continue;
    }

    // --- Blank slide (pause) ---
    if (!slide.file) {
      expanded.push({
        id: slide.id || "blank",
        url: null,
        effect: slide.effect || "none",
        duration: slide.duration || 5,
        fps: slide.fps || 10,
        repeat: slide.repeat || 1,
        title: slide.title || "",
      });
      log(`🟦 Blank [${slide.id}]: duration=${slide.duration || 5}s`);
      continue;
    }

    // --- Multi-frame pattern (e.g., *.JPG) ---
    if (slide.file.includes("*")) {
      const frames = await prepareFrames(slide.file);
      if (!frames.length) {
        log(`⚠️ Pattern '${slide.file}' matched no files for [${slide.id}]`);
        continue;
      }

      const fps = slide.fps || 10;
      const repeat = slide.repeat === "infinite" ? Infinity : (slide.repeat || 1);
      const duration = slide.duration || (frames.length * repeat) / fps;

      expanded.push({
        id: slide.id,
        frames,
        effect: slide.effect || "animate-smooth",
        duration,
        fps,
        repeat,
        title: slide.title || "",
      });

      log(`🎞️ Slide [${slide.id}]: ${frames.length} frames @ ${fps}fps, repeat=${repeat}, duration=${duration.toFixed(1)}s`);
      continue;
    }

    // --- Single still image ---
    const imgPath = path.join(PHOTOS_DIR, slide.file);
    if (!fs.existsSync(imgPath)) {
      log(`⚠️ Missing file: ${slide.file}`);
      continue;
    }

    const url = await ensureCached(imgPath);
    expanded.push({
      id: slide.id,
      url,
      effect: slide.effect || "fade",
      duration: slide.duration || 5,
      fps: slide.fps || 10,
      repeat: slide.repeat || 1,
      title: slide.title || "",
    });

    log(`🖼️ Still [${slide.id}]: duration=${slide.duration || 5}s`);
  }

  // --- Final summary ---
  if (!expanded.length) {
    log(`⚠️ No slides expanded for ${clientId}. Using entire master slide library as fallback.`);
    for (const slide of masterSlides) {
      if (slide.file) {
        const url = await ensureCached(path.join(PHOTOS_DIR, slide.file));
        expanded.push({
          id: slide.id,
          url,
          effect: slide.effect || "fade",
          duration: slide.duration || 5,
          fps: slide.fps || 10,
          repeat: slide.repeat || 1,
          title: slide.title || "",
        });
      }
    }
  }

  log(`✅ Built slideshow for ${clientId}: ${expanded.length} slides total`);
  return expanded;
}


// --- API endpoint ---
app.get("/api/slideshow", async (req, res) => {
  const reqHost = req.hostname || "unknown";
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  log(`client=${CLIENT_ID} | reqHost=${reqHost} | ip=${ip}`);

  try {
    const slideshow = await buildSlideshow(CLIENT_ID);
    res.json({ slides: slideshow });
  } catch (err) {
    console.error("❌ Error building slideshow:", err);
    res.status(500).json({ error: "Error building slideshow" });
  }
});


// --- Start server (Express 5 ESM compatible) ---
try {
  const server = await app.listen(PORT);
  console.log(`📸 Photo kiosk running at http://localhost:${PORT}`);
  console.log(`🧭 Client ID: ${CLIENT_ID}`);
  console.log(`🪵 Logging to: ${LOG_FILE}`);
  console.log(`💾 Cache directory: ${CACHE_DIR}`);
  console.log("✅ Express server started successfully and is now listening.");

  // Optional graceful shutdown on Ctrl-C
  process.on("SIGINT", async () => {
    console.log("\n🧹 Shutting down gracefully...");
    await server.close();
    console.log("👋 Server closed. Goodbye!");
    process.exit(0);
  });
} catch (err) {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
}