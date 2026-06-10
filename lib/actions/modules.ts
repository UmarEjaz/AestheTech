"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet, invalidateSalonModuleCache } from "@/lib/redis";
import { logAudit } from "./audit";
import { ActionResult } from "@/lib/types";
import {
  ModuleKey,
  SalonModuleState,
  TOGGLEABLE_MODULES,
  TOGGLEABLE_MODULE_KEYS,
  isToggleableModuleKey,
} from "@/lib/modules";

const MODULE_CACHE_TTL = 300; // 5 minutes (matches permission cache)
const cacheKey = (salonId: string) => `salon:${salonId}:modules`;

// Request-level dedup so multiple module checks in one request hit the DB/Redis once.
const requestCache = new Map<string, Promise<Set<ModuleKey>>>();

/**
 * Parse the stored JSON value (an array of disabled module keys) defensively,
 * keeping only valid toggleable keys.
 */
function parseDisabled(value: unknown): ModuleKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter((k): k is ModuleKey => typeof k === "string" && isToggleableModuleKey(k));
}

async function loadDisabledFromDB(salonId: string): Promise<Set<ModuleKey>> {
  const cached = await cacheGet<ModuleKey[]>(cacheKey(salonId));
  if (cached) return new Set(cached);

  const settings = await prisma.settings.findUnique({
    where: { salonId },
    select: { disabledModules: true },
  });

  const disabled = parseDisabled(settings?.disabledModules);
  await cacheSet(cacheKey(salonId), disabled, MODULE_CACHE_TTL);
  return new Set(disabled);
}

/**
 * Internal: the set of DISABLED module keys for a salon (cached, request-deduped).
 * Not exported as a server action (returns a Set); use isModuleEnabled / getSalonModules.
 */
function getDisabledSet(salonId: string): Promise<Set<ModuleKey>> {
  if (!requestCache.has(salonId)) {
    const p = loadDisabledFromDB(salonId);
    requestCache.set(salonId, p);
    p.finally(() => setTimeout(() => requestCache.delete(salonId), 100));
  }
  return requestCache.get(salonId)!;
}

/**
 * Is a given module enabled for this salon? Defaults to enabled (true) when the
 * salon has no config or the key isn't toggleable (always-on modules like
 * dashboard/settings are never disabled).
 */
export async function isModuleEnabled(salonId: string, moduleKey: ModuleKey): Promise<boolean> {
  const disabled = await getDisabledSet(salonId);
  return !disabled.has(moduleKey);
}

/**
 * Full on/off map for every toggleable module (for the sidebar / UI).
 */
export async function getSalonModules(
  salonId: string
): Promise<Record<ModuleKey, boolean>> {
  const disabled = await getDisabledSet(salonId);
  const map = {} as Record<ModuleKey, boolean>;
  for (const key of TOGGLEABLE_MODULE_KEYS) map[key] = !disabled.has(key);
  return map;
}

/**
 * The salon's disabled module keys as an array (for the client ModulesProvider).
 */
export async function getDisabledModulesForSalon(salonId: string): Promise<ModuleKey[]> {
  const disabled = await getDisabledSet(salonId);
  return [...disabled];
}

/**
 * Super-admin read: the per-salon module states for the toggle UI in /admin.
 */
export async function getSalonModuleStates(
  salonId: string
): Promise<ActionResult<SalonModuleState[]>> {
  const session = await auth();
  if (!session?.user?.isPlatformAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  const disabled = await getDisabledSet(salonId);
  return {
    success: true,
    data: TOGGLEABLE_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      enabled: !disabled.has(m.key),
    })),
  };
}

/**
 * Super-admin write: set a salon's DISABLED module list. Validates keys, ignores
 * unknown/always-on keys, audit-logs the change, and invalidates the cache.
 */
export async function setSalonModules(
  salonId: string,
  disabledKeys: string[]
): Promise<ActionResult<{ disabledModules: ModuleKey[] }>> {
  const session = await auth();
  if (!session?.user?.isPlatformAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true, name: true },
  });
  if (!salon) {
    return { success: false, error: "Salon not found" };
  }

  // Keep only valid, toggleable keys (dedup). Always-on modules can never be disabled.
  const cleaned = [...new Set(disabledKeys.filter(isToggleableModuleKey))];

  await prisma.settings.update({
    where: { salonId },
    data: { disabledModules: cleaned },
  });

  await invalidateSalonModuleCache(salonId);

  await logAudit({
    action: "SALON_MODULES_UPDATED",
    entityType: "Settings",
    entityId: salonId,
    userId: session.user.id,
    userRole: "SUPER_ADMIN",
    salonId,
    isPlatformAction: true,
    details: { disabledModules: cleaned },
  });

  return { success: true, data: { disabledModules: cleaned } };
}
