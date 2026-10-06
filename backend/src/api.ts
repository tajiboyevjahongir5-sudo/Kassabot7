import express from 'express';
import cors from 'cors';
import compression from 'compression';
import NodeCache from 'node-cache';
import { Markup } from 'telegraf';
import { prisma } from './prisma';
import { bot, confirmLiveDonation, recentChannelPosts, textContainsAmount, isAdmin } from './bot';

import path from 'path';
import fs from 'fs';
import { validateWebAppData } from './utils/telegramAuth';
import { donationEvents } from './donationEvents.js';
import { getActivityStats, trackUserActivity, recordUserBlocked } from './activityTracker.js';

// In-memory cache — TTL 30 seconds for stats, 5 mins for channels
const cache = new NodeCache({ stdTTL: 30, checkperiod: 10, useClones: false });

export const app = express();
app.use(cors());
app.use(compression()); // gzip all responses — reduces bandwidth up to 70%
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Track user activity on every incoming WebApp request
app.use((req, res, next) => {
  try {
    const initData = req.headers['x-telegram-init-data'] as string | undefined;
    if (initData) {
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');
      if (userStr) {
        const u = JSON.parse(userStr);
        if (u.id) trackUserActivity(u.id, 'webapp');
      }
    }
    const uid = req.body?.userId || req.query?.userId;
    if (uid) trackUserActivity(uid, 'api');
  } catch {}
  next();
});

// Ensure upload folders exist for video and media gifts
const uploadsDir = path.join(process.cwd(), 'uploads');
const giftsUploadsDir = path.join(uploadsDir, 'gifts');
if (!fs.existsSync(giftsUploadsDir)) {
  fs.mkdirSync(giftsUploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  immutable: true
}));



