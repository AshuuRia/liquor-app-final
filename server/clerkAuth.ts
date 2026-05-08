import type { RequestHandler } from "express";

let _jwksCache: any[] = [];
let _jwksCacheExpiry = 0;

function b64url(s: string): string {
  return s.replace(/-/g, "+").replace(/_/g, "/");
}

// Derive the public JWKS URL from the publishable key — no secret key needed.
// Format: pk_test_<base64(frontendApi$)> or pk_live_<base64(frontendApi$)>
function getPublicJwksUrl(): string {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? "";
  const b64 = publishableKey.replace(/^pk_(test|live)_/, "");
  const frontendApi = Buffer.from(b64, "base64").toString("utf-8").replace(/\$$/, "");
  return `https://${frontendApi}/.well-known/jwks.json`;
}

async function getJwks(): Promise<any[]> {
  if (_jwksCache.length && Date.now() < _jwksCacheExpiry) return _jwksCache;

  const url = getPublicJwksUrl();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch Clerk JWKS from ${url}: ${res.status}`);
  const data = (await res.json()) as { keys: any[] };
  _jwksCache = data.keys;
  _jwksCacheExpiry = Date.now() + 60 * 60 * 1000;
  return _jwksCache;
}

// Returns the full JWT payload on success, null on failure.
export async function verifyClerkToken(token: string): Promise<Record<string, any> | null> {
  try {
    const [hb64, pb64, sb64] = token.split(".");
    if (!hb64 || !pb64 || !sb64) return null;

    const header = JSON.parse(Buffer.from(b64url(hb64), "base64").toString());
    const keys = await getJwks();
    const jwk = keys.find((k: any) => k.kid === header.kid);
    if (!jwk) return null;

    const { createPublicKey, createVerify } = await import("crypto");
    const pubKey = createPublicKey({ key: jwk, format: "jwk" });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${hb64}.${pb64}`);
    const sig = Buffer.from(b64url(sb64), "base64");
    if (!verifier.verify(pubKey, sig)) return null;

    const payload = JSON.parse(Buffer.from(b64url(pb64), "base64").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export const isAuthenticated: RequestHandler = async (req: any, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const payload = await verifyClerkToken(authHeader.slice(7));
  if (!payload) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  req.clerkUserId = payload.sub as string;
  req.clerkPayload = payload;
  next();
};

// Returns user profile. Uses the Clerk Users API if CLERK_SECRET_KEY is set,
// otherwise falls back to claims embedded in the JWT payload.
export async function fetchClerkUser(userId: string, payload?: Record<string, any>): Promise<any> {
  if (process.env.CLERK_SECRET_KEY) {
    try {
      const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
        headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
      });
      if (res.ok) {
        const u = (await res.json()) as any;
        return {
          id: u.id,
          email: u.email_addresses?.[0]?.email_address ?? null,
          firstName: u.first_name ?? null,
          lastName: u.last_name ?? null,
          profileImageUrl: u.image_url ?? null,
        };
      }
    } catch {
      // fall through to payload extraction
    }
  }

  // Extract whatever Clerk embeds in the JWT payload
  return {
    id: userId,
    email: payload?.email ?? null,
    firstName: payload?.given_name ?? payload?.first_name ?? null,
    lastName: payload?.family_name ?? payload?.last_name ?? null,
    profileImageUrl: payload?.picture ?? payload?.image_url ?? null,
  };
}
