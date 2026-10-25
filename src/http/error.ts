import { ServerResponse } from "node:http";
import { logger } from "../log.js";

type Details<T> = {
  errorDetails: T;
};

export class HttpError {
  status: number;
  code: string;
  message?: string;
  details?: Details<unknown>;

  constructor(options: {
    status: number;
    code: string;
    message?: string;
    details?: Details<unknown>;
  }) {
    this.status = options.status;
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
        status:err.status,
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId
    };
    res.writeHead(err.status, { "content-type": "application/json" });
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