// Health check route for Railway (must be BEFORE static files to avoid libuv thread pool exhaustion)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// App deep link redirect bridge for Click, Payme, and Uzum
app.get('/api/pay/redirect/:app', (req, res) => {
  const { app } = req.params;
  let scheme = 'clickuz://';
  let appName = 'Click';
  let icon = '🟢';

  if (app === 'payme') {
    scheme = 'payme://';
    appName = 'Payme';
    icon = '🔵';
  } else if (app === 'uzum') {
    scheme = 'uzumbank://';
    appName = 'Uzum Bank';
    icon = '🟣';
  }

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName} ga o'tish</title>
  <style>
    body { background: #0b0c10; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
    .card { background: #1a1c29; border: 1px solid rgba(255,255,255,0.1); border-radius: 18px; padding: 28px 20px; max-width: 320px; width: 100%; box-shadow: 0 15px 35px rgba(0,0,0,0.6); }
    .btn { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; padding: 14px 20px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 15px; display: block; margin-top: 18px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 42px; margin-bottom: 12px;">${icon}</div>
    <h2 style="margin: 0 0 8px 0; font-size: 18px;">${appName} ilovasi ochilmoqda...</h2>
    <p style="opacity: 0.7; font-size: 13px; margin: 0 0 8px 0;">Karta raqami buferga nusxalandi.</p>
    <p style="opacity: 0.5; font-size: 12px; margin: 0;">Agar ilova avtomatik ochilmasa, pastdagi tugmani bosing:</p>
    <a class="btn" href="${scheme}">Ilovani ochish</a>
  </div>
  <script>
    setTimeout(function() {
      window.location.href = "${scheme}";
    }, 100);
  </script>
</body>
</html>`);
});

// Serve static files from frontend build is handled at the bottom of the file

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const initData = req.headers['x-telegram-init-data'] as string;
  const botToken = process.env.BOT_TOKEN;
  const adminIdEnv = process.env.ADMIN_ID;

  if (!adminIdEnv || !adminIdEnv.trim()) {
    return res.status(403).json({ error: 'Forbidden: ADMIN_ID not configured on server' });
  }

  if (!initData || !botToken) {
    return res.status(401).json({ error: 'Unauthorized: Missing initData or token' });
  }

  const user = validateWebAppData(initData, botToken);
  const adminIds = adminIdEnv.split(',').map(id => id.trim()).filter(Boolean);

  if (!user || !adminIds.includes(user.id?.toString())) {
    return res.status(403).json({ error: 'Forbidden: You are not the admin' });
  }

  next();
};

export const checkRequestIsAdmin = (req: express.Request): boolean => {
  try {
    const initData = req.headers['x-telegram-init-data'] as string;
    const botToken = process.env.BOT_TOKEN;
    const adminIdEnv = process.env.ADMIN_ID;

    if (!adminIdEnv || !adminIdEnv.trim() || !initData || !botToken) {
      return false;
    }

    const user = validateWebAppData(initData, botToken);
    const adminIds = adminIdEnv.split(',').map(id => id.trim()).filter(Boolean);

    return Boolean(user && adminIds.includes(user.id?.toString()));
  } catch {
    return false;
  }
};

// Get all channels (public)
app.get('/api/channels', async (req, res) => {
  try {
    const channels = await prisma.channel.findMany({
      where: { isDeleted: false },
      include: { 
        plans: {
          where: { isDeleted: false }
        } 
      }
    });
    res.json(channels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all channels (admin)
app.get('/api/admin/channels', requireAdmin, async (req, res) => {
  try {
    const channels = await prisma.channel.findMany({
      where: { isDeleted: false },
      include: { 
        plans: {
          where: { isDeleted: false }
        } 
      }
    });
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

// Get user subscriptions
app.get('/api/subscriptions/:userId', async (req, res) => {
  try {
    const subs = await prisma.subscription.findMany({
      where: { userId: req.params.userId, status: 'ACTIVE' },
      include: { channel: true }
    });
    res.json(subs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check mandatory subscriptions for WebApp
app.post('/api/check-subscription', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const mandatoryChannels = await prisma.mandatoryChannel.findMany({ orderBy: { order: 'asc' } });
    if (mandatoryChannels.length === 0) return res.json({ ok: true, missing: [] });

    const missing: any[] = [];
    for (const ch of mandatoryChannels) {
      try {
        if ((ch as any).type === 'BOT') {
          const isSubbed = await prisma.botSubscriber.findFirst({
            where: { userId: String(userId), logChannelId: ch.channelId }
          });
          if (!isSubbed) missing.push(ch);
        } else {
          const member = await bot.telegram.getChatMember(ch.channelId, Number(userId));
          if (!['member', 'administrator', 'creator'].includes(member.status)) {
            missing.push(ch);
          }
        }
      } catch {
        missing.push(ch);
      }
    }

    res.json({ ok: missing.length === 0, missing });
  } catch (err) {
    console.error('check-subscription error:', err);
    res.json({ ok: true, missing: [] }); // fail open
  }
});

// Create manual payment with random suffix
app.post('/api/create-payment', async (req, res) => {
  const { channelId, planId, userId, promoCode } = req.body;
  
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  try {
    const adminEnvRaw = process.env.ADMIN_ID?.trim();
    const adminIds = adminEnvRaw ? adminEnvRaw.split(',').map(id => id.trim()).filter(Boolean) : [];
    const isAdmin = adminIds.length > 0 && adminIds.includes(String(userId));

    if (isAdmin) {
      const expiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);
      
      // Update existing or create new
      const existingSub = await prisma.subscription.findFirst({
        where: { userId: String(userId), channelId: plan.channelId }
      });

      if (existingSub) {
        await prisma.subscription.update({
          where: { id: existingSub.id },
          data: { status: 'ACTIVE', expiresAt }
        });
      } else {
        await prisma.subscription.create({
          data: {
            userId: String(userId),
            channelId: plan.channelId,
            status: 'ACTIVE',
            expiresAt
          }
        });
      }

      try {
        const { bot } = await import('./bot.js');
        const inviteLink = await bot.telegram.createChatInviteLink(plan.channelId, {
          creates_join_request: true,
          expire_date: Math.floor(Date.now() / 1000) + 7 * 86400,
        });

        const durationText = plan.duration === 0 ? "butun umr" : `${plan.duration} kun`;

        await bot.telegram.sendMessage(
          String(userId),
          `👑 Admin sifatida sizga tekin obuna faollashtirildi!\n\nObunangiz ${durationText} amal qiladi.\n\nKanalga kirish havolasi:\n${inviteLink.invite_link}`
        );
      } catch (err) {
        console.error('Admin invite link error:', err);
      }

      return res.json({ adminBypass: true });
    }
    // Check if user already has a pending payment for this plan to avoid creating duplicates needlessly
    const existing = await prisma.payment.findFirst({
      where: { userId: String(userId), planId, status: 'PENDING' }
    });

    if (existing) {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      if (existing.createdAt < thirtyMinutesAgo) {
        await prisma.payment.update({
          where: { id: existing.id },
          data: { status: 'CANCELLED' }
        });
      } else {
        return res.json({ payment: existing });
      }
    }

    // Calculate price with promo code discount
    let basePrice = plan.price;
    let appliedPromo: string | null = null;

    if (promoCode) {
      const promo = await prisma.promoCode.findUnique({ where: { code: promoCode.toUpperCase() } });
      if (promo && promo.active && (promo.maxUses === 0 || promo.usedCount < promo.maxUses)) {
        if (promo.discountType === 'percent') {
          basePrice = Math.round(basePrice * (1 - promo.discountValue / 100));
        } else {
          basePrice = Math.max(basePrice - promo.discountValue, 0);
        }
        appliedPromo = promo.code;

        // Increment usage count
        await prisma.promoCode.update({
          where: { id: promo.id },
          data: { usedCount: promo.usedCount + 1 }
        });
      }
    }

    // Generate unique random suffix 1 to 999 that is not currently busy for PENDING payments
    const pendingPayments = await prisma.payment.findMany({
      where: { status: 'PENDING' },
      select: { amount: true }
    });
    const busyAmounts = new Set(pendingPayments.map(p => p.amount));

    let randomSuffix = 0;
    let attempts = 0;
    const maxAttempts = 1000;

    while (attempts < maxAttempts) {
      const testSuffix = Math.floor(Math.random() * 999) + 1;
      const testAmount = basePrice + testSuffix;
      if (!busyAmounts.has(testAmount)) {
        randomSuffix = testSuffix;
        break;
      }
      attempts++;
    }

    if (randomSuffix === 0) {
      randomSuffix = Math.floor(Math.random() * 999) + 1;
    }

    const finalAmount = basePrice + randomSuffix;

    const payment = await prisma.payment.create({
      data: {
        userId: String(userId),
        planId,
        amount: finalAmount,
        status: 'PENDING',
        promoCode: appliedPromo
      }
    });

    // Notify admin about new payment
    const { notifyAdminNewPayment } = await import('./bot.js');
    const user = await prisma.user.findUnique({ where: { id: String(userId) } });
    await notifyAdminNewPayment(payment, user || { firstName: 'Noma\'lum', username: null }, plan);

    res.json({ payment, discount: appliedPromo ? true : false });
  } catch (err) {
    console.error("Payment Error:", err);
    res.status(500).json({ error: "Failed to create payment" });
  }
});
// Admin Middleware

// Hide the restored revenue dummy plan from users
setTimeout(async () => {
  try {
    const dummyPlanName = "Restored Revenue Plan";
    const existingPlan = await prisma.plan.findFirst({ where: { name: dummyPlanName } });
    if (existingPlan && !existingPlan.isDeleted) {
      await prisma.plan.update({ where: { id: existingPlan.id }, data: { isDeleted: true } });
    }
    const dummyChannel = await prisma.channel.findFirst({ where: { id: "deleted_history" } });
    if (dummyChannel && !dummyChannel.isDeleted) {
      await prisma.channel.update({ where: { id: dummyChannel.id }, data: { isDeleted: true } });
    }
    console.log("Hidden dummy plan and channel.");
  } catch (err) {
    console.error(err);
  }
}, 5000);
// --- Admin Routes ---

// Get basic stats (cached 20s)
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const cached = cache.get('stats');
  if (cached) return res.json(cached);
  try {
    const [totalUsers, activeSubs, totalChannels] = await Promise.all([
      prisma.user.count(),
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.channel.count({ where: { isDeleted: false } }),
    ]);
    const result = { totalUsers, activeSubs, totalChannels };
    cache.set('stats', result, 20);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a new channel
app.post('/api/admin/channels', requireAdmin, async (req, res) => {
  const { id, title, adminId, image } = req.body;
  if (!id || !title) return res.status(400).json({ error: 'Kanal ID va nomi majburiy' });
  try {
    // Upsert: if channel was soft-deleted before, restore it
    const channel = await prisma.channel.upsert({
      where: { id: id.toString() },
      update: { title, image: image || null, isDeleted: false },
      create: { id: id.toString(), title, image: image || null, adminId: adminId || "12345" }
    });
    res.json(channel);
  } catch (err: any) {
    console.error('Add channel error:', err);
    res.status(500).json({ error: 'Failed to add channel', detail: err?.message });
  }
});

// Edit a channel
app.put('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  try {
    const oldId = req.params.id as string;
    const { title, id: newId } = req.body;
    const channel = await prisma.channel.update({
      where: { id: oldId },
      data: { 
        ...(title && { title }),
        ...(newId && { id: newId }) 
      }
    });
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// Delete a channel (Soft Delete)
app.delete('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id as string;
    
    // Soft delete channel and its plans
    await prisma.plan.updateMany({ where: { channelId: id }, data: { isDeleted: true } });
    await prisma.channel.update({ where: { id: id }, data: { isDeleted: true } });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

// Add a plan
app.post('/api/admin/channels/:channelId/plans', requireAdmin, async (req, res) => {
  const channelId = req.params.channelId as string;
  const { name, description, price, duration } = req.body;
  try {
    const plan = await prisma.plan.create({
      data: {
        channelId,
        name,
        description,
        price: Number(price),
        duration: Number(duration),
        priceType: 'UZS'
      }
    });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add plan' });
  }
});

// Edit a plan
app.put('/api/admin/plans/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const { name, description, price, duration } = req.body;
    const plan = await prisma.plan.update({
      where: { id },
      data: { 
        ...(name && { name }), 
        ...(description !== undefined && { description }), 
        ...(price !== undefined && { price: Number(price) }), 
        ...(duration !== undefined && { duration: Number(duration) }) 
      }
    });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// Delete a plan (Soft Delete)
app.delete('/api/admin/plans/:id', requireAdmin, async (req, res) => {
  try {
    const planId = Number(req.params.id);
    await prisma.plan.update({ where: { id: planId }, data: { isDeleted: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

// Get settings
app.get('/api/admin/settings', async (req, res) => {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.settings.create({ data: { id: 1 } });
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update settings
app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const { paymentChannelId, joinRequestChannelId, joinRequestLink, joinRequestMessage, clickP2pUrl, streamerId } = req.body;
  try {
    const updateData: any = {};
    if (paymentChannelId !== undefined) updateData.paymentChannelId = paymentChannelId;
    if (joinRequestChannelId !== undefined) updateData.joinRequestChannelId = joinRequestChannelId;
    if (joinRequestLink !== undefined) updateData.joinRequestLink = joinRequestLink;
    if (joinRequestMessage !== undefined) updateData.joinRequestMessage = joinRequestMessage;
    if (clickP2pUrl !== undefined) updateData.clickP2pUrl = clickP2pUrl;
    if (streamerId !== undefined) updateData.streamerId = streamerId ? String(streamerId).trim() : null;

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: updateData,
      create: { id: 1, ...updateData }
    });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Helper: sync legacy settings joinRequestChannelId to joinRequestChannel table
async function syncLegacyJoinRequestChannel() {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (settings?.joinRequestChannelId) {
      const existing = await (prisma as any).joinRequestChannel.findUnique({
        where: { channelId: settings.joinRequestChannelId }
      });
      if (!existing) {
        let title = 'Asosiy Zayavka Kanal';
        try {
          const chat = await bot.telegram.getChat(settings.joinRequestChannelId);
          if ((chat as any).title) title = (chat as any).title;
        } catch {}
        await (prisma as any).joinRequestChannel.create({
          data: {
            channelId: settings.joinRequestChannelId,
            title,
            inviteLink: settings.joinRequestLink || null
          }
        });
      }
    }
  } catch {}
}

// --- Join Request Channels CRUD ---

// Get all join request channels with pending count
app.get('/api/admin/join-request-channels', requireAdmin, async (_req, res) => {
  try {
    await syncLegacyJoinRequestChannel();
    const channels = await (prisma as any).joinRequestChannel.findMany({
      orderBy: { id: 'asc' }
    });

    // Count pending join requests for each channel
    const channelIds = channels.map((c: any) => c.channelId);
    const countMap: Record<string, number> = {};
    let totalPending = 0;

    if (channelIds.length > 0) {
      const pendingCounts = await prisma.joinRequest.groupBy({
        by: ['channelId'],
        where: {
          channelId: { in: channelIds },
          status: 'PENDING'
        },
        _count: { id: true }
      });

      for (const p of pendingCounts) {
        countMap[p.channelId] = p._count.id;
        totalPending += p._count.id;
      }
    }

    const result = channels.map((ch: any) => ({
      ...ch,
      pendingCount: countMap[ch.channelId] || 0
    }));

    res.json({ channels: result, totalPending });
  } catch (err) {
    console.error('get join-request-channels error:', err);
    res.status(500).json({ error: 'Failed to fetch join request channels' });
  }
});

// Add or auto-connect a join request channel
app.post('/api/admin/join-request-channels', requireAdmin, async (req, res) => {
  try {
    const { channelId, title, inviteLink, customMessage } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: 'Kanal ID kiritilishi shart' });
    }

    const cleanChannelId = String(channelId).trim();
    let finalTitle = title ? String(title).trim() : '';
    let finalInviteLink = inviteLink ? String(inviteLink).trim() : '';

    // Automatically fetch channel title and invite link via Telegram API
    try {
      const chat = await bot.telegram.getChat(cleanChannelId);
      if (!finalTitle && (chat as any).title) {
        finalTitle = (chat as any).title;
      }
      if (!finalInviteLink) {
        try {
          const linkObj = await bot.telegram.createChatInviteLink(cleanChannelId, {
            creates_join_request: true,
            name: 'Kassabot VIP Zayavka'
          });
          finalInviteLink = linkObj.invite_link;
        } catch {
          finalInviteLink = (chat as any).invite_link || await bot.telegram.exportChatInviteLink(cleanChannelId).catch(() => '');
        }
      }
    } catch (e: any) {
      console.warn('[ZAYAVKA] Telegram getChat warning:', e?.message || e);
    }

    if (!finalTitle) finalTitle = `Kanal ${cleanChannelId}`;

    const saved = await (prisma as any).joinRequestChannel.upsert({
      where: { channelId: cleanChannelId },
      update: {
        title: finalTitle,
        ...(finalInviteLink ? { inviteLink: finalInviteLink } : {}),
        customMessage: customMessage ? String(customMessage).trim() : null
      },
      create: {
        channelId: cleanChannelId,
        title: finalTitle,
        inviteLink: finalInviteLink || null,
        customMessage: customMessage ? String(customMessage).trim() : null
      }
    });

    res.json(saved);
  } catch (err: any) {
    console.error('create join-request-channel error:', err);
    res.status(500).json({ error: 'Kanalni saqlashda xatolik yuz berdi' });
  }
});

// Update join request channel
app.put('/api/admin/join-request-channels/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { channelId, title, inviteLink, customMessage } = req.body;

    const data: any = {};
    if (channelId !== undefined) data.channelId = String(channelId).trim();
    if (title !== undefined) data.title = String(title).trim();
    if (inviteLink !== undefined) data.inviteLink = inviteLink ? String(inviteLink).trim() : null;
    if (customMessage !== undefined) data.customMessage = customMessage ? String(customMessage).trim() : null;

    const updated = await (prisma as any).joinRequestChannel.update({
      where: { id },
      data
    });

    res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(400).json({ error: 'Bu kanal ID boshqa kanalda ishlatilmoqda' });
    }
    console.error('update join-request-channel error:', err);
    res.status(500).json({ error: 'Failed to update join request channel' });
  }
});

// Delete join request channel
app.delete('/api/admin/join-request-channels/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await (prisma as any).joinRequestChannel.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error('delete join-request-channel error:', err);
    res.status(500).json({ error: 'Failed to delete join request channel' });
  }
});

// Get pending join requests count (real-time, across all channels)
app.get('/api/admin/join-requests/stats', requireAdmin, async (_req, res) => {
  try {
    await syncLegacyJoinRequestChannel();
    const channels = await (prisma as any).joinRequestChannel.findMany();
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });

    const channelIds = new Set<string>();
    for (const c of channels) channelIds.add(c.channelId);
    if (settings?.joinRequestChannelId) channelIds.add(settings.joinRequestChannelId);

    const channelIdList = Array.from(channelIds);
    if (channelIdList.length === 0) {
      return res.json({ count: 0, channelCounts: {} });
    }

    const count = await prisma.joinRequest.count({
      where: {
        channelId: { in: channelIdList },
        status: 'PENDING'
      }
    });

    const pendingCounts = await prisma.joinRequest.groupBy({
      by: ['channelId'],
      where: {
        channelId: { in: channelIdList },
        status: 'PENDING'
      },
      _count: { id: true }
    });

    const channelCounts: Record<string, number> = {};
    for (const p of pendingCounts) {
      channelCounts[p.channelId] = p._count.id;
    }

    res.json({ count, channelCounts });
  } catch (err) {
    console.error('join-requests stats error:', err);
    res.status(500).json({ error: 'Failed to get join requests stats' });
  }
});

// Mass approve pending join requests (for all channels or single channel)
app.post('/api/admin/join-requests/approve-all', requireAdmin, async (req, res) => {
  try {
    const targetChannelId = req.body?.channelId;
    const channels = await (prisma as any).joinRequestChannel.findMany();
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });

    const channelIds = new Set<string>();
    if (targetChannelId && targetChannelId !== 'all') {
      channelIds.add(String(targetChannelId));
    } else {
      for (const c of channels) channelIds.add(c.channelId);
      if (settings?.joinRequestChannelId) channelIds.add(settings.joinRequestChannelId);
    }

    const channelIdList = Array.from(channelIds);
    if (channelIdList.length === 0) {
      return res.status(400).json({ error: 'Zayavka kanallari topilmadi' });
    }

    const pending = await prisma.joinRequest.findMany({
      where: {
        channelId: { in: channelIdList },
        status: 'PENDING'
      }
    });

    if (pending.length === 0) {
      return res.json({ success: true, approvedCount: 0, failedCount: 0, total: 0 });
    }

    let approvedCount = 0;
    let failedCount = 0;

    for (const item of pending) {
      try {
        await bot.telegram.approveChatJoinRequest(item.channelId, Number(item.userId));
        await prisma.joinRequest.update({
          where: { id: item.id },
          data: { status: 'APPROVED' }
        });
        approvedCount++;
        // Rate limiting oldini olish uchun 35ms kutish
        await new Promise(resolve => setTimeout(resolve, 35));
      } catch (e: any) {
        console.error(`Approve error for user ${item.userId} in channel ${item.channelId}:`, e?.message || e);
        await prisma.joinRequest.update({
          where: { id: item.id },
          data: { status: 'PROCESSED' }
        }).catch(() => {});
        failedCount++;
      }
    }

    res.json({ success: true, approvedCount, failedCount, total: pending.length });
  } catch (err) {
    console.error('approve-all error:', err);
    res.status(500).json({ error: 'Failed to approve join requests' });
  }
});

// ==================== VIDEOCHAT & LIVE STREAMING ====================

interface LiveSSEClient {
  id: string;
  userId: string;
  name: string;
  role: 'streamer' | 'viewer';
  res: any;
}

let activeLiveClients: LiveSSEClient[] = [];
let lastLiveFrame: string | null = null;

function getActiveViewersCount(): number {
  return activeLiveClients.filter(c => c.role === 'viewer' && !c.res.writableEnded && !c.res.destroyed).length;
}

function escapeLiveHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function broadcastLiveEvent(eventType: string, data: any, filter?: (client: LiveSSEClient) => boolean) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  const prevCount = getActiveViewersCount();
  let deadViewerRemoved = false;

  activeLiveClients = activeLiveClients.filter(client => {
    if (client.res.writableEnded || client.res.destroyed) {
      if (client.role === 'viewer') deadViewerRemoved = true;
      return false;
    }
    if (!filter || filter(client)) {
      try {
        client.res.write(payload);
      } catch {
        if (client.role === 'viewer') deadViewerRemoved = true;
        return false;
      }
    }
    return true;
  });

  if (deadViewerRemoved && eventType !== 'viewers_count') {
    const currentCount = getActiveViewersCount();
    if (currentCount !== prevCount) {
      broadcastLiveEvent('viewers_count', { count: currentCount });
    }
  }
}

async function checkIsStreamer(userId: string): Promise<boolean> {
  if (!userId) return false;
  const adminEnvRaw = process.env.ADMIN_ID?.trim();
  const adminIds = adminEnvRaw ? adminEnvRaw.split(',').map(id => id.trim()).filter(Boolean) : [];
  if (adminIds.includes(String(userId))) return true;

  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (settings?.streamerId) {
      const allowedIds = settings.streamerId.split(',').map((id: string) => id.trim()).filter(Boolean);
      if (allowedIds.includes(String(userId))) return true;
    }
  } catch {}

  const streamer = await (prisma as any).streamer.findUnique({
    where: { userId: String(userId) }
  });
  return Boolean(streamer);
}

// 1. Get current live stream status (optimized with short memory cache to reduce DB load & egress)
app.get('/api/live/status', async (_req, res) => {
  try {
    const cached = cache.get('live_status');
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=3');
      return res.json(cached);
    }

    const activeStream = await (prisma as any).liveStream.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      include: {
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 30
        }
      }
    });

    let result: any;
    if (!activeStream) {
      result = { active: false };
    } else {
      result = {
        active: true,
        stream: {
          id: activeStream.id,
          streamerId: activeStream.streamerId,
          streamerName: activeStream.streamerName,
          title: activeStream.title,
          startedAt: activeStream.startedAt,
          viewersCount: getActiveViewersCount()
        },
        recentComments: (activeStream.comments || []).reverse()
      };
    }

    cache.set('live_status', result, 4);
    res.setHeader('Cache-Control', 'public, max-age=3');
    res.json(result);
  } catch (err) {
    console.error('live status error:', err);
    res.status(500).json({ error: 'Failed to get live status' });
  }
});

// 2. Get user's live notification status and streamer permission
app.get('/api/live/user-state/:userId', async (req, res) => {
  try {
    const userId = req.params.userId as string;
    if (!userId) {
      return res.json({ liveNotify: false, isStreamer: false });
    }
    const isStreamer = await checkIsStreamer(userId);
    const user = await prisma.user.findUnique({ where: { id: String(userId) } });

    res.json({
      liveNotify: Boolean(user?.liveNotify),
      isStreamer
    });
  } catch (err) {
    console.error('user live state error:', err);
    res.status(500).json({ error: 'Failed to get user state' });
  }
});

// 3. Toggle user notification for live stream
app.post('/api/live/toggle-notify', async (req, res) => {
  try {
    const { userId, enabled } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await prisma.user.upsert({
      where: { id: String(userId) },
      update: { liveNotify: Boolean(enabled) },
      create: { id: String(userId), liveNotify: Boolean(enabled) }
    });

    res.json({ success: true, liveNotify: user.liveNotify });
  } catch (err) {
    console.error('toggle notify error:', err);
    res.status(500).json({ error: 'Failed to update notification setting' });
  }
});

// 4. Start a live stream (Streamer only)
app.post('/api/live/start', async (req, res) => {
  try {
    const { streamerId, streamerName, title } = req.body;
    if (!streamerId) return res.status(400).json({ error: 'streamerId required' });

    const isAuthorized = await checkIsStreamer(streamerId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Sizga jonli efir boshlash uchun ruxsat berilmagan' });
    }

    // End previous active streams
    await (prisma as any).liveStream.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date() }
    });

    const stream = await (prisma as any).liveStream.create({
      data: {
        streamerId: String(streamerId),
        streamerName: streamerName || 'VIP Streamer',
        title: title || 'VIP Jonli Efir',
        status: 'ACTIVE'
      }
    });

    // Notify all SSE clients
    broadcastLiveEvent('stream_started', {
      stream: {
        id: stream.id,
        streamerId: stream.streamerId,
        streamerName: stream.streamerName,
        title: stream.title,
        startedAt: stream.startedAt,
        viewersCount: getActiveViewersCount()
      }
    });

    // Send notifications to users who enabled liveNotify
    setTimeout(async () => {
      try {
        const subscribers = await prisma.user.findMany({
          where: { liveNotify: true }
        });
        const botInfo = await bot.telegram.getMe();
        for (const sub of subscribers) {
          if (sub.id === String(streamerId)) continue;
          bot.telegram.sendMessage(
            sub.id,
            `🔴 <b>JONLI EFIR BOSHLANDI!</b>\n\n🎥 VIP videochatda jonli efir boshlandi! Hoziroq kirib tomosha qiling va sharh qoldiring!`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[{ text: '📲 EFIRGA KIRISH', url: `https://t.me/${botInfo.username}?startapp=videochat` }]]
              }
            }
          ).catch(() => {});
        }
      } catch (notifyErr) {
        console.error('live start notify error:', notifyErr);
      }
    }, 100);

    lastStreamerHeartbeatTime = Date.now();
    res.json({ success: true, stream });
  } catch (err) {
    console.error('start stream error:', err);
    res.status(500).json({ error: 'Failed to start stream' });
  }
});

