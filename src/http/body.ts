import { IncomingMessage } from "node:http";
import { HttpError, sendError } from "./error.js";
import { ErrorMessages, StatusCodes } from "./contstans.js";

const MAX_BODY_SIZE = 64 * 1024;
const payload_error = new ErrorMessages().payload_too_long;

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let chunksSizeCheck = 0;

    req.on("data", (chunk) => {
      chunksSizeCheck += chunk.length;

      if (chunksSizeCheck > MAX_BODY_SIZE) {
        reject(
          new HttpError({
            status: new StatusCodes().payload_too_long,
            code: "payload_too_long",
            message: payload_error,
          })
        );
      return;
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
      status: 400,
      code: "invalid_json",
      message: new ErrorMessages().invalid_json,
    });
  }
}
