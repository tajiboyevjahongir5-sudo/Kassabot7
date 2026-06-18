import express from 'express';
import cors from 'cors';
import { prisma } from './prisma';
import { bot } from './bot';

import path from 'path';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// Health check route for Railway (must be BEFORE static files to avoid libuv thread pool exhaustion)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Serve static files from frontend build
// app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Get all channels and their plans
app.get('/api/channels', async (req, res) => {
  try {
    const channels = await prisma.channel.findMany({
      include: { plans: true }
    });
    res.json(channels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
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

// Create manual payment with random suffix
app.post('/api/create-payment', async (req, res) => {
  const { channelId, planId, userId, promoCode } = req.body;
  
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  try {
    // Check if user already has a pending payment for this plan to avoid creating duplicates needlessly
    const existing = await prisma.payment.findFirst({
      where: { userId: String(userId), planId, status: 'PENDING' }
    });

    if (existing) {
      return res.json({ payment: existing });
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

    // Generate random suffix 1 to 99
    const randomSuffix = Math.floor(Math.random() * 99) + 1;
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

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Check local development bypass or real telegram auth
  const isLocalHost = req.hostname === 'localhost';
  if (isLocalHost && process.env.NODE_ENV !== 'production') {
    return next(); // Bypass for local dev testing if needed
  }

  const initData = req.headers['x-telegram-init-data'] as string;
  const botToken = process.env.BOT_TOKEN;
  const adminId = process.env.ADMIN_ID; // The user's Telegram ID from Railway variables

  if (!initData || !botToken) {
    return res.status(401).json({ error: 'Unauthorized: Missing initData or token' });
  }

  const user = validateWebAppData(initData, botToken);
  
  // Also check against hardcoded ID if ADMIN_ID is not set yet, to prevent total lockout for the owner during setup
  if (!user || (adminId && user.id?.toString() !== adminId)) {
    return res.status(403).json({ error: 'Forbidden: You are not the admin' });
  }

  next();
};

// --- Admin Routes ---

// Get basic stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const activeSubs = await prisma.subscription.count({ where: { status: 'ACTIVE' } });
    const totalChannels = await prisma.channel.count();
    res.json({ totalUsers, activeSubs, totalChannels });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a new channel
app.post('/api/admin/channels', requireAdmin, async (req, res) => {
  const { id, title, adminId } = req.body;
  try {
    const channel = await prisma.channel.create({
      data: { id, title, adminId: adminId || "12345" }
    });
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add channel' });
  }
});

// Delete a channel
app.delete('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id as string;
    await prisma.plan.deleteMany({ where: { channelId: id } });
    await prisma.subscription.deleteMany({ where: { channelId: id } });
    await prisma.channel.delete({ where: { id: id } });
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
        priceType: 'STARS'
      }
    });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add plan' });
  }
});

// Delete a plan
app.delete('/api/admin/plans/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.payment.deleteMany({ where: { planId: Number(req.params.id) } });
    await prisma.plan.delete({ where: { id: Number(req.params.id) } });
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
  const { cardNumber, paymentChannelId } = req.body;
  try {
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: { cardNumber, paymentChannelId },
      create: { id: 1, cardNumber, paymentChannelId }
    });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Get users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { subs: { include: { channel: true } } }
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Broadcast message
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  const { text, imageBase64 } = req.body;
  if (!text && !imageBase64) return res.status(400).json({ error: 'Message text or image required' });

  try {
    const users = await prisma.user.findMany();
    let successCount = 0;
    
    let imageBuffer: Buffer | null = null;
    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      imageBuffer = Buffer.from(base64Data, 'base64');
    }
    
    for (const user of users) {
      try {
        if (imageBuffer) {
          await bot.telegram.sendPhoto(user.id, { source: imageBuffer }, { caption: text || '' });
        } else {
          await bot.telegram.sendMessage(user.id, text);
        }
        successCount++;
      } catch (e) {
        // user blocked bot etc.
      }
    }
    
    res.json({ success: true, count: successCount });
  } catch (err) {
    res.status(500).json({ error: 'Broadcast failed' });
  }
});

// Get payments (with optional status filter)
app.get('/api/admin/payments', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const where = status && status !== 'ALL' ? { status } : {};
    const payments = await prisma.payment.findMany({
      where,
      include: { user: true, plan: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

// Get revenue stats
app.get('/api/admin/revenue', requireAdmin, async (req, res) => {
  try {
    const completedPayments = await prisma.payment.findMany({
      where: { status: 'COMPLETED' }
    });
    const totalRevenue = completedPayments.reduce((sum, p) => sum + p.amount, 0);
    const totalPayments = completedPayments.length;
    res.json({ totalRevenue, totalPayments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get revenue' });
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
    expiresAt.setDate(expiresAt.getDate() + payment.plan.duration);

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
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 86400,
      });

      await bot.telegram.sendMessage(
        payment.userId, 
        `✅ To'lovingiz (${payment.amount} so'm) admin tomonidan tasdiqlandi!\n\nKanalga kirish uchun maxsus havola (faqat siz uchun, uni boshqalarga bermang):\n${inviteLink.invite_link}`
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

// Get settings (public for card number)
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.settings.create({ data: { id: 1 } });
    }
    // Only return card number to public, hide channel ID
    res.json({ cardNumber: settings.cardNumber });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Serve static files from frontend build
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Catch-all route for frontend SPA routing
app.use((req, res) => {
  const filePath = path.join(__dirname, '../../frontend/dist/index.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Frontend build not found at', filePath);
      res.status(500).send('Frontend is building or not found. Please wait.');
    }
  });
});
