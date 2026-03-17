import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

declare module "next-auth" {
  interface User {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isSuperAdmin: boolean;
    salonId: string | null;
    salonRole: Role | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      firstName: string;
      lastName: string;
      isSuperAdmin: boolean;
      salonId: string | null;
      salonRole: Role | null;
    };
  }
}

// Extend JWT token type
interface CustomJWT {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  salonId: string | null;
  salonRole: Role | null;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            salon: { select: { isActive: true } },
          },
        });

        if (!user || !user.isActive) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
          return null;
        }

        // Non-superadmins must belong to an active salon
        if (!user.isSuperAdmin) {
          if (!user.salonId || !user.salon?.isActive) {
            return null;
          }
        }

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isSuperAdmin: user.isSuperAdmin,
          salonId: user.salonId,
          salonRole: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial login
        token.id = user.id;
        token.email = user.email!;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.isSuperAdmin = user.isSuperAdmin;
        token.salonId = user.salonId;
        token.salonRole = user.salonRole;
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        const t = token as unknown as CustomJWT;
        session.user.id = t.id;
        session.user.email = t.email;
        session.user.firstName = t.firstName;
        session.user.lastName = t.lastName;
        session.user.name = `${t.firstName} ${t.lastName}`;
        session.user.isSuperAdmin = t.isSuperAdmin;
        session.user.salonId = t.salonId;
        session.user.salonRole = t.salonRole;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
});
