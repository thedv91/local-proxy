import { z } from "zod";

export const CORS_MODES = ["reflect", "pass-through"] as const;
export type CorsMode = (typeof CORS_MODES)[number];

const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const extraHeaderSchema = z.object({
  name: z.string().trim().regex(headerNamePattern, "Invalid header name"),
  value: z.string(),
});

export const recordOptionsSchema = z.object({
  cors: z.enum(CORS_MODES).default("reflect"),
  dropOriginReferer: z.boolean().default(true),
  extraHeaders: z.array(extraHeaderSchema).default([]),
  rewriteSetCookie: z.boolean().default(true),
  rewriteLocation: z.boolean().default(true),
  timeoutSeconds: z.number().int().min(1).max(600).default(30),
  skipTlsVerify: z.boolean().default(false),
});

export const sourceSchema = z
  .string()
  .trim()
  .refine((value) => URL.canParse(value), "Source must be a full URL, e.g. https://api.example.com")
  .refine(
    (value) => !URL.canParse(value) || ["http:", "https:"].includes(new URL(value).protocol),
    "Source must start with http:// or https://",
  );

/** What the admin API accepts for create and update. The domain is checked against portless separately. */
export const recordInputSchema = z.object({
  source: sourceSchema,
  domain: z.string().trim().toLowerCase(),
  enabled: z.boolean().default(true),
  options: recordOptionsSchema.default(recordOptionsSchema.parse({})),
});

export const proxyRecordSchema = recordInputSchema.extend({
  id: z.string(),
  /** Listener port, kept across restarts. Null until the record first starts. */
  port: z.number().int().nullable(),
});

export const recordsFileSchema = z.object({
  version: z.literal(1),
  /** portless alias names this tool registered; the only names it may overwrite or remove. */
  ownedAliases: z.array(z.string()).default([]),
  records: z.array(proxyRecordSchema).default([]),
});

export type RecordOptions = z.infer<typeof recordOptionsSchema>;
export type RecordInput = z.infer<typeof recordInputSchema>;
export type ProxyRecord = z.infer<typeof proxyRecordSchema>;
export type RecordsFile = z.infer<typeof recordsFileSchema>;

export const DEFAULT_OPTIONS: RecordOptions = recordOptionsSchema.parse({});
