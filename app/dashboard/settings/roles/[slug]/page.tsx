import { redirect } from "next/navigation";

/**
 * Role detail page — now handled inline on the combined roles page.
 * Redirect here in case anyone has bookmarked the old URL.
 */
export default async function RoleDetailPage() {
  redirect("/dashboard/settings/roles");
}
