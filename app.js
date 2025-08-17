import express from "express";
import fetch from "node-fetch";

const app = express();
const port = 7860;

app.use(express.json());
const user = process.env.HF_TOKEN;
const space = process.env.HF_TOKEN;
app.post("/api/proxy", async (req, res) => {
  const response = await fetch(`https://huggingface.co/spaces/${user}/${space}/swap`, {
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
