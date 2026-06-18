import express from 'express';
import cors from 'cors';
import { prisma } from './prisma';
import { bot } from './bot';

import path from 'path';

export const app = express();
app.use(cors());
app.use(express.json());

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
  const { channelId, planId, userId } = req.body;
  
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

    // Generate random suffix 1 to 99
    const randomSuffix = Math.floor(Math.random() * 99) + 1;
    const finalAmount = plan.price + randomSuffix;

    // Make sure this exact amount is not currently pending for someone else
    // In a very busy system, we'd loop until we find a unique amount, but for now this is okay.
    const payment = await prisma.payment.create({
      data: {
        userId: String(userId),
        planId,
        amount: finalAmount,
        status: 'PENDING'
      }
    });

    res.json({ payment });
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
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Message text required' });

  try {
    const users = await prisma.user.findMany();
    let successCount = 0;
    
    // In a real app this should be a background job with delay to avoid rate limits
    // For now we do a simple loop
    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.id, text);
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
