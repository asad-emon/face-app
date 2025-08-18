import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const port = 7860;

app.use(express.json());
const user = process.env.USER_NAME;
const space = process.env.SPACE_NAME;

app.post("/api/proxy", async (req, res) => {
  const response = await fetch(`https://${user}-${space}.hf.space/swap`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: req.body
  });
  const data = await response.json();
  
  res.json(data);
});

app.listen(port, () => console.log(`Proxy running on ${port}`));
