import express from 'express';
import cors from 'cors';
import compression from 'compression';
import NodeCache from 'node-cache';
import { Markup } from 'telegraf';
import { prisma } from './prisma';
import { bot } from './bot';

import path from 'path';
import fs from 'fs';

// In-memory cache — TTL 30 seconds for stats, 5 mins for channels
const cache = new NodeCache({ stdTTL: 30, checkperiod: 10, useClones: false });

export const app = express();
app.use(cors());
app.use(compression()); // gzip all responses — reduces bandwidth up to 70%
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));



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
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (existing.createdAt < fifteenMinutesAgo) {
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
import { validateWebAppData } from './utils/telegramAuth';

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
  const { paymentChannelId, joinRequestChannelId, joinRequestLink, joinRequestMessage, clickP2pUrl } = req.body;
  try {
    const updateData: any = {};
    if (paymentChannelId !== undefined) updateData.paymentChannelId = paymentChannelId;
    if (joinRequestChannelId !== undefined) updateData.joinRequestChannelId = joinRequestChannelId;
    if (joinRequestLink !== undefined) updateData.joinRequestLink = joinRequestLink;
    if (joinRequestMessage !== undefined) updateData.joinRequestMessage = joinRequestMessage;
    if (clickP2pUrl !== undefined) updateData.clickP2pUrl = clickP2pUrl;

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

// Add a new join request channel
app.post('/api/admin/join-request-channels', requireAdmin, async (req, res) => {
  try {
    const { channelId, title, inviteLink, customMessage } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: 'Kanal ID kiritilishi shart' });
    }

    const cleanChannelId = String(channelId).trim();
    let finalTitle = title ? String(title).trim() : '';

    if (!finalTitle) {
      try {
        const chat = await bot.telegram.getChat(cleanChannelId);
        if ((chat as any).title) finalTitle = (chat as any).title;
      } catch {}
      if (!finalTitle) finalTitle = `Kanal ${cleanChannelId}`;
    }

    const created = await (prisma as any).joinRequestChannel.create({
      data: {
        channelId: cleanChannelId,
        title: finalTitle,
        inviteLink: inviteLink ? String(inviteLink).trim() : null,
        customMessage: customMessage ? String(customMessage).trim() : null
      }
    });

    res.json(created);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(400).json({ error: 'Bu kanal ID allaqachon mavjud' });
    }
    console.error('create join-request-channel error:', err);
    res.status(500).json({ error: 'Failed to create join request channel' });
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

function broadcastLiveEvent(eventType: string, data: any, filter?: (client: LiveSSEClient) => boolean) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of activeLiveClients) {
    if (!filter || filter(client)) {
      try {
        client.res.write(payload);
      } catch {}
    }
  }
}

async function checkIsStreamer(userId: string): Promise<boolean> {
  if (!userId) return false;
  const adminEnvRaw = process.env.ADMIN_ID?.trim();
  const adminIds = adminEnvRaw ? adminEnvRaw.split(',').map(id => id.trim()).filter(Boolean) : [];
  if (adminIds.includes(String(userId))) return true;

  const streamer = await (prisma as any).streamer.findUnique({
    where: { userId: String(userId) }
  });
  return Boolean(streamer);
}

// 1. Get current live stream status
app.get('/api/live/status', async (_req, res) => {
  try {
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

    if (!activeStream) {
      return res.json({ active: false });
    }

    res.json({
      active: true,
      stream: {
        id: activeStream.id,
        streamerId: activeStream.streamerId,
        streamerName: activeStream.streamerName,
        title: activeStream.title,
        startedAt: activeStream.startedAt,
        viewersCount: Math.max(activeLiveClients.filter(c => c.role === 'viewer').length, 1)
      },
      recentComments: (activeStream.comments || []).reverse()
    });
  } catch (err) {
    console.error('live status error:', err);
    res.status(500).json({ error: 'Failed to get live status' });
  }
});

// 2. Get user's live notification status and streamer permission
app.get('/api/live/user-state/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
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
        viewersCount: 1
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

    res.json({ success: true, stream });
  } catch (err) {
    console.error('start stream error:', err);
    res.status(500).json({ error: 'Failed to start stream' });
  }
});

