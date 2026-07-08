import express from "express";
import cors from "cors";
import { initDb, SwapJob } from "./db.js";
import { CLIENT_ORIGIN, PORT } from "./config.js";
import { logApiError } from "./utils/logging.js";
import { bootstrapSwapQueue, bootstrapVideoSwapQueue } from "./services/swapService.js";
import authRoutes from "./routes/auth.js";
import systemRoutes from "./routes/system.js";
import modelRoutes from "./routes/models.js";
import imageRoutes from "./routes/images.js";
import videoRoutes from "./routes/videos.js";
import swapRoutes from "./routes/swaps.js";
import internalRoutes from "./routes/internal.js";
import civitaiRoutes from "./routes/civitai.js";
import settingsRoutes from "./routes/settings.js";
import inferenceRoutes from "./routes/inference.js";

const app = express();

const origins = CLIENT_ORIGIN ? [CLIENT_ORIGIN, /\.replit\.dev$/] : true;

app.use(
  cors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(systemRoutes);
app.use(authRoutes);
app.use(modelRoutes);
app.use(imageRoutes);
app.use(videoRoutes);
app.use(swapRoutes);
app.use(internalRoutes);
app.use(civitaiRoutes);
app.use(settingsRoutes);
app.use(inferenceRoutes);

async function start() {
  try {
    await initDb();
    await SwapJob.updateMany(
      { status: "processing" },
      { $set: { status: "queued", started_at: null, error: null } }
    );
    await bootstrapSwapQueue();
    await bootstrapVideoSwapQueue();

    const server = app.listen(PORT, () => {
      console.log(`API server listening on ${PORT}`);
    });
    // Video swaps stream large files back via the internal callback and can run
    // for a long time. Disable per-request/header timeouts so big uploads and
    // long-running inference callbacks are never cut off.
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.timeout = 0;
  } catch (err) {
    logApiError("start", err);
    process.exit(1);
  }
}

start();
