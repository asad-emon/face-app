import express from "express";
import cors from "cors";
import { initDb, SwapJob } from "./db.js";
import { CLIENT_ORIGIN, PORT } from "./config.js";
import { logApiError } from "./utils/logging.js";
import { bootstrapSwapQueue } from "./services/swapService.js";
import authRoutes from "./routes/auth.js";
import systemRoutes from "./routes/system.js";
import modelRoutes from "./routes/models.js";
import imageRoutes from "./routes/images.js";
import videoRoutes from "./routes/videos.js";
import swapRoutes from "./routes/swaps.js";
import internalRoutes from "./routes/internal.js";
import civitaiRoutes from "./routes/civitai.js";

const app = express();

const origins = CLIENT_ORIGIN ? [CLIENT_ORIGIN, /\.replit\.dev$/] : true;

app.use(
  cors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
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

async function start() {
  try {
    await initDb();
    await SwapJob.update(
      { status: "queued", started_at: null, error: null },
      { where: { status: "processing" } }
    );
    await bootstrapSwapQueue();

    app.listen(PORT, () => {
      console.log(`API server listening on ${PORT}`);
    });
  } catch (err) {
    logApiError("start", err);
    process.exit(1);
  }
}

start();
