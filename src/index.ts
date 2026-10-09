import { createServer } from "node:http";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok\n");
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
});

server.listen(port, () => {
  console.log(`listening on ${port}`);
});