let lastStreamerHeartbeatTime = 0;

// Streamer Heartbeat endpoint (Streamer botdan chiqib ketganini aniqlash)
app.post('/api/live/heartbeat', (req, res) => {
  lastStreamerHeartbeatTime = Date.now();
  res.json({ ok: true });
});

// Periodic check: if streamer leaves without stopping, auto-end stream after 12 seconds
setInterval(async () => {
  if (lastStreamerHeartbeatTime > 0 && Date.now() - lastStreamerHeartbeatTime > 12000) {
    lastStreamerHeartbeatTime = 0;
    try {
      const activeStream = await (prisma as any).liveStream.findFirst({
        where: { status: 'ACTIVE' }
      });
      if (activeStream) {
        console.log(`[LIVE AUTO-STOP] Streamer botdan chiqib ketdi (12s aloqa yo'q). Efir #${activeStream.id} avtomatik to'xtatildi.`);
        await (prisma as any).liveStream.updateMany({
          where: { status: 'ACTIVE' },
          data: { status: 'ENDED', endedAt: new Date() }
        });
        lastLiveFrame = null;
        broadcastLiveEvent('stream_ended', { 
          message: 'Streamer efirdan chiqib ketdi, jonli efir yakunlandi',
          endedBy: 'auto_exit'
        });
        broadcastLiveEvent('viewers_count', { count: 0 });
      }
    } catch (e) {
      console.error('Auto end stream error:', e);
    }
  }
}, 4000);