// 5. End live stream
app.post('/api/live/end', async (req, res) => {
  try {
    const { streamId, streamerId } = req.body;
    const isAuthorized = await checkIsStreamer(streamerId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Ruxsat berilmagan' });
    }

    if (streamId) {
      await (prisma as any).liveStream.update({
        where: { id: Number(streamId) },
        data: { status: 'ENDED', endedAt: new Date() }
      }).catch(() => {});
    } else {
      await (prisma as any).liveStream.updateMany({
        where: { status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: new Date() }
      });
    }

    broadcastLiveEvent('stream_ended', { message: 'Jonli efir yakunlandi' });
    res.json({ success: true });
  } catch (err) {
    console.error('end stream error:', err);
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
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const client: LiveSSEClient = { id: clientId, userId, name, role, res };
  activeLiveClients.push(client);

  const viewersCount = Math.max(activeLiveClients.filter(c => c.role === 'viewer').length, 1);
  res.write(`event: init\ndata: ${JSON.stringify({ clientId, viewersCount })}\n\n`);

  broadcastLiveEvent('viewers_count', { count: viewersCount });

  if (role === 'viewer') {
    broadcastLiveEvent('viewer_joined', { userId, name, clientId }, c => c.role === 'streamer');
  }

  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeatInterval);
    activeLiveClients = activeLiveClients.filter(c => c.id !== clientId);
    const updatedCount = Math.max(activeLiveClients.filter(c => c.role === 'viewer').length, 1);
    broadcastLiveEvent('viewers_count', { count: updatedCount });

    if (role === 'viewer') {
      broadcastLiveEvent('viewer_left', { userId, clientId }, c => c.role === 'streamer');
    }
  });
});

// 7. Post a live comment
app.post('/api/live/comment', async (req, res) => {
  try {
    const { streamId, userId, userName, text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Matn bo\'sh' });
    }

    const commentText = String(text).trim().slice(0, 300);
    const authorName = String(userName || 'Foydalanuvchi').trim().slice(0, 40);

    let savedCommentId = Date.now();
    if (streamId) {
      try {
        const saved = await (prisma as any).liveComment.create({
          data: {
            streamId: Number(streamId),
            userId: String(userId || 'anon'),
            userName: authorName,
            text: commentText
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
      userId: String(userId),
      userName: authorName,
      text: commentText,
      createdAt: new Date().toISOString()
    };

    broadcastLiveEvent('new_comment', commentData);

    res.json({ success: true, comment: commentData });
  } catch (err) {
    console.error('live comment error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// 8. WebRTC Signaling exchange
app.post('/api/live/signal', (req, res) => {
  const { targetClientId, targetRole, senderId, type, data } = req.body;
  
  if (targetClientId) {
    broadcastLiveEvent('webrtc_signal', { senderId, type, data }, c => c.id === targetClientId);
  } else if (targetRole) {
    broadcastLiveEvent('webrtc_signal', { senderId, type, data }, c => c.role === targetRole);
  } else {
    broadcastLiveEvent('webrtc_signal', { senderId, type, data });
  }

  res.json({ ok: true });
});

// 9. Frame relay fallback
app.post('/api/live/frame', (req, res) => {
  const { frame, streamerId } = req.body;
  if (!frame) return res.status(400).json({ error: 'Frame required' });

  broadcastLiveEvent('video_frame', { frame }, c => c.role === 'viewer');
  res.json({ ok: true });
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
    if (!userId) return res.status(400).json({ error: 'userId kiritilishi shart' });

    const created = await (prisma as any).streamer.upsert({
      where: { userId: String(userId).trim() },
      update: { username: username || null, name: name || null },
      create: { userId: String(userId).trim(), username: username || null, name: name || null }
    });

    res.json(created);
  } catch (err) {
    console.error('add streamer error:', err);
    res.status(500).json({ error: 'Failed to add streamer' });
  }
});

app.delete('/api/admin/streamers/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await (prisma as any).streamer.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error('delete streamer error:', err);
    res.status(500).json({ error: 'Failed to delete streamer' });
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

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: { subs: { include: { channel: { select: { title: true, id: true } } } } }
      }),
      prisma.user.count({ where })
    ]);

    res.json({ users, total, page, totalPages: Math.ceil(total / limit) });
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
      } catch (e) {
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

// Serve static files from frontend build
app.use(express.static(path.join(__dirname, '../../frontend/dist'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Catch-all route for frontend SPA routing
app.use((req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const filePath = path.join(__dirname, '../../frontend/dist/index.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Frontend build not found at', filePath);
      res.status(500).send('Frontend is building or not found. Please wait.');
    }
  });
});
