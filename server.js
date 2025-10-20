import express from "express";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public (HTML/JS/CSS)
app.use(express.static(path.join(process.cwd(), "public")));

// Serve photos from /photos
app.use("/photos", express.static(path.join(process.cwd(), "photos")));

app.listen(PORT, () => {
  console.log(`✅ Photo kiosk running at http://localhost:${PORT}`);
});