// 5. End live stream (Called by streamer or admin)
app.post('/api/live/end', async (req, res) => {
  try {
    let bodyData = req.body;
    if (typeof bodyData === 'string') {
      try { bodyData = JSON.parse(bodyData); } catch {}
    }
    const { streamId, streamerId } = bodyData || {};
    const isAdmin = checkRequestIsAdmin(req);
    const isStreamer = streamerId ? await checkIsStreamer(streamerId) : false;

    if (!isAdmin && !isStreamer && streamerId !== undefined) {
      return res.status(403).json({ error: 'Ruxsat berilmagan' });
    }

    lastStreamerHeartbeatTime = 0;

    if (streamId) {
      await (prisma as any).liveStream.update({
        where: { id: Number(streamId) },
        data: { status: 'ENDED', endedAt: new Date() }
      }).catch(() => {});
    }

    // Always ensure all active streams are ended
    await (prisma as any).liveStream.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date() }
    });

    lastLiveFrame = null;
    broadcastLiveEvent('stream_ended', { 
      message: isAdmin ? 'Jonli efir admin tomonidan to\'xtatildi' : 'Jonli efir yakunlandi',
      endedBy: isAdmin ? 'admin' : 'streamer'
    });
    broadcastLiveEvent('viewers_count', { count: 0 });

    res.json({ success: true });
  } catch (err) {
    console.error('end stream error:', err);
    res.status(500).json({ error: 'Failed to end stream' });
  }
});

// 5.1 Admin End live stream explicitly
app.post('/api/admin/live/end', requireAdmin, async (req, res) => {
  try {
    const { streamId } = req.body;

    if (streamId) {
      await (prisma as any).liveStream.update({
        where: { id: Number(streamId) },
        data: { status: 'ENDED', endedAt: new Date() }
      }).catch(() => {});
    }

    await (prisma as any).liveStream.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date() }
    });

    lastLiveFrame = null;
    broadcastLiveEvent('stream_ended', { 
      message: 'Jonli efir admin tomonidan to\'xtatildi',
      endedBy: 'admin'
    });
    broadcastLiveEvent('viewers_count', { count: 0 });

    res.json({ success: true });
  } catch (err) {
    console.error('admin end stream error:', err);
    res.status(500).json({ error: 'Failed to end stream' });
  }
});

