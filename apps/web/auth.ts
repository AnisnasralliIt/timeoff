import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@timeoff/db";
import type { Role } from "@timeoff/db";

const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
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
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role as Role | undefined;
        session.user.companyId = token.companyId as string | undefined;
        session.user.departmentId = token.departmentId as string | undefined;
      }
      return session;
    },
  },
});
