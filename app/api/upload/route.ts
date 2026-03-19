import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Role } from "@prisma/client";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";

const ALLOWED_FOLDERS = new Set(["clients"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salonId = session.user.salonId;
  if (!salonId) {
    return NextResponse.json({ error: "No salon context" }, { status: 400 });
  }

  // RBAC check — only users who can manage clients may upload
  if (!session.user.salonRole) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.user.salonRole as Role;
  if (!hasPermission(role, "clients:update", session.user.isSuperAdmin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const requestedFolder = formData.get("folder");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Invalid file payload" }, { status: 400 });
    }

    // Validate MIME type from server-side allowlist
    const ext = EXT_BY_MIME[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Invalid file type. Only JPEG, PNG, and WebP are allowed." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    // Sanitize folder against allowlist to prevent path traversal
    const folder =
      typeof requestedFolder === "string" && ALLOWED_FOLDERS.has(requestedFolder)
        ? requestedFolder
        : "clients";

    // Generate unique filename using crypto UUID
    const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

    // Ensure upload directory exists (namespaced by salonId)
    const uploadDir = path.join(process.cwd(), "public", "uploads", salonId, folder);
    await mkdir(uploadDir, { recursive: true });

    // Write file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(path.join(uploadDir, filename), buffer);

    const url = `/uploads/${salonId}/${folder}/${filename}`;
    return NextResponse.json({ url });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salonId = session.user.salonId;
  if (!salonId) {
    return NextResponse.json({ error: "No salon context" }, { status: 400 });
  }

  if (!session.user.salonRole) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.user.salonRole as Role;
  if (!hasPermission(role, "clients:update", session.user.isSuperAdmin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { url } = await request.json();

    if (typeof url !== "string") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Validate the URL matches the expected salon-namespaced upload path pattern
    const match = url.match(/^\/uploads\/([^/]+)\/(clients)\/[A-Za-z0-9._-]+$/);
    if (!match || match[1] !== salonId || !ALLOWED_FOLDERS.has(match[2])) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), "public", url);
    await unlink(filePath).catch(() => {}); // ignore if already deleted

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
