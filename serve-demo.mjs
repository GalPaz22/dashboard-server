/**
 * Serves demo-concierge.html as a standalone local frontend, on its own origin,
 * so you can develop the page separately from dashboard-server.
 *
 *   node serve-demo.mjs          → http://localhost:5175
 *   npm run demo
 *
 * The page talks to the dashboard server at http://localhost:8080 by default
 * (change it in the page header). That's a cross-origin call, which works
 * because dashboard-server sends `Access-Control-Allow-Origin: *` and exposes
 * the X-Concierge-* headers — nothing to configure here.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DEMO_PORT) || 5175;
const PAGE = path.join(__dirname, "demo-concierge.html");

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url !== "/" && url !== "/index.html" && url !== "/demo-concierge") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found — the demo lives at /");
  }

  fs.readFile(PAGE, (err, body) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Could not read demo-concierge.html: " + err.message);
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store", // always serve the file as it is on disk
    });
    res.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`Concierge demo frontend  → http://localhost:${PORT}`);
  console.log(`Expecting dashboard-server → http://localhost:8080  (npm start / node server.js)`);
});
