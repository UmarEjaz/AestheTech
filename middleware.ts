import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Routes that don't require authentication
const publicRoutes = ["/", "/login"];

// Routes that require SUPER_ADMIN
const superAdminRoutes = ["/admin"];

// Routes that require a selected salon
const salonRequiredPrefixes = ["/dashboard"];

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const pathname = nextUrl.pathname;

  // Allow public routes
  if (publicRoutes.includes(pathname)) {
    // Redirect logged-in users from login page to dashboard
    if (isLoggedIn && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const user = req.auth?.user;
  const isSuperAdmin = user?.isSuperAdmin ?? false;
  const salonId = user?.salonId;

  // Allow /select-salon for authenticated users without a salon selected
  if (pathname === "/select-salon") {
    // If user already has a salon selected, redirect to dashboard
    if (salonId) {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
    return NextResponse.next();
  }

  // SUPER_ADMIN routes (/admin/*)
  for (const route of superAdminRoutes) {
    if (pathname.startsWith(route)) {
      if (!isSuperAdmin) {
        return NextResponse.redirect(new URL("/dashboard", nextUrl));
      }
      return NextResponse.next();
    }
  }

  // Dashboard routes require a selected salon
  for (const prefix of salonRequiredPrefixes) {
    if (pathname.startsWith(prefix)) {
      if (!salonId) {
        return NextResponse.redirect(new URL("/select-salon", nextUrl));
      }
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
