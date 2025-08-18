import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

// Load environment variables and port configuration
dotenv.config();
const port = 8088;

// App initialization
const app = express();

// allow specific origins:
app.use(
  cors({
    origin: ["http://localhost:3000", "https://face-app-93d8.onrender.com"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true, // cookies/auth headers
  })
);

// Example route
app.get("/", (req, res) => {
  res.json({ message: "Service is working 🚀" });
});

app.use(express.json());

app.post("/api/proxy", async (req, res) => {  
  const response = await fetch(`${process.env.INFERENCE_BASE_URL}/swap`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(req.body)
  });
  const data = await response.json();

  res.json(data);
});

app.listen(port, () => console.log(`Proxy running on ${port}`));
