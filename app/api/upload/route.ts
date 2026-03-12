import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Role } from "@prisma/client";
import { writeFile, mkdir } from "fs/promises";
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

  // RBAC check — only users who can manage clients may upload
  const role = session.user.role as Role;
  if (!hasPermission(role, "clients:update")) {
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

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), "public", "uploads", folder);
    await mkdir(uploadDir, { recursive: true });

    // Write file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(path.join(uploadDir, filename), buffer);

    const url = `/uploads/${folder}/${filename}`;
    return NextResponse.json({ url });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
