import express from "express";
import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = process.cwd();

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

// Serve photos directory directly
app.use("/photos", express.static(path.join(__dirname, "photos")));

// API route to return list of photo filenames
app.get("/api/photos", (req, res) => {
  const photosDir = path.join(__dirname, "photos");
  fs.readdir(photosDir, (err, files) => {
    if (err) {
      console.error("Error reading photos directory:", err);
      return res.status(500).json({ error: "Cannot read photos" });
    }

    // Filter only image extensions
    const images = files.filter((f) =>
      f.match(/\.(jpg|jpeg|png|gif)$/i)
    );

    res.json(images);
  });
});

app.listen(PORT, () => {
  console.log(`📸 Photo kiosk running at http://localhost:${PORT}`);
});
