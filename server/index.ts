import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../src/config.js";
import { handleAnalyze } from "./sse.js";
import { handleRetryClaim } from "./retry-claim.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = loadConfig();
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.get("/api/analyze", handleAnalyze(config));
app.post("/api/retry-claim", handleRetryClaim(config));

// Serve static frontend in production
const webDistPath = path.resolve(__dirname, "../web/dist");
app.use(express.static(webDistPath));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(webDistPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
