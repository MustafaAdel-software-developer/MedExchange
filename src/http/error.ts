import { ServerResponse } from "node:http";
import { logger } from "../log.js";

type Details = {
  requestId: string;
};

export class HttpError {
  status?: string;
  code: string;
  message: string;
  details?: Details;

  constructor(options: {
    status?: string;
    code: string;
    message: string;
    details?: Details;
  }) {
    this.status = options.status ?? "";
    this.code = options.code;
    this.message = options.message;
    this.details = options.details;
  }
}

export function sendError(
  res: ServerResponse,
  requestId: string,
  err: HttpError | unknown,
) {
  if (err instanceof HttpError) {
    const options = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId,
    };
    res.writeHead(404, { "content-type": "application/json" });
    res.end(`${JSON.stringify(options)}`);
  } else {
    logger.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "internal", message: "Something went wrong" },
        requestId,
      }),
    );
  }
}
