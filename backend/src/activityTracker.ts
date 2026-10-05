import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';

const uploadsDir = path.join(process.cwd(), 'uploads');
const dataFile = path.join(uploadsDir, 'user_activity.json');

// In-memory tracker
const activeUsersMap = new Map<string, number>(); // userId -> timestamp
const blockedUsersSet = new Set<string>();        // Set of userIds who blocked the bot
let totalStartsCount = 0;
let isDirty = false;
let isInitialized = false;

// Ensure uploads folder exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export function trackUserActivity(userId: string | number, source?: string) {
  if (!userId) return;
  const uid = String(userId);
  activeUsersMap.set(uid, Date.now());

  // If user was previously marked blocked, unblock them since they are active!
  if (blockedUsersSet.has(uid)) {
    blockedUsersSet.delete(uid);
  }
  isDirty = true;
}

export function recordUserStart(userId: string | number) {
  if (!userId) return;
  const uid = String(userId);
  activeUsersMap.set(uid, Date.now());
  if (blockedUsersSet.has(uid)) {
    blockedUsersSet.delete(uid);
  }
  isDirty = true;
}

export function recordUserBlocked(userId: string | number) {
  if (!userId) return;
  const uid = String(userId);
  blockedUsersSet.add(uid);
  isDirty = true;
}

export function recordUserUnblocked(userId: string | number) {
  if (!userId) return;
  const uid = String(userId);
  blockedUsersSet.delete(uid);
  activeUsersMap.set(uid, Date.now());
  isDirty = true;
}

// Save to disk
export function saveActivity() {
  if (!isDirty && fs.existsSync(dataFile)) return;
  try {
    const obj: any = {
      activeUsers: {},
      blockedUsers: Array.from(blockedUsersSet),
      totalStarts: totalStartsCount,
      lastSavedAt: Date.now()
    };

    // Only store active users from the last 35 days to keep JSON compact
    const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
    for (const [k, v] of activeUsersMap.entries()) {
      if (v >= cutoff) {
        obj.activeUsers[k] = v;
      }
    }

    fs.writeFileSync(dataFile, JSON.stringify(obj, null, 2), 'utf-8');
    isDirty = false;
  } catch (err) {
    console.error('[ACTIVITY] Failed to save user activity:', err);
  }
}

// Auto-save every 15 seconds if dirty
setInterval(saveActivity, 15000);

export async function initActivityTracker() {
  if (isInitialized) return;
  isInitialized = true;

  // 1. Load from file
  try {
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, 'utf-8');
      const data = JSON.parse(raw);
      if (data.activeUsers) {
        for (const [k, v] of Object.entries(data.activeUsers)) {
          activeUsersMap.set(k, v as number);
        }
      }
      if (Array.isArray(data.blockedUsers)) {
        for (const id of data.blockedUsers) {
          blockedUsersSet.add(String(id));
        }
      }
      if (data.totalStarts) {
        totalStartsCount = data.totalStarts;
      }
    }
  } catch (err) {
    console.error('[ACTIVITY] Failed to load activity file:', err);
  }

  // 2. Pre-populate active users from DB in background
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [recentPayments, activeSubs, recentJoinRequests] = await Promise.all([
      prisma.payment.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { userId: true, createdAt: true },
        take: 3000
      }).catch(() => []),
      prisma.subscription.findMany({
        where: { status: 'ACTIVE' },
        select: { userId: true },
        take: 5000
      }).catch(() => []),
      prisma.joinRequest.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { userId: true, createdAt: true },
        take: 3000
      }).catch(() => [])
    ]);

    for (const p of recentPayments) {
      const t = new Date(p.createdAt).getTime();
      const existing = activeUsersMap.get(p.userId) || 0;
      if (t > existing) activeUsersMap.set(p.userId, t);
    }
    for (const s of activeSubs) {
      const existing = activeUsersMap.get(s.userId) || 0;
      if (existing === 0) activeUsersMap.set(s.userId, Date.now() - 4 * 3600 * 1000); // active today
    }
    for (const j of recentJoinRequests) {
      const t = new Date(j.createdAt).getTime();
      const existing = activeUsersMap.get(j.userId) || 0;
      if (t > existing) activeUsersMap.set(j.userId, t);
    }

    saveActivity();
  } catch (err) {
    console.error('[ACTIVITY] Error populating from DB:', err);
  }
}

let cachedTotalUsers = 0;
let lastTotalUsersCheck = 0;

export async function getActivityStats() {
  const now = Date.now();
  const fiveMinsAgo = now - 5 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  let onlineNow = 0;
  let dailyActive = 0;
  let monthlyActive = 0;

  for (const [_, timestamp] of activeUsersMap.entries()) {
    if (timestamp >= fiveMinsAgo) onlineNow++;
    if (timestamp >= oneDayAgo) dailyActive++;
    if (timestamp >= thirtyDaysAgo) monthlyActive++;
  }

  // Ensure onlineNow has at least 1 (the current viewing admin)
  onlineNow = Math.max(1, onlineNow);
  dailyActive = Math.max(onlineNow, dailyActive);
  monthlyActive = Math.max(dailyActive, monthlyActive);

  // Cache total users count for 15 seconds to avoid DB spam
  if (now - lastTotalUsersCheck > 15000 || cachedTotalUsers === 0) {
    try {
      cachedTotalUsers = await prisma.user.count();
      lastTotalUsersCheck = now;
    } catch {
      // fallback
    }
  }

  const totalUsers = Math.max(cachedTotalUsers, activeUsersMap.size);
  const blockedCount = blockedUsersSet.size;

  const dailyPercent = totalUsers > 0 ? ((dailyActive / totalUsers) * 100).toFixed(1) : '0';
  const monthlyPercent = totalUsers > 0 ? ((monthlyActive / totalUsers) * 100).toFixed(1) : '0';
  const blockedPercent = totalUsers > 0 ? ((blockedCount / totalUsers) * 100).toFixed(1) : '0';

  return {
    dailyActive,
    monthlyActive,
    onlineNow,
    totalStarts: totalUsers,
    blockedCount,
    dailyPercent,
    monthlyPercent,
    blockedPercent,
    lastUpdated: now
  };
}
