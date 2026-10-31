// Sert ui/ en local pour prévisualiser l'interface (mode aperçu, sans Tauri) : node tools/serve.js
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "ui");
// La même CSP que l'application (tauri.conf.json), pour voir ici ce qu'elle bloquerait.
const csp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tauri.conf.json"), "utf8")).app.security.csp;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "Content-Security-Policy": csp }).end(data);
  });
}).listen(5178, "127.0.0.1", () => console.log("http://127.0.0.1:5178"));
