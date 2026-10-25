import { IncomingMessage } from "node:http";
import { HttpError } from "./error.js";
import { ErrorMessages } from "./contstans.js";

const MAX_BODY_SIZE = 64 * 1024;
const payload_error = new ErrorMessages().payload_too_long;

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let chunksSizeCheck = 0;

    req.on("data", (chunk) => {
      chunksSizeCheck += chunk.length;

      if (chunksSizeCheck > MAX_BODY_SIZE) {
        req.destroy();
        reject(
          new HttpError({
            status: "payload_too_long",
            code: "413",
            message: payload_error,
          }),
        );
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req);
  try {
    return JSON.parse(body) as unknown;
  } catch (err) {
    throw new HttpError({
      status: "invalid_json",
      code: "400",
      message: "Bad JSON.",
    });
  }
}
