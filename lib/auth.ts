import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  isSuperAdminEmail,
  verifySuperAdminPassword,
  findOrCreateSuperAdminUser,
} from "@/lib/super-admin";

const prisma = new PrismaClient();

// Validate the auth-related environment at startup so a mistyped AUTH_TRUST_HOST fails fast with a
// clear error instead of silently reading as "off" — which, in production, breaks login with an
// opaque UntrustedHost error. Only "true"/"false" are accepted; unset (or empty) means "not trusted".
const authEnv = z
  .object({ AUTH_TRUST_HOST: z.enum(["true", "false"]).optional() })
  .safeParse({ AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST || undefined });
if (!authEnv.success) {
  throw new Error(
    `Invalid AUTH_TRUST_HOST=${JSON.stringify(process.env.AUTH_TRUST_HOST)} — must be "true" or "false".`
  );
}
const authTrustHostOptIn = authEnv.data.AUTH_TRUST_HOST === "true";

// Active impersonation/support session carried in the token. Set only for super
// admins who have "entered" a salon; null/absent otherwise. The DB
// ImpersonationSession row is the source of truth — this is a fast-path mirror.
export type ImpersonationClaim = {
  sessionId: string;
  mode: "PLATFORM" | "AS_USER";
  salonId: string;
  actingAsUserId: string | null;
  expiresAt: number; // epoch ms
} | null;

declare module "next-auth" {
  interface User {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isSuperAdmin: boolean;
    salonId: string | null;
    salonRole: string | null;
    salonRoleId: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      firstName: string;
      lastName: string;
      /**
       * EFFECTIVE elevated access. True for a real super admin who is NOT acting
       * as a tenant user (i.e. logged out of impersonation, or in PLATFORM
       * "Enter salon" mode). False while impersonating a user (AS_USER), so the
       * whole app treats them exactly like that user. Use this for permission/data gating.
       */
      isSuperAdmin: boolean;
      /**
       * REAL platform identity, regardless of impersonation mode. Use this only for
       * control-plane surfaces (/admin, salon management, the impersonation flow).
       */
      isPlatformAdmin: boolean;
      salonId: string | null;
      salonRole: string | null;
      salonRoleId: string | null;
      impersonation: ImpersonationClaim;
    };
  }
}

// Extend JWT token type
interface CustomJWT {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
  salonId: string | null;
  salonRole: string | null;
  salonRoleId: string | null;
  impersonation: ImpersonationClaim;
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

        // Super admin: credentials live ONLY in env. Validate against env
        // (timing-safe), then lazily resolve the FK-anchor DB row. The DB
        // password column is never consulted for this account.
        if (isSuperAdminEmail(email)) {
          if (!verifySuperAdminPassword(password)) {
            return null;
          }
          const sa = await findOrCreateSuperAdminUser(prisma);
          return {
            id: sa.id,
            email: sa.email,
            firstName: sa.firstName,
            lastName: sa.lastName,
            isSuperAdmin: true,
            salonId: null,
            salonRole: null,
            salonRoleId: null,
          };
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            salon: { select: { isActive: true } },
            roleDefinition: { select: { id: true, slug: true } },
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
          salonRole: user.roleDefinition?.slug ?? null,
          salonRoleId: user.roleDefinitionId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        // Initial login
        token.id = user.id;
        token.email = user.email!;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.isPlatformAdmin = user.isSuperAdmin;
        token.salonId = user.salonId;
        token.salonRole = user.salonRole;
        token.salonRoleId = user.salonRoleId;
        token.impersonation = null;
      }

      // Impersonation enter/exit — super admins only. The client sends just a
      // session id (or null); everything else is read from the DB row, never trusted
      // from the client.
      if (trigger === "update" && updateData?.impersonation !== undefined) {
        const payload = updateData.impersonation as { sessionId: string } | null;
        if (payload === null) {
          // Exit: drop back to the platform plane (no active salon)
          token.salonId = null;
          token.salonRole = null;
          token.salonRoleId = null;
          token.impersonation = null;
        } else if (token.isPlatformAdmin) {
          const sess = await prisma.impersonationSession.findUnique({
            where: { id: payload.sessionId },
          });
          if (
            sess &&
            sess.impersonatorUserId === token.id &&
            !sess.endedAt &&
            sess.expiresAt.getTime() > Date.now()
          ) {
            token.salonId = sess.salonId;
            token.impersonation = {
              sessionId: sess.id,
              mode: sess.mode,
              salonId: sess.salonId,
              actingAsUserId: sess.actingAsUserId,
              expiresAt: sess.expiresAt.getTime(),
            };
            if (sess.mode === "AS_USER" && sess.actingAsUserId) {
              // Borrow the acting user's role AT THIS SALON
              const us = await prisma.userSalon.findUnique({
                where: {
                  userId_salonId: { userId: sess.actingAsUserId, salonId: sess.salonId },
                },
                include: { roleDefinition: { select: { slug: true, id: true } } },
              });
              token.salonRole = us?.roleDefinition.slug ?? null;
              token.salonRoleId = us?.roleDefinitionId ?? null;
            } else {
              // PLATFORM ("Enter salon") — unrestricted, no borrowed role
              token.salonRole = null;
              token.salonRoleId = null;
            }
          }
        }
      }

      // Salon switch — verify against DB instead of trusting client values
      if (trigger === "update" && updateData?.salonId) {
        const userSalon = await prisma.userSalon.findUnique({
          where: {
            userId_salonId: {
              userId: token.id as string,
              salonId: updateData.salonId as string,
            },
            isActive: true,
          },
          include: {
            salon: { select: { isActive: true } },
            roleDefinition: { select: { id: true, slug: true } },
          },
        });

        if (userSalon && userSalon.salon.isActive) {
          token.salonId = userSalon.salonId;
          token.salonRole = userSalon.roleDefinition.slug;
          token.salonRoleId = userSalon.roleDefinitionId;
        }
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
        // Real platform identity (control plane).
        session.user.isPlatformAdmin = t.isPlatformAdmin;
        // Effective access (data plane): a real super admin acting AS_USER is
        // treated as that tenant user everywhere downstream.
        const actingAsUser = t.impersonation?.mode === "AS_USER";
        session.user.isSuperAdmin = t.isPlatformAdmin && !actingAsUser;
        session.user.salonId = t.salonId;
        session.user.salonRole = t.salonRole;
        session.user.salonRoleId = t.salonRoleId;
        session.user.impersonation = t.impersonation ?? null;
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
  // Trust the incoming request host in development (so auth works on whatever port `next dev`
  // binds to, 3000/3001/…, without hardcoding a URL). In production it stays false UNLESS the
  // operator explicitly opts in with AUTH_TRUST_HOST=true — the standard Auth.js setting for
  // running behind a trusted reverse proxy (e.g. Railway). Never trust a spoofable host header in
  // prod by default.
  trustHost: process.env.NODE_ENV !== "production" || authTrustHostOptIn,
});
