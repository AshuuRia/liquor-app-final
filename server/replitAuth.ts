import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage as dbStorage } from "./storage";

if (!process.env.REPLIT_DEPLOYMENT && !process.env.REPL_ID) {
  throw new Error("REPL_ID is required");
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "http_sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET ?? "replit-liquor-secret-dev",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: !!process.env.REPLIT_DEPLOYMENT,
      maxAge: sessionTtl,
    },
    store: sessionStore,
  });
}

export function updateUserSession(
  req: any,
  user: any
) {
  req.session.passport = { user: user.claims() };
}

async function upsertUser(claims: any) {
  await (dbStorage as any).upsertUser?.({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  }).catch(() => {});
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (tokens, verified) => {
    const user = tokens.claims();
    await upsertUser(user);
    verified(null, tokens);
  };

  const strategy = new Strategy(
    {
      name: "replitauth:default",
      config,
      scope: "openid email profile offline_access",
      callbackURL: process.env.REPLIT_DEPLOYMENT
        ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/callback`
        : `https://${process.env.REPLIT_DEV_DOMAIN}/api/callback`,
    },
    verify
  );
  passport.use(strategy);

  passport.serializeUser((user: any, cb) => cb(null, user));
  passport.deserializeUser((user: any, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    passport.authenticate("replitauth:default", {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate("replitauth:default", {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {});
    res.redirect("/");
  });
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
};

export function getUserId(req: any): string {
  return req.user?.claims?.()?.sub ?? req.user?.passport?.user?.sub ?? "";
}

export function getUserProfile(req: any): any {
  const claims = req.user?.claims?.() ?? req.user?.passport?.user ?? {};
  return {
    id: claims.sub,
    email: claims.email ?? null,
    firstName: claims.first_name ?? null,
    lastName: claims.last_name ?? null,
    profileImageUrl: claims.profile_image_url ?? null,
  };
}
