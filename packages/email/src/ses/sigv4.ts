/**
 * AWS Signature Version 4, over `crypto.subtle` so it runs on the Worker as
 * on Node (docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html).
 * Tested against AWS's own published test suite, not against itself.
 */

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(data: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(data)));
}

async function hmac(
  key: ArrayBuffer | Uint8Array<ArrayBuffer>,
  data: string,
): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(data));
}

/** RFC 3986, which is what AWS means by URI-encoding. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface SignV4Input {
  method: string;
  url: string;
  /** Headers to send and sign beside `host` and `x-amz-date`. */
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  now?: Date;
  /**
   * Whether to send and sign `x-amz-content-sha256`. SES does not need it and
   * accepts it; AWS's generic test cases are written without it.
   */
  signPayloadHeader?: boolean;
}

export async function signV4({
  method,
  url,
  headers,
  body,
  region,
  service,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  now = new Date(),
  signPayloadHeader = true,
}: SignV4Input): Promise<{ authorization: string; headers: Record<string, string> }> {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const target = new URL(url);
  const payloadHash = await sha256(body);

  const sent: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) sent[name.toLowerCase()] = value;
  sent["x-amz-date"] = amzDate;
  if (signPayloadHeader) sent["x-amz-content-sha256"] = payloadHash;
  if (sessionToken) sent["x-amz-security-token"] = sessionToken;
  const signing: Record<string, string> = { ...sent, host: target.host };

  const names = Object.keys(signing).sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${(signing[name] ?? "").trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");
  const query = [...target.searchParams.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const canonicalRequest = [
    method.toUpperCase(),
    target.pathname || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join(
    "\n",
  );
  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    // `host` is signed but never set by hand: the runtime sends the URL's own.
    headers: sent,
  };
}
