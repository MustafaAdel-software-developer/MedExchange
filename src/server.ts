import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { logger } from "./log.js";
import { ErrorMessages, StatusCodes } from "./http/contstans.js";
import {  HttpError, sendError } from "./http/error.js";


const status_codes = new StatusCodes;
const error_messages = new ErrorMessages;
// Rule: an incoming x-request-id is kept only if it is exactly one UUID.
// Anything else (empty, wrong shape, repeated header) gets a fresh UUID.
// Deliberate cost: ids from other systems in another format are replaced.
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApp(){
    const server = createServer((req, res) => {
  try {
    const incoming = req.headers["x-request-id"];
    const requestId =
      typeof incoming === "string" && uuidRegex.test(incoming)
        ? incoming
        : randomUUID();
    const start = performance.now();

    // Shared by every route: the header, and one log line when the response is done.
    res.setHeader("x-request-id", requestId);
    res.on("finish", () => {
      logger.info({
        requestId,
        method: req.method,
        url: req.url,
        status: res.statusCode,
        ms: performance.now() - start,
      });
    });

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }
    if(req.method === "GET" && req.url === "/slow"){
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok\n");
      }, 3000);
      
    }
    else{
      const os = {
        code: status_codes.not_here,
        message: error_messages.not_here,
      }
      throw new HttpError(os);
    }

  } catch (err: HttpError | unknown) {
      sendError(res, res.getHeader("x-request-id") as string, err);
      return;
  }
});
return server;
}