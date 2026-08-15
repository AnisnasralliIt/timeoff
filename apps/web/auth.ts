import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { prisma } from "@timeoff/db";
import type { Role } from "@timeoff/db";

const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const { handlers, auth: rawAuth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email =
          typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const user = await prisma.user.findFirst({ where: { email } });
        if (!user?.passwordHash || user.status !== "ACTIVE") return null;
        const matches = await bcrypt.compare(password, user.passwordHash);
        if (!matches) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    ...(googleConfigured ? [Google] : []),
  ],
  callbacks: {
    signIn: async ({ user, account }) => {
      if (account?.provider === "google") {
        const dbUser = await prisma.user.findFirst({ where: { email: user.email ?? "" } });
        return Boolean(dbUser && dbUser.status === "ACTIVE");
      }
      return true;
    },
    jwt: async ({ token, user, trigger }) => {
      if (user?.email) {
        const dbUser = await prisma.user.findFirst({ where: { email: user.email } });
        if (dbUser) {
          token.sub = dbUser.id;
          token.role = dbUser.role;
          token.companyId = dbUser.companyId;
          token.departmentId = dbUser.departmentId;
        }
      } else if (trigger === "update" && token.email) {
        const dbUser = await prisma.user.findFirst({ where: { email: token.email } });
        if (dbUser) {
          token.role = dbUser.role;
          token.companyId = dbUser.companyId;
          token.departmentId = dbUser.departmentId;
        }
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (!session.user || !token.sub) return session;
      // Single source of truth: the DB, not the JWT. The token is minted at
      // login and only refreshed on an explicit "update" trigger, so after a
      // DB reset/re-seed (which recreates the company and users with new ids)
      // a stale cookie would otherwise surface a deleted user or a companyId
      // that no longer exists. Resolving here means `session.user.companyId`
      // is always the account's current company, so guards like
      // syncCurrentAccruals(prisma, user.companyId!) never hit a ghost id.
      const dbUser = await prisma.user.findUnique({ where: { id: token.sub } });
      if (!dbUser) {
        // The account no longer exists (e.g. tenant was re-seeded): present as
        // signed-out so route guards redirect to /login instead of crashing.
        session.user.id = "";
        return session;
      }
      session.user.id = dbUser.id;
      session.user.email = dbUser.email;
      session.user.name = dbUser.name;
      session.user.role = dbUser.role as Role | undefined;
      session.user.companyId = dbUser.companyId as string | undefined;
      session.user.departmentId = dbUser.departmentId as string | undefined;
      return session;
    },
  },
});

// The layout, notification bell and each page all call `auth()` in the same
// request. Without memoization every call re-runs the session callback (a DB
// hit per call). Caching it per request returns the identical session for all
// call sites, so a navigation resolves the user exactly once.
export const auth = cache(rawAuth);
export { handlers, signIn, signOut };
