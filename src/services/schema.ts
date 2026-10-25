import { z } from "zod";

export const CreateService = z
  .object({
    title: z.string().min(1).max(120),
    priceCents: z.number().int().min(0),
  })
  .strict();

