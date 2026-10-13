import { pino } from "pino";

export let logger = pino(
  {
    level: "info"
  }
);