// 6. SSE Event Stream for Live Videochat
app.get('/api/live/events', async (req, res) => {
  const userId = String(req.query.userId || 'anon');
  const name = String(req.query.name || 'Foydalanuvchi');
  const role = (req.query.role === 'streamer' ? 'streamer' : 'viewer') as 'streamer' | 'viewer';
  const clientId = `${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const client: LiveSSEClient = { id: clientId, userId, name, role, res };
  activeLiveClients.push(client);

  const viewersCount = getActiveViewersCount();
  res.write(`event: init\ndata: ${JSON.stringify({ clientId, viewersCount })}\n\n`);

  broadcastLiveEvent('viewers_count', { count: viewersCount });

  // If there is a cached frame and client is viewer, push immediately for instant visual
  if (role === 'viewer') {
    if (lastLiveFrame) {
      try {
        res.write(`event: video_frame\ndata: ${JSON.stringify({ frame: lastLiveFrame })}\n\n`);
      } catch {}
    }
    broadcastLiveEvent('viewer_joined', { userId, name, clientId }, c => c.role === 'streamer');
  } else if (role === 'streamer') {
    // Inform newly connected streamer about all currently active viewers
    const existingViewers = activeLiveClients
      .filter(c => c.role === 'viewer' && c.id !== clientId)
      .map(c => ({ userId: c.userId, name: c.name, clientId: c.id }));
    if (existingViewers.length > 0) {
      try {
        res.write(`event: existing_viewers\ndata: ${JSON.stringify({ viewers: existingViewers })}\n\n`);
      } catch {}
    }
  }

  // Periodic heartbeat comment and ping event
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
      res.write(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
    } catch {
      cleanup();
    }
  }, 15000);

  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    clearInterval(heartbeatInterval);
    const prevCount = getActiveViewersCount();
    activeLiveClients = activeLiveClients.filter(c => c.id !== clientId);
    const updatedCount = getActiveViewersCount();
    if (prevCount !== updatedCount) {
      broadcastLiveEvent('viewers_count', { count: updatedCount });
    }

    if (role === 'viewer') {
      broadcastLiveEvent('viewer_left', { userId, clientId }, c => c.role === 'streamer');
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

// 7. Post a live comment
app.post('/api/live/comment', async (req, res) => {
  try {
    const { streamId, userId, userName, text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Matn kiritilmadi' });
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return res.status(400).json({ error: 'Matn bo\'sh' });
    }

    if (trimmedText.length > 200) {
      return res.status(400).json({ error: 'Sharh 200 ta belgidan oshmasligi kerak' });
    }

    // Escape XSS to prevent injection
    const sanitizedText = escapeLiveHtml(trimmedText);
    const sanitizedAuthor = escapeLiveHtml(String(userName || 'Foydalanuvchi').trim().slice(0, 40) || 'Foydalanuvchi');

    let savedCommentId = Date.now();
    if (streamId) {
      try {
        const saved = await (prisma as any).liveComment.create({
          data: {
            streamId: Number(streamId),
            userId: String(userId || 'anon'),
            userName: sanitizedAuthor,
            text: sanitizedText
          }
        });
        savedCommentId = saved.id;
      } catch (dbErr) {
        console.error('Comment DB error:', dbErr);
      }
    }

    const commentData = {
      id: savedCommentId,
      streamId,
      userId: String(userId || 'anon'),
      userName: sanitizedAuthor,
      text: sanitizedText,
      createdAt: new Date().toISOString()
    };

    broadcastLiveEvent('new_comment', commentData);

    res.json({ success: true, comment: commentData });
  } catch (err) {
    console.error('live comment error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// 7.5 Lightweight live reaction endpoint (does not spam DB comment table)
app.post('/api/live/reaction', (req, res) => {
  try {
    const { streamId, emoji = '❤️' } = req.body;
    const cleanEmoji = String(emoji).slice(0, 10);
    broadcastLiveEvent('new_reaction', { streamId, emoji: cleanEmoji });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send reaction' });
  }
});

// 8. WebRTC Signaling exchange
app.post('/api/live/signal', (req, res) => {
  const { targetClientId, targetRole, senderId, type, data } = req.body;
  
  if (targetClientId) {
    broadcastLiveEvent('webrtc_signal', { senderId, targetClientId, targetRole, type, data }, c => c.id === targetClientId);
  } else if (targetRole) {
    broadcastLiveEvent('webrtc_signal', { senderId, targetClientId, targetRole, type, data }, c => c.role === targetRole);
  } else {
    broadcastLiveEvent('webrtc_signal', { senderId, targetClientId, targetRole, type, data });
  }

  res.json({ ok: true });
});

// 9. Frame relay fallback
app.post('/api/live/frame', (req, res) => {
  const { frame, streamerId } = req.body;
  if (!frame) return res.status(400).json({ error: 'Frame required' });

  lastLiveFrame = frame;
  broadcastLiveEvent('video_frame', { frame }, c => c.role === 'viewer');
  res.json({ ok: true });
});

// ================= LIVE DONATIONS (SOVG'ALAR VA DANAT) =================
export const DEFAULT_DONATION_GIFTS = [
  { giftKey: 'rose', name: 'Atirgul', icon: '🌹', price: 5000, description: 'Chiroyli gullar bilan qo\'llab-quvvatlash', animationType: 'sway', glowColor: 'rgba(244, 63, 94, 0.8)', type: 'EMOJI', duration: 8, order: 1 },
  { giftKey: 'coffee', name: 'Issiq Qahva', icon: '☕', price: 10000, description: 'Streamer uchun quvvat', animationType: 'pulse', glowColor: 'rgba(245, 158, 11, 0.8)', type: 'EMOJI', duration: 8, order: 2 },
  { giftKey: 'chocolate', name: 'Shokolad', icon: '🍫', price: 20000, description: 'Shirin kayfiyat ulashish', animationType: 'bounce', glowColor: 'rgba(180, 83, 9, 0.8)', type: 'EMOJI', duration: 8, order: 3 },
  { giftKey: 'rocket', name: 'Kosmik Raketa', icon: '🚀', price: 50000, description: 'Efirni koinotga olib chiqish', animationType: 'fly', glowColor: 'rgba(56, 189, 248, 0.9)', type: 'EMOJI', duration: 8, order: 4 },
  { giftKey: 'crown', name: 'Qirol Toji', icon: '👑', price: 100000, description: 'Haqiqiy VIP ehtirom', animationType: 'spin', glowColor: 'rgba(250, 204, 21, 0.95)', type: 'EMOJI', duration: 8, order: 5 },
  { giftKey: 'supercar', name: 'Sportkar', icon: '🏎️', price: 250000, description: 'Katta tezlik va quvvat', animationType: 'shake', glowColor: 'rgba(239, 68, 68, 0.9)', type: 'EMOJI', duration: 8, order: 6 },
  { giftKey: 'diamond', name: 'Katta Olmos', icon: '💎', price: 500000, description: 'Yorqin va bebaho sovg\'a', animationType: 'spin', glowColor: 'rgba(147, 197, 253, 0.95)', type: 'EMOJI', duration: 8, order: 7 },
  { giftKey: 'castle', name: 'Oltin Qasr', icon: '🏰', price: 1000000, description: 'Eng oliy darajadagi donat', animationType: 'pulse', glowColor: 'rgba(245, 158, 11, 1)', type: 'EMOJI', duration: 8, order: 8 },
  // Ovozli GIF / Video sovg'alar (Admin xohlagancha o'zgartirishi va yangi qo'shishi mumkin)
  { giftKey: 'video_cheer', name: 'Qarsaklar & Olqish', icon: '👏', price: 15000, description: 'Efir uchun qizg\'in olqishlar', animationType: 'bounce', glowColor: 'rgba(34, 197, 94, 0.9)', type: 'VIDEO', mediaUrl: 'https://assets.mixkit.co/videos/preview/mixkit-hands-clapping-in-applause-4948-large.mp4', duration: 7, order: 9 },
  { giftKey: 'video_party', name: 'Bayram & Salut', icon: '🎉', price: 30000, description: 'Efirda ajoyib bayram shukuhi', animationType: 'pulse', glowColor: 'rgba(168, 85, 247, 0.9)', type: 'VIDEO', mediaUrl: 'https://assets.mixkit.co/videos/preview/mixkit-fireworks-illuminating-the-beach-sky-4157-large.mp4', duration: 8, order: 10 }
];

let schemaEnsured = false;
async function ensureGiftSchema() {
  if (schemaEnsured) return;
  try {
    await (prisma as any).$executeRawUnsafe(`
      ALTER TABLE "LiveGift" ADD COLUMN IF NOT EXISTS "type" TEXT DEFAULT 'EMOJI';
      ALTER TABLE "LiveGift" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT;
      ALTER TABLE "LiveGift" ADD COLUMN IF NOT EXISTS "duration" INTEGER DEFAULT 8;
      ALTER TABLE "LiveDonation" ADD COLUMN IF NOT EXISTS "giftType" TEXT DEFAULT 'EMOJI';
      ALTER TABLE "LiveDonation" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT;
    `);
    schemaEnsured = true;
    console.log('[DONATIONS] LiveGift & LiveDonation columns verified.');
  } catch (err) {
    console.warn('[DONATIONS] Note during schema verify:', err);
  }
}

// Helper to seed gifts if empty
async function getOrSeedGifts() {
  try {
    await ensureGiftSchema();
    const totalCount = await (prisma as any).liveGift.count();

    if (totalCount === 0) {
      console.log('[DONATIONS] Seeding initial live gifts...');
      for (const dg of DEFAULT_DONATION_GIFTS) {
        await (prisma as any).liveGift.upsert({
          where: { giftKey: dg.giftKey },
          update: {},
          create: dg
        });
      }
    } else {
      // If gifts exist but no VIDEO gifts have been seeded yet, add default video gifts
      const videoCount = await (prisma as any).liveGift.count({ where: { type: 'VIDEO' } }).catch(() => 0);
      if (videoCount === 0) {
        const videoGifts = DEFAULT_DONATION_GIFTS.filter(g => g.type === 'VIDEO');
        for (const vg of videoGifts) {
          await (prisma as any).liveGift.upsert({
            where: { giftKey: vg.giftKey },
            update: {},
            create: vg
          }).catch(() => {});
        }
      }
    }

    const gifts = await (prisma as any).liveGift.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' }
    });

    return gifts.map((g: any) => ({
      id: g.giftKey,
      dbId: g.id,
      name: g.name,
      icon: g.icon,
      price: g.price,
      description: g.description,
      animationType: g.animationType || 'bounce',
      glowColor: g.glowColor || 'rgba(245, 158, 11, 0.8)',
      type: g.type || 'EMOJI',
      mediaUrl: g.mediaUrl || null,
      duration: g.duration || 8
    }));
  } catch (err) {
    console.error('getOrSeedGifts error:', err);
    return DEFAULT_DONATION_GIFTS.map(g => ({
      id: g.giftKey,
      name: g.name,
      icon: g.icon,
      price: g.price,
      description: g.description,
      animationType: g.animationType,
      glowColor: g.glowColor,
      type: (g as any).type || 'EMOJI',
      mediaUrl: (g as any).mediaUrl || null,
      duration: (g as any).duration || 8
    }));
  }
}

// Helper to trigger broadcast of donation after 30s delay
export async function triggerDonationDisplay(donationId: number) {
  try {
    const donation = await (prisma as any).liveDonation.findUnique({
      where: { id: donationId }
    });
    if (!donation || donation.status === 'DISPLAYED') return;

    await (prisma as any).liveDonation.update({
      where: { id: donationId },
      data: { status: 'DISPLAYED' }
    });

    // Broadcast to ALL live participants (streamer + viewers)
    broadcastLiveEvent('new_donation', {
      id: donation.id,
      userId: donation.userId,
      userName: donation.userName,
      giftId: donation.giftId,
      giftName: donation.giftName,
      giftIcon: donation.giftIcon,
      giftType: donation.giftType || 'EMOJI',
      mediaUrl: donation.mediaUrl || null,
      amount: donation.amount,
      message: donation.message || '',
      duration: donation.giftType === 'VIDEO' ? 10 : 8,
      timestamp: Date.now()
    });

    console.log(`[DONATION] Displayed on live stream: ${donation.userName} sent ${donation.giftName} (${donation.amount} UZS, type: ${donation.giftType || 'EMOJI'})`);
  } catch (err) {
    console.error('triggerDonationDisplay error:', err);
  }
}

// Connect decouple event emitter
donationEvents.on('trigger_display', async (donationId: number) => {
  await triggerDonationDisplay(donationId);
});

// Periodic background check for pending broadcast donations (recovers from server restarts or missed timers)
setInterval(async () => {
  try {
    const overdueDonations = await (prisma as any).liveDonation.findMany({
      where: {
        status: 'PAID',
        displayAt: { lte: new Date() }
      },
      take: 10
    });

    for (const d of overdueDonations) {
      await triggerDonationDisplay(d.id);
    }
  } catch {}
}, 3000);

// 1. Get donation gifts list (Public for viewers & streamer)
app.get('/api/live/gifts', async (_req, res) => {
  const gifts = await getOrSeedGifts();
  res.json({ gifts });
});

// 2. Admin: Get all gifts (active and inactive)
app.get('/api/admin/gifts', requireAdmin, async (_req, res) => {
  try {
    await getOrSeedGifts();
    const gifts = await (prisma as any).liveGift.findMany({
      orderBy: { order: 'asc' }
    });
    res.json({ gifts });
  } catch (err) {
    console.error('fetch gifts error:', err);
    res.status(500).json({ error: 'Sovg\'alarni yuklashda xatolik yuz berdi' });
  }
});

// 3. Admin: Add new gift
app.post('/api/admin/gifts', requireAdmin, async (req, res) => {
  try {
    const { name, icon, price, description, animationType, glowColor, type, mediaUrl, duration } = req.body;

    // Nom validatsiyasi
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Sovg\'a nomi kiritilishi shart' });
    }
    const cleanName = name.trim();
    if (cleanName.length > 50) {
      return res.status(400).json({ error: 'Sovg\'a nomi 50 ta belgidan oshmasligi kerak' });
    }

    // Narx validatsiyasi
    const numPrice = Number(price);
    if (isNaN(numPrice) || !Number.isFinite(numPrice) || numPrice <= 0) {
      return res.status(400).json({ error: 'Sovg\'a narxi musbat son bo\'lishi kerak (0 dan katta)' });
    }

    // Type va Media
    const cleanType = (type === 'VIDEO') ? 'VIDEO' : 'EMOJI';
    let cleanMediaUrl: string | null = null;
    if (cleanType === 'VIDEO') {
      if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim()) {
        return res.status(400).json({ error: 'Ovozli video yoki GIF havolasi (mediaUrl) kiritilishi shart' });
      }
      cleanMediaUrl = mediaUrl.trim();
    }

    const cleanDuration = cleanType === 'VIDEO' ? Math.min(60, Math.max(3, Number(duration) || 8)) : 8;

    // Ikonka/emoji validatsiyasi
    let cleanIcon = (typeof icon === 'string' ? icon.trim() : '') || (cleanType === 'VIDEO' ? '🎬' : '🎁');
    if (cleanIcon.length > 10) {
      cleanIcon = cleanIcon.slice(0, 10);
    }

    // Animatsiya turi
    const validAnimations = ['bounce', 'sway', 'fly', 'spin', 'pulse', 'shake'];
    const cleanAnimation = validAnimations.includes(String(animationType)) ? String(animationType) : 'bounce';

    const giftKey = 'gift_' + Date.now();
    const count = await (prisma as any).liveGift.count();

    const created = await (prisma as any).liveGift.create({
      data: {
        giftKey,
        name: cleanName,
        icon: cleanIcon,
        price: Math.floor(numPrice),
        description: description ? String(description).trim() : null,
        animationType: cleanAnimation,
        glowColor: glowColor ? String(glowColor).trim() : (cleanType === 'VIDEO' ? 'rgba(139, 92, 246, 0.9)' : 'rgba(245, 158, 11, 0.8)'),
        type: cleanType,
        mediaUrl: cleanMediaUrl,
        duration: cleanDuration,
        order: count + 1,
        isActive: true
      }
    });

    res.json({ gift: created });
  } catch (err: any) {
    console.error('Add gift error:', err);
    res.status(500).json({ error: 'Sovg\'a qo\'shishda xatolik', detail: err?.message });
  }
});

// 3.1 Admin: Upload video file for gift
app.post('/api/admin/gifts/upload-video', requireAdmin, async (req, res) => {
  try {
    const { videoBase64, filename } = req.body;
    if (!videoBase64) {
      return res.status(400).json({ error: 'Video fayli (base64) kiritilishi shart' });
    }

    let buffer: Buffer;
    let ext = '.mp4';

    if (filename && typeof filename === 'string') {
      const parsedExt = path.extname(filename).toLowerCase();
      if (['.mp4', '.mov', '.webm', '.gif', '.ogg', '.ogv', '.m4v', '.mkv'].includes(parsedExt)) {
        ext = parsedExt;
      }
    }

    const matches = String(videoBase64).match(/^data:([A-Za-z0-9-+\/]+);base64,(.+)$/);

    if (matches && matches.length === 3) {
      const mime = matches[1].toLowerCase();
      if (!filename || ext === '.mp4') {
        if (mime.includes('webm')) ext = '.webm';
        else if (mime.includes('gif')) ext = '.gif';
        else if (mime.includes('ogg')) ext = '.ogv';
        else if (mime.includes('quicktime') || mime.includes('mov')) ext = '.mov';
        else ext = '.mp4';
      }
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(videoBase64, 'base64');
    }

    if (buffer.length > 50 * 1024 * 1024) {
      return res.status(400).json({ error: 'Video hajmi 50 MB dan oshmasligi kerak' });
    }

    const cleanFilename = `gift_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
    const targetPath = path.join(giftsUploadsDir, cleanFilename);
    fs.writeFileSync(targetPath, buffer);

    const mediaUrl = `/uploads/gifts/${cleanFilename}`;
    console.log(`[GIFTS] New gift video uploaded from gallery/device: ${mediaUrl} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    res.json({ success: true, url: mediaUrl, sizeMb: (buffer.length / 1024 / 1024).toFixed(2) });
  } catch (err: any) {
    console.error('Upload gift video error:', err);
    res.status(500).json({ error: 'Video yuklashda xatolik yuz berdi', detail: err?.message });
  }
});

// 4. Admin: Update gift (edit price, name, icon, animation, type, mediaUrl, etc.)
app.put('/api/admin/gifts/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Noto\'g\'ri sovg\'a ID raqami' });
    }

    const existing = await (prisma as any).liveGift.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Sovg\'a topilmadi' });
    }

    const { name, icon, price, description, animationType, glowColor, isActive, order, type, mediaUrl, duration } = req.body;
    const dataToUpdate: any = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Sovg\'a nomi bo\'sh bo\'lishi mumkin emas' });
      }
      if (name.trim().length > 50) {
        return res.status(400).json({ error: 'Sovg\'a nomi 50 ta belgidan oshmasligi kerak' });
      }
      dataToUpdate.name = name.trim();
    }

    if (price !== undefined) {
      const numPrice = Number(price);
      if (isNaN(numPrice) || !Number.isFinite(numPrice) || numPrice <= 0) {
        return res.status(400).json({ error: 'Sovg\'a narxi musbat son bo\'lishi kerak (0 dan katta)' });
      }
      dataToUpdate.price = Math.floor(numPrice);
    }

    if (icon !== undefined) {
      let cleanIcon = (typeof icon === 'string' ? icon.trim() : '') || '🎁';
      if (cleanIcon.length > 10) cleanIcon = cleanIcon.slice(0, 10);
      dataToUpdate.icon = cleanIcon;
    }

    if (description !== undefined) {
      dataToUpdate.description = description ? String(description).trim() : null;
    }

    if (animationType !== undefined) {
      const validAnimations = ['bounce', 'sway', 'fly', 'spin', 'pulse', 'shake'];
      dataToUpdate.animationType = validAnimations.includes(String(animationType)) ? String(animationType) : 'bounce';
    }

    if (glowColor !== undefined) {
      dataToUpdate.glowColor = String(glowColor).trim() || 'rgba(245, 158, 11, 0.8)';
    }

    if (type !== undefined) {
      dataToUpdate.type = type === 'VIDEO' ? 'VIDEO' : 'EMOJI';
    }

    if (mediaUrl !== undefined) {
      dataToUpdate.mediaUrl = mediaUrl ? String(mediaUrl).trim() : null;
    }

    if (duration !== undefined) {
      const numDur = Number(duration);
      if (!isNaN(numDur) && numDur >= 3) {
        dataToUpdate.duration = Math.min(60, Math.floor(numDur));
      }
    }

    if (isActive !== undefined) {
      dataToUpdate.isActive = Boolean(isActive);
    }

    if (order !== undefined) {
      const numOrder = Number(order);
      if (!isNaN(numOrder)) {
        dataToUpdate.order = numOrder;
      }
    }

    const updated = await (prisma as any).liveGift.update({
      where: { id },
      data: dataToUpdate
    });

    res.json({ gift: updated });
  } catch (err: any) {
    console.error('Update gift error:', err);
    res.status(500).json({ error: 'Sovg\'ani yangilashda xatolik', detail: err?.message });
  }
});

// 5. Admin: Delete gift
app.delete('/api/admin/gifts/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Noto\'g\'ri sovg\'a ID raqami' });
    }

    const existing = await (prisma as any).liveGift.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Sovg\'a topilmadi' });
    }

    await (prisma as any).liveGift.delete({ where: { id } });
    res.json({ success: true, message: 'Sovg\'a muvaffaqiyatli o\'chirildi' });
  } catch (err: any) {
    console.error('Delete gift error:', err);
    res.status(500).json({ error: 'Sovg\'ani o\'chirishda xatolik', detail: err?.message });
  }
});

// 6. Create a donation (generates unique amount with suffix & gets active card)
app.post('/api/live/donate/create', async (req, res) => {
  try {
    const { userId, userName, giftId, message } = req.body;
    if (!userId || !giftId) {
      return res.status(400).json({ error: 'userId va giftId talab qilinadi' });
    }

    const allGifts = await getOrSeedGifts();
    const gift = allGifts.find((g: any) => 
      g.id === giftId || g.giftKey === giftId || String(g.dbId) === String(giftId)
    );
    if (!gift) {
      return res.status(400).json({ error: 'Noto\'g\'ri sovg\'a tanlandi' });
    }

    // Clean up stale pending donations older than 30 mins
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    await (prisma as any).liveDonation.updateMany({
      where: { status: 'PENDING', createdAt: { lt: thirtyMinutesAgo } },
      data: { status: 'CANCELLED' }
    }).catch(() => {});

    // Cancel any previous uncompleted PENDING donation for THIS user to free suffix and prevent duplicates
    await (prisma as any).liveDonation.updateMany({
      where: { userId: String(userId), status: 'PENDING' },
      data: { status: 'CANCELLED' }
    }).catch(() => {});

    // Get active live stream if any
    const activeStream = await (prisma as any).liveStream.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { id: 'desc' }
    });

    // Get active card & settings with auto fallback to first slot
    let activeCard = await prisma.card.findFirst({ where: { isActive: true } });
    if (!activeCard) {
      activeCard = await prisma.card.findFirst({ orderBy: { slot: 'asc' } });
      if (activeCard) {
        await prisma.card.update({
          where: { id: activeCard.id },
          data: { isActive: true }
        }).catch(() => {});
      }
    }

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const cardNumber = activeCard ? activeCard.cardNumber.trim() : '';
    const cardHolder = activeCard ? activeCard.cardHolder.trim() : '';
    const bankName = activeCard ? activeCard.bankName.trim() : '';
    const clickP2pUrl = (activeCard && activeCard.clickP2pUrl) ? activeCard.clickP2pUrl : (settings?.clickP2pUrl || '');

    // Generate guaranteed unique random suffix (100..999) to differentiate payments
    const pendingDonations = await (prisma as any).liveDonation.findMany({
      where: { status: 'PENDING' }
    });
    const pendingPayments = await prisma.payment.findMany({
      where: { status: 'PENDING', createdAt: { gte: thirtyMinutesAgo } }
    });
    const busyAmounts = new Set([
      ...pendingDonations.map((d: any) => d.amount),
      ...pendingPayments.map(p => p.amount)
    ]);

    let exactAmount = 0;
    // 1. Try randomized suffixes first
    for (let attempts = 0; attempts < 30; attempts++) {
      const randomSuffix = Math.floor(Math.random() * 900) + 100;
      const candidate = gift.price + randomSuffix;
      if (!busyAmounts.has(candidate)) {
        exactAmount = candidate;
        break;
      }
    }

    // 2. Sequential search if randomized pool is busy
    if (!exactAmount) {
      for (let s = 101; s <= 999; s++) {
        const candidate = gift.price + s;
        if (!busyAmounts.has(candidate)) {
          exactAmount = candidate;
          break;
        }
      }
    }

    // 3. Fallback
    if (!exactAmount) {
      exactAmount = gift.price + Math.floor(Math.random() * 900) + 100;
    }

    const isVideoGift = (gift as any).type === 'VIDEO';
    const donation = await (prisma as any).liveDonation.create({
      data: {
        streamId: activeStream?.id || null,
        userId: String(userId),
        userName: String(userName || 'Mehmon').trim().slice(0, 50),
        giftId: gift.id,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftType: (gift as any).type || 'EMOJI',
        mediaUrl: (gift as any).mediaUrl || null,
        baseAmount: gift.price,
        amount: exactAmount,
        message: isVideoGift ? '' : (message || '').trim().slice(0, 200),
        status: 'PENDING',
        cardDetails: cardNumber ? `${cardNumber} (${cardHolder})` : 'Karta topilmadi'
      }
    });

    res.json({
      donationId: donation.id,
      gift,
      amount: exactAmount,
      baseAmount: gift.price,
      cardNumber,
      cardHolder,
      bankName,
      clickP2pUrl
    });
  } catch (err) {
    console.error('create donation error:', err);
    res.status(500).json({ error: 'Donat yaratishda xatolik yuz berdi' });
  }
});

// 3. Check donation payment status ("To'lov qildim" pressed or auto-polled)
app.post('/api/live/donate/check/:donationId', async (req, res) => {
  try {
    const donationId = Number(req.params.donationId);
    if (!donationId || isNaN(donationId)) {
      return res.status(400).json({ error: 'Noto\'g\'ri donat ID' });
    }

    const donation = await (prisma as any).liveDonation.findUnique({
      where: { id: donationId }
    });

    if (!donation) {
      return res.status(404).json({ error: 'Donat topilmadi' });
    }

    // If cancelled or expired
    if (donation.status === 'CANCELLED') {
      return res.json({
        success: false,
        status: 'CANCELLED',
        message: 'Ushbu donat bekor qilingan yoki muddati o\'tgan. Iltimos, yangi sovg\'a tanlang.'
      });
    }

    // Already paid or displayed
    if (donation.status === 'PAID' || donation.status === 'DISPLAYED') {
      const remainingSeconds = donation.displayAt 
        ? Math.max(0, Math.ceil((new Date(donation.displayAt).getTime() - Date.now()) / 1000))
        : 0;

      return res.json({
        success: true,
        status: donation.status,
        displayInSeconds: remainingSeconds
      });
    }

    // If still PENDING:
    // 1. Check in-memory recent channel SMS posts (recovers payments that arrived before/during page interaction)
    const matchingPost = recentChannelPosts.find(p => 
      textContainsAmount(p.text, donation.amount) || p.numbers.includes(donation.amount)
    );

    if (matchingPost) {
      console.log(`[DONATION CHECK] Found matching SMS in recentChannelPosts for donation #${donation.id} (${donation.amount} UZS)`);
      const ok = await confirmLiveDonation(donation.id, 'RECENT_SMS_MATCH');
      if (ok) {
        return res.json({
          success: true,
          status: 'PAID',
          displayInSeconds: 15
        });
      }
    }

    // 2. Admin test bypass: if the sender is admin or adminBypass flag is passed by an admin user
    const isUserAdmin = isAdmin(String(donation.userId));
    if (req.body?.adminBypass && isUserAdmin) {
      console.log(`[DONATION CHECK] Admin bypass triggered for donation #${donation.id} by admin ${donation.userId}`);
      const ok = await confirmLiveDonation(donation.id, 'ADMIN_TEST_BYPASS');
      if (ok) {
        return res.json({
          success: true,
          status: 'PAID',
          displayInSeconds: 15,
          isAdminBypass: true
        });
      }
    }

    // 3. Still pending — automatic bank verification in progress
    res.json({
      success: false,
      status: 'PENDING',
      isAdminUser: isUserAdmin,
      message: 'To\'lov bank tizimi orqali avtomatik tekshirilmoqda (odatda 10-20 soniya vaqt oladi). Iltimos, oynani yopmasdan kuting yoki qayta tekshiring.'
    });
  } catch (err) {
    console.error('check donation error:', err);
    res.status(500).json({ error: 'Donat holatini tekshirishda xatolik' });
  }
});

