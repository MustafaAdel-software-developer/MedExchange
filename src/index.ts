import { createApp } from "./server.js";

const server = createApp();

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}



process.on('SIGINT', handle);
process.on('SIGTERM', handle);

function handle() {
  console.log("shutting down");
    server.close(() => {
    console.log("all connections are closed");
    process.exit(0);
    });
  server.closeIdleConnections();
  setTimeout(() => {
    console.error("Forcing shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

server.listen(port, () => {
  console.log(`listening on ${port}`);
});