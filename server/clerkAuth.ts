import type { RequestHandler } from "express";

let _jwksCache: any[] = [];
let _jwksCacheExpiry = 0;

function b64url(s: string): string {
  return s.replace(/-/g, "+").replace(/_/g, "/");
}

async function getJwks(): Promise<any[]> {
  if (_jwksCache.length && Date.now() < _jwksCacheExpiry) return _jwksCache;
  const secretKey = process.env.CLERK_SECRET_KEY!;
  const res = await fetch("https://api.clerk.com/v1/jwks", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Clerk JWKS");
  const { keys } = (await res.json()) as { keys: any[] };
  _jwksCache = keys;
  _jwksCacheExpiry = Date.now() + 60 * 60 * 1000;
  return _jwksCache;
}

export async function verifyClerkToken(token: string): Promise<string | null> {
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

    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export const isAuthenticated: RequestHandler = async (req: any, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userId = await verifyClerkToken(authHeader.slice(7));
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  req.clerkUserId = userId;
  next();
};

export async function fetchClerkUser(userId: string): Promise<any> {
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
  });
  if (!res.ok) return { id: userId };
  const u = (await res.json()) as any;
  return {
    id: u.id,
    email: u.email_addresses?.[0]?.email_address ?? null,
    firstName: u.first_name ?? null,
    lastName: u.last_name ?? null,
    profileImageUrl: u.image_url ?? null,
  };
}
