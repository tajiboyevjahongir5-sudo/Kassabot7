import { prisma } from './prisma.js';
import { bot, startSubscriptionCron, startExpiryWarningCron, startPaymentTimeoutCron, startRubRateCron, startCardResetCron } from './bot.js';
import { app } from './api.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

async function main() {
  console.log(`[SERVER] PID ${process.pid} starting...`);

  // Seed if empty
  try {
    const channelCount = await prisma.channel.count();
    if (channelCount === 0) {
      console.log('[SERVER] Seeding initial data...');
      const ch = await prisma.channel.create({
        data: { id: '-1001234567890', title: 'IT Dasturlash - Premium VIP', adminId: '123456789' }
      });
      await prisma.plan.createMany({
        data: [
          { channelId: ch.id, name: '1 Oylik VIP Obuna', description: 'Barcha maxfiy darslar va materiallarga 30 kunlik ruxsat', price: 100000, priceType: 'UZS', duration: 30 },
          { channelId: ch.id, name: '3 Oylik VIP Obuna', description: '90 kunlik ruxsat + shaxsiy ustoz yordami', price: 250000, priceType: 'UZS', duration: 90 },
        ]
      });
    }
  } catch (e) {
    console.error('[SERVER] Seed error:', e);
  }

  // Start HTTP API
  app.listen(PORT, () => {
    console.log(`[SERVER] HTTP API running on port ${PORT}`);
  });

  // Start Telegram bot
  if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'dummy') {
    try {
      await bot.launch({ allowedUpdates: ['message', 'channel_post', 'callback_query', 'chat_join_request'] });
      console.log('[SERVER] Telegram bot started.');
    } catch (botErr) {
      console.error('[SERVER] Bot failed to start:', botErr);
    }
  }

  // Start crons
  startSubscriptionCron();
  startExpiryWarningCron();
  startPaymentTimeoutCron();
  startRubRateCron();
  startCardResetCron();
  console.log('[SERVER] All cron jobs started.');
}

main().catch(err => {
  console.error('[SERVER] Fatal error:', err);
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
