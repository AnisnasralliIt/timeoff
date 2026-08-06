import type { DefaultSession } from "next-auth";
import type { Role } from "@timeoff/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: Role;
      companyId?: string;
      departmentId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role?: Role;
    companyId?: string;
    departmentId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    companyId?: string;
    departmentId?: string;
  }
}