// 4. Manual confirm donation (for admin or instant confirmation)
app.post('/api/live/donate/confirm/:donationId', async (req, res) => {
  try {
    const donationId = Number(req.params.donationId);
    const ok = await confirmLiveDonation(donationId, 'MANUAL_API');
    if (ok) {
      res.json({ success: true, displayInSeconds: 15 });
    } else {
      res.status(404).json({ error: 'Donat topilmadi yoki tasdiqlab bo\'lmadi' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Confirm error' });
  }
});

// 5. Admin: Get recent live donations list
app.get('/api/admin/donations', requireAdmin, async (_req, res) => {
  try {
    const donations = await (prisma as any).liveDonation.findMany({
      take: 50,
      orderBy: { id: 'desc' }
    });
    res.json({ donations });
  } catch (err) {
    console.error('get admin donations error:', err);
    res.status(500).json({ error: 'Donatlarni yuklashda xatolik' });
  }
});

// 6. Admin: Cancel donation
app.post('/api/admin/donations/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await (prisma as any).liveDonation.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Donatni bekor qilishda xatolik' });
  }
});


// 10. Admin: Manage Streamers
app.get('/api/admin/streamers', requireAdmin, async (_req, res) => {
  try {
    const streamers = await (prisma as any).streamer.findMany({ orderBy: { id: 'desc' } });
    const adminEnvRaw = process.env.ADMIN_ID?.trim();
    const adminIds = adminEnvRaw ? adminEnvRaw.split(',').map(id => id.trim()).filter(Boolean) : [];

    res.json({ streamers, adminIds });
  } catch (err) {
    console.error('get streamers error:', err);
    res.status(500).json({ error: 'Failed to get streamers' });
  }
});

