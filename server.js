// -------------------------------------------
// Photo Kiosk Server with Pre-Caching, Downscaling & Advanced Slide Types
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
  console.log(msg);
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
          .rotate()
          .resize({
            width: Math.min(metadata.width, maxWidth),
            height: Math.min(metadata.height, maxHeight),
            fit: "inside",
            withoutEnlargement: true,
          })
          .withMetadata()
          .toFile(cachedPath);
        log(`🪶 Cached resized ${relPath}`);
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

// --- Helper: preload all frames for a pattern ---
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
async function buildSlideshow(clientId) {
  const masterSlides = config.slides || [];
  const clients = config.clients || {};
  const defaultCfg = config.default || {};

  let clientCfg = clients[clientId];
  if (!clientCfg) {
    log(`⚠️ No client section for ${clientId}; using default playlist.`);
    clientCfg = defaultCfg;
  }

  const includeIds = clientCfg.include || defaultCfg.include || [];
  const expanded = [];

  for (const id of includeIds.length ? includeIds : masterSlides.map((s) => s.id)) {
    const slide = masterSlides.find((s) => s.id === id);
    if (!slide) {
      log(`⚠️ Slide ID '${id}' not found in master slides`);
      continue;
    }

    // --- MUX slide ---
    if (slide.type === "mux" && Array.isArray(slide.panels)) {
      expanded.push({
        id: slide.id,
        type: "mux",
        layout: slide.layout || "2x2",
        panels: slide.panels || [],
        duration: slide.duration || "infinite",
        title: slide.title || "",
      });
      log(`🧩 MUX [${slide.id}]: layout=${slide.layout}, panels=${slide.panels.length}, duration=${slide.duration}`);

      // ✅ Include all referenced slides used by MUX panels
      for (const p of slide.panels) {
        for (const sid of p.slides || []) {
          const sub = masterSlides.find((s) => s.id === sid);
          if (!sub) {
            log(`⚠️ MUX panel references unknown slide: ${sid}`);
            continue;
          }

          // recursively expand referenced slide (so client can render)
          if (sub.type === "youtube") {
            expanded.push({
              id: sub.id,
              type: "youtube",
              video_id: sub.video_id,
              duration: sub.duration || 30,
              title: sub.title || "",
            });
          } else if (sub.type === "html") {
            expanded.push({
              id: sub.id,
              type: "html",
              url: sub.url,
              duration: sub.duration || 15,
              title: sub.title || "",
            });
          } else if (sub.file && sub.file.includes("*")) {
            const frames = await prepareFrames(sub.file);
            expanded.push({
              id: sub.id,
              frames,
              effect: sub.effect || "animate-smooth",
              duration: sub.duration || 5,
              fps: sub.fps || 10,
              repeat: sub.repeat || 1,
              title: sub.title || "",
            });
          } else if (sub.file) {
            const url = await ensureCached(path.join(PHOTOS_DIR, sub.file));
            expanded.push({
              id: sub.id,
              url,
              effect: sub.effect || "fade",
              duration: sub.duration || 5,
              title: sub.title || "",
            });
          } else {
            expanded.push({
              id: sub.id,
              url: null,
              duration: sub.duration || 5,
              title: sub.title || "",
            });
          }
        }
      }
      continue;
    }

    // --- YouTube slide ---
    if (slide.type === "youtube" && (slide.video_id || slide.url)) {
      const videoId = slide.video_id
        ? slide.video_id
        : slide.url.split("/embed/")[1]?.split(/[?&]/)[0];
      if (!videoId) continue;
      expanded.push({
        id: slide.id,
        type: "youtube",
        video_id: videoId,
        duration: slide.duration || 30,
        title: slide.title || "",
      });
      log(`📺 YouTube [${slide.id}]: ${videoId}`);
      continue;
    }

    // --- HTML slide ---
    if (slide.type === "html" && slide.url) {
      expanded.push({
        id: slide.id,
        type: "html",
        url: slide.url,
        duration: slide.duration || 15,
        title: slide.title || "",
      });
      log(`🌐 HTML [${slide.id}]: ${slide.url}`);
      continue;
    }

    // --- Blank slide ---
    if (!slide.file) {
      expanded.push({
        id: slide.id || "blank",
        url: null,
        duration: slide.duration || 5,
        title: slide.title || "",
      });
      log(`⬛ Blank [${slide.id}]`);
      continue;
    }

    // --- Multi-frame slide ---
    if (slide.file.includes("*")) {
      const frames = await prepareFrames(slide.file);
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
      log(`🎞️ Multi-frame [${slide.id}]: ${frames.length} frames @${fps}fps`);
      continue;
    }

    // --- Single image slide ---
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
      title: slide.title || "",
    });
    log(`🖼️ Still [${slide.id}]`);
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

// --- Start server ---
try {
  const server = await app.listen(PORT);
  console.log(`📸 Photo kiosk running at http://localhost:${PORT}`);
  console.log(`🧭 Client ID: ${CLIENT_ID}`);
  console.log(`🪵 Logging to: ${LOG_FILE}`);
  console.log(`💾 Cache directory: ${CACHE_DIR}`);
  console.log("✅ Express server started successfully and is now listening.");

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