app.post('/api/admin/streamers', requireAdmin, async (req, res) => {
  try {
    const { userId, username, name } = req.body;
    if (!userId || !String(userId).trim()) {
      return res.status(400).json({ error: 'Telegram User ID kiritilishi shart' });
    }

    const cleanUserId = String(userId).trim();
    if (!/^\d+$/.test(cleanUserId)) {
      return res.status(400).json({ error: 'Telegram User ID faqat raqamlardan iborat bo\'lishi kerak' });
    }

    const cleanUsername = username ? String(username).replace(/^@/, '').trim() : null;
    const cleanName = name ? String(name).trim() : null;

    const created = await (prisma as any).streamer.upsert({
      where: { userId: cleanUserId },
      update: { username: cleanUsername || null, name: cleanName || null },
      create: { userId: cleanUserId, username: cleanUsername || null, name: cleanName || null }
    });

    res.json(created);
  } catch (err: any) {
    console.error('add streamer error:', err);
    res.status(500).json({ error: 'Streamer qo\'shishda xatolik', detail: err?.message });
  }
});

app.delete('/api/admin/streamers/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Noto\'g\'ri streamer ID raqami' });
    }

    const existing = await (prisma as any).streamer.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Streamer topilmadi' });
    }

    await (prisma as any).streamer.delete({ where: { id } });
    res.json({ success: true, message: 'Streamer muvaffaqiyatli o\'chirildi' });
  } catch (err: any) {
    console.error('delete streamer error:', err);
    res.status(500).json({ error: 'Streamerni o\'chirishda xatolik', detail: err?.message });
  }
});

// Real-time user activity stats endpoint
app.get('/api/admin/users/activity-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await getActivityStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user activity stats' });
  }
});

// Get users — paginated (50 per page), with optional search
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 50;
    const skip = (page - 1) * limit;
    const search = req.query.search as string | undefined;

    const where = search ? {
      OR: [
        { id: { contains: search } },
        { username: { contains: search } },
        { firstName: { contains: search } },
      ]
    } : {};

    const [users, total, activityStats] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: { subs: { include: { channel: { select: { title: true, id: true } } } } }
      }),
      prisma.user.count({ where }),
      getActivityStats().catch(() => null)
    ]);

    res.json({ users, total, page, totalPages: Math.ceil(total / limit), activityStats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// --- Mandatory Subscription Channels ---

// Public endpoint — used by bot to get list of mandatory channels
app.get('/api/mandatory-channels', async (req, res) => {
  try {
    const channels = await prisma.mandatoryChannel.findMany({ orderBy: { order: 'asc' } });
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mandatory channels' });
  }
});

// Admin CRUD
app.get('/api/admin/mandatory-channels', requireAdmin, async (req, res) => {
  try {
    const channels = await prisma.mandatoryChannel.findMany({ orderBy: { order: 'asc' } });
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mandatory channels' });
  }
});

app.post('/api/admin/mandatory-channels', requireAdmin, async (req, res) => {
  try {
    const count = await prisma.mandatoryChannel.count();
    if (count >= 10) {
      return res.status(400).json({ error: 'Maksimum 10 ta majburiy kanal qo\'shish mumkin' });
    }
    const { channelId, title, inviteLink, type } = req.body;
    if (!channelId || !title) {
      return res.status(400).json({ error: 'channelId va title majburiy' });
    }
    const channel = await prisma.mandatoryChannel.create({
      data: { channelId: channelId.toString(), title, inviteLink: inviteLink || null, type: type || 'CHANNEL', order: count }
    });
    res.json(channel);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(400).json({ error: 'Bu kanal allaqachon qo\'shilgan' });
    }
    res.status(500).json({ error: 'Failed to add mandatory channel' });
  }
});

app.delete('/api/admin/mandatory-channels/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.mandatoryChannel.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete mandatory channel' });
  }
});

// Check if a user is subscribed to all mandatory channels
app.get('/api/check-mandatory/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const mandatoryChannels = await prisma.mandatoryChannel.findMany({ orderBy: { order: 'asc' } });
    if (mandatoryChannels.length === 0) return res.json({ ok: true, missing: [] });

    const missing: any[] = [];
    for (const ch of mandatoryChannels) {
      try {
        if ((ch as any).type === 'BOT') {
          const isSubbed = await prisma.botSubscriber.findFirst({
            where: { userId: String(userId), logChannelId: ch.channelId }
          });
          if (!isSubbed) missing.push({ id: ch.id, channelId: ch.channelId, title: ch.title, inviteLink: ch.inviteLink, type: ch.type });
        } else {
          const member = await bot.telegram.getChatMember(ch.channelId, Number(userId));
          const status = member.status;
          if (!['member', 'administrator', 'creator'].includes(status)) {
            missing.push({ id: ch.id, channelId: ch.channelId, title: ch.title, inviteLink: ch.inviteLink, type: ch.type });
          }
        }
      } catch {
        // Can't check = treat as not subscribed
        missing.push({ id: ch.id, channelId: ch.channelId, title: ch.title, inviteLink: ch.inviteLink, type: ch.type });
      }
    }
    res.json({ ok: missing.length === 0, missing });
  } catch (err) {
    res.status(500).json({ error: 'Check failed' });
  }
});

// --- Card Management Routes ---

app.get('/api/cards', requireAdmin, async (req, res) => {
  try {
    const cards = await prisma.card.findMany({ orderBy: { slot: 'asc' } });
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch cards' });
  }
});

app.post('/api/admin/cards', requireAdmin, async (req, res) => {
  try {
    const { slot, cardNumber, cardHolder, bankName, maxTransfers, clickP2pUrl } = req.body;
    
    // Max 10 cards limit
    const cardCount = await prisma.card.count();
    if (cardCount >= 10) {
      return res.status(400).json({ error: 'Maksimum 10 ta karta qo\'shish mumkin' });
    }
    
    // Slot must be 1-10
    const slotNum = Number(slot);
    if (!slotNum || slotNum < 1 || slotNum > 10) {
      return res.status(400).json({ error: 'Slot raqami 1 dan 10 gacha bo\'lishi kerak' });
    }
    
    const card = await prisma.card.create({
      data: { 
        slot: slotNum, 
        cardNumber, 
        cardHolder, 
        bankName, 
        clickP2pUrl: clickP2pUrl ? String(clickP2pUrl).trim() : null,
        maxTransfers: Number(maxTransfers) || 40,
        isActive: cardCount === 0 // Avtomatik aktiv qilish, agar bu 1-karta bo'lsa
      }
    });
    res.json(card);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(400).json({ error: 'Bu slot raqami allaqachon mavjud' });
    }
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.put('/api/admin/cards/:id', requireAdmin, async (req, res) => {
  try {
    const { cardNumber, cardHolder, bankName, maxTransfers, slot, clickP2pUrl } = req.body;
    const card = await prisma.card.update({
      where: { id: Number(req.params.id) },
      data: { 
        cardNumber, 
        cardHolder, 
        bankName, 
        clickP2pUrl: clickP2pUrl !== undefined ? (clickP2pUrl ? String(clickP2pUrl).trim() : null) : undefined,
        maxTransfers: Number(maxTransfers), 
        slot: Number(slot) 
      }
    });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update card' });
  }
});

app.delete('/api/admin/cards/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.card.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

app.post('/api/admin/cards/:id/activate', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.$transaction([
      prisma.card.updateMany({ data: { isActive: false } }),
      prisma.card.update({ where: { id }, data: { isActive: true } })
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate card' });
  }
});

app.post('/api/admin/cards/:id/reset', requireAdmin, async (req, res) => {
  try {
    await prisma.card.update({
      where: { id: Number(req.params.id) },
      data: { transferCount: 0 }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset card' });
  }
});

import { incrementCardTransfer } from './cardService';

app.post('/api/admin/cards/rotate', requireAdmin, async (req, res) => {
  try {
    const activeCard = await prisma.card.findFirst({ where: { isActive: true } });
    if (!activeCard) {
      const firstCard = await prisma.card.findFirst({ orderBy: { slot: 'asc' } });
      if (firstCard) {
        await prisma.card.update({ where: { id: firstCard.id }, data: { isActive: true } });
      }
      return res.json({ success: true });
    }
    
    // Force a rotation by temporarily setting transfer count to max, then calling the service, or just doing it here
    const allCards = await prisma.card.findMany({ orderBy: { slot: 'asc' } });
    if (allCards.length === 0) return res.json({ success: true });

    let nextCard = allCards.find(c => c.slot > activeCard.slot);
    if (!nextCard) {
      nextCard = allCards[0]; // loop back
    }

    await prisma.$transaction([
      prisma.card.updateMany({ data: { isActive: false } }),
      prisma.card.update({ where: { id: nextCard.id }, data: { isActive: true, transferCount: 0 } })
    ]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rotate card' });
  }
});

// Broadcast message - parallel batch sending for speed (supports photo, video, text, inline button)
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  const { text, mediaBase64, mediaType, imageBase64, buttonText, buttonUrl } = req.body;
  
  const rawMedia = mediaBase64 || imageBase64;
  if (!text && !rawMedia) {
    return res.status(400).json({ error: 'Xabar matni, rasm yoki video kiritilishi shart' });
  }

  res.json({ success: true, message: 'Broadcast started' });

  try {
    const users = await prisma.user.findMany({ select: { id: true } });
    
    let mediaBuffer: Buffer | null = null;
    if (rawMedia) {
      const base64Data = rawMedia.replace(/^data:(image|video)\/\w+;base64,/, "");
      mediaBuffer = Buffer.from(base64Data, 'base64');
    }
    
    const isVideo = mediaType === 'video' || (rawMedia && rawMedia.startsWith('data:video/'));

    // Prepare optional inline keyboard
    let extraOptions: any = {};
    if (buttonText && buttonUrl) {
      try {
        extraOptions.reply_markup = Markup.inlineKeyboard([
          Markup.button.url(buttonText, buttonUrl)
        ]).reply_markup;
      } catch (err) {
        console.error('Broadcast inline button error:', err);
      }
    }

    const BATCH_SIZE = 25; // Send 25 at a time
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const sendOne = async (userId: string) => {
      try {
        if (mediaBuffer && isVideo) {
          await bot.telegram.sendVideo(userId, { source: mediaBuffer }, { caption: text || '', ...extraOptions });
        } else if (mediaBuffer) {
          await bot.telegram.sendPhoto(userId, { source: mediaBuffer }, { caption: text || '', ...extraOptions });
        } else {
          await bot.telegram.sendMessage(userId, text || '', extraOptions);
        }
      } catch (e: any) {
        if (e?.response?.error_code === 403 || String(e).toLowerCase().includes('blocked')) {
          recordUserBlocked(userId);
        }
        // user blocked bot or other error — skip
      }
    };

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(u => sendOne(u.id)));
      if (i + BATCH_SIZE < users.length) {
        await sleep(300);
      }
    }
    
    console.log(`Broadcast done: sent to ${users.length} users (isVideo: ${isVideo})`);
  } catch (err) {
    console.error('Broadcast failed:', err);
  }
});

// Get payments (with optional status filter, limited to 100 to prevent crash)
app.get('/api/admin/payments', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const where = status && status !== 'ALL' ? { status } : {};
    const payments = await prisma.payment.findMany({
      where,
      take: 100,
      include: { user: true, plan: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

// Get revenue stats — use DB-level SUM, cached 30s
app.get('/api/admin/revenue', requireAdmin, async (req, res) => {
  const cached = cache.get('revenue');
  if (cached) return res.json(cached);
  try {
    const agg = await prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
      _count: { id: true }
    });
    const result = { 
      totalRevenue: agg._sum.amount ?? 0, 
      totalPayments: agg._count.id 
    };
    cache.set('revenue', result, 30);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get revenue' });
  }
});

// Get monthly revenue breakdown (cached 60s)
app.get('/api/admin/monthly-revenue', requireAdmin, async (req, res) => {
  const cached = cache.get('monthly-revenue');
  if (cached) return res.json(cached);
  try {
    const completedPayments = await prisma.payment.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { createdAt: 'asc' }
    });

    const monthlyMap: Record<string, { revenue: number; count: number }> = {};
    const MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];

    for (const p of completedPayments) {
      const d = new Date(p.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (!monthlyMap[key]) monthlyMap[key] = { revenue: 0, count: 0 };
      monthlyMap[key].revenue += p.amount;
      monthlyMap[key].count += 1;
    }

    const result = Object.entries(monthlyMap)
      .sort(([a], [b]) => b.localeCompare(a)) // newest first
      .map(([key, val]) => {
        const [year, month] = key.split('-');
        const label = `${MONTHS[parseInt(month) - 1]} ${year}`;
        return { key, label, ...val };
      });

    cache.set('monthly-revenue', result, 60);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get monthly revenue' });
  }
});

// === Promo Code CRUD ===
app.get('/api/admin/promos', requireAdmin, async (req, res) => {
  try {
    const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(promos);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get promos' });
  }
});

app.post('/api/admin/promos', requireAdmin, async (req, res) => {
  const { code, discountType, discountValue, maxUses } = req.body;
  try {
    const promo = await prisma.promoCode.create({
      data: {
        code: code.toUpperCase(),
        discountType: discountType || 'percent',
        discountValue: Number(discountValue),
        maxUses: Number(maxUses) || 0
      }
    });
    res.json(promo);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create promo' });
  }
});

app.delete('/api/admin/promos/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.promoCode.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete promo' });
  }
});

// Validate promo code (public)
app.post('/api/validate-promo', async (req, res) => {
  const { code, planId } = req.body;
  try {
    const promo = await prisma.promoCode.findUnique({ where: { code: code.toUpperCase() } });
    if (!promo || !promo.active || (promo.maxUses > 0 && promo.usedCount >= promo.maxUses)) {
      return res.json({ valid: false });
    }
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.json({ valid: false });

    let discountedPrice = plan.price;
    if (promo.discountType === 'percent') {
      discountedPrice = Math.round(plan.price * (1 - promo.discountValue / 100));
    } else {
      discountedPrice = Math.max(plan.price - promo.discountValue, 0);
    }
    res.json({ valid: true, discountedPrice, discountType: promo.discountType, discountValue: promo.discountValue });
  } catch (err) {
    res.status(500).json({ valid: false });
  }
});

// Confirm payment
app.post('/api/admin/payments/:id/confirm', requireAdmin, async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { plan: true }
    });

    if (!payment || payment.status !== 'PENDING') {
      return res.status(400).json({ error: 'Invalid payment or already processed' });
    }

    // Mark as completed
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'COMPLETED' }
    });

    // Create subscription
    const expiresAt = new Date();
    if (payment.plan.duration === 0) {
      expiresAt.setFullYear(expiresAt.getFullYear() + 100);
    } else {
      expiresAt.setDate(expiresAt.getDate() + payment.plan.duration);
    }

    await prisma.subscription.create({
      data: {
        userId: payment.userId,
        channelId: payment.plan.channelId,
        expiresAt: expiresAt,
        status: 'ACTIVE'
      }
    });

    // Try sending invite link
    try {
      const inviteLink = await bot.telegram.createChatInviteLink(payment.plan.channelId, {
        creates_join_request: true,
        expire_date: Math.floor(Date.now() / 1000) + 7 * 86400,
      });

      const durationText = payment.plan.duration === 0 
        ? "butun umr" 
        : `${payment.plan.duration} kun`;

      await bot.telegram.sendMessage(
        payment.userId, 
        `✅ To'lovingiz (${payment.amount} so'm) admin tomonidan tasdiqlandi!\n\nObunangiz sotib olingan vaqtdan boshlab ${durationText} amal qiladi.\n\nKanalga kirish uchun maxsus havola (faqat siz uchun, uni boshqalarga bermang):\n${inviteLink.invite_link}`
      );
    } catch (err) {
      console.error("Manual invite link error:", err);
      try {
        await bot.telegram.sendMessage(
          payment.userId, 
          `✅ To'lovingiz tasdiqlandi, lekin kanalga havola yaratishda xatolik yuz berdi. Iltimos, adminga murojaat qiling.`
        );
      } catch (e) {} // ignore if user blocked
    }

    // Invalidate caches so stats reflect new payment immediately
    cache.del(['revenue', 'monthly-revenue', 'stats']);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

// Reject payment
app.post('/api/admin/payments/:id/reject', requireAdmin, async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

    if (!payment || payment.status !== 'PENDING') {
      return res.status(400).json({ error: 'Invalid payment' });
    }

    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'CANCELLED' }
    });

    try {
      await bot.telegram.sendMessage(
        payment.userId,
        `❌ Kechirasiz, to'lovingiz (${payment.amount} so'm) qabul qilinmadi yoki tasdiqlanmadi. Iltimos, ma'lumotlarni tekshiring.`
      );
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Rejection failed' });
  }
});

// Get settings (public for card number and rub rate)
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.settings.create({ data: { id: 1 } });
    }
    
    const activeCard = await prisma.card.findFirst({ where: { isActive: true } });
    
    res.json({ 
      cardNumber: activeCard ? activeCard.cardNumber : '',
      cardHolder: activeCard ? activeCard.cardHolder : '',
      rubRate: settings.rubRate || 155,
      clickP2pUrl: (activeCard && activeCard.clickP2pUrl) ? activeCard.clickP2pUrl : (settings.clickP2pUrl || '')
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

const complaints = new Set<string>();

app.post('/api/complaint', async (req, res) => {
  const { userId, paymentId, amount } = req.body;
  if (!userId || !paymentId || !amount) {
    return res.status(400).json({ error: "Noto'g'ri ma'lumotlar!" });
  }

  const key = `${userId}_${paymentId}`;
  if (complaints.has(key)) {
    return res.status(429).json({ error: "Siz ushbu to'lov bo'yicha allaqachon shikoyat yuborgansiz!" });
  }
  complaints.add(key);

  try {
    const adminIdEnv = process.env.ADMIN_ID;
    const adminIds = adminIdEnv ? adminIdEnv.split(',').map(id => id.trim()) : [];
    if (adminIds.length > 0) {
      const dateStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Tashkent" });
      const message = 
        `📞 Shikoyat!\n` +
        `👤 Foydalanuvchi: ${userId}\n` +
        `💰 To'langan summa: ${amount} UZS\n` +
        `🆔 To'lov ID: #${paymentId}\n` +
        `⏰ Vaqt: ${dateStr}\n\n` +
        `Foydalanuvchi to'lov tushmaganligidan shikoyat qilmoqda.`;
      
      for (const adminId of adminIds) {
        await bot.telegram.sendMessage(adminId, message).catch((e: any) => {
          if (e.response?.error_code !== 403 && e.response?.error_code !== 400) {
            console.error(`Complaint notification error for ${adminId}:`, e);
          }
        });
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Complaint error:", err);
    res.status(500).json({ error: "Shikoyat yuborishda xatolik yuz berdi" });
  }
});

// Fallback for cached hashed assets (CSS/JS)
app.use('/assets', (req, res, next) => {
  const assetsPath = path.join(__dirname, '../../frontend/dist/assets');
  const reqName = req.path.replace(/^\//, '');
  
  // Set long-term immutable cache for all hashed assets to eliminate egress costs
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (fs.existsSync(path.join(assetsPath, reqName))) {
    return next();
  }

  const ext = reqName.endsWith('.css') ? '.css' : reqName.endsWith('.js') ? '.js' : null;
  if (ext) {
    try {
      const files = fs.readdirSync(assetsPath);
      const fallback = files.find(f => f.endsWith(ext));
      if (fallback) {
        return res.sendFile(path.join(assetsPath, fallback));
      }
    } catch (e) {
      // ignore
    }
  }
  next();
});

// Serve static files from frontend build with high-efficiency caching
app.use(express.static(path.join(__dirname, '../../frontend/dist'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // HTML is revalidated so users immediately receive new app deployments
      res.setHeader('Cache-Control', 'no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      // Hashed assets (JS, CSS, SVGs, web fonts) are immutable — 1-year browser cache!
      // Drastically slashes egress bandwidth by over 99% for 32k+ users
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Catch-all route for frontend SPA routing (revalidated HTML)
app.use((req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate, private');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const filePath = path.join(__dirname, '../../frontend/dist/index.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Frontend build not found at', filePath);
      res.status(500).send('Frontend is building or not found. Please wait.');
    }
  });
});
