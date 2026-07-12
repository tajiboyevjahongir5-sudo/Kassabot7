import cluster from 'cluster';
import os from 'os';

// ===================================================
// CLUSTER MODE: Use all 8 vCPU cores
// Master runs bot + crons (only 1 instance needed)
// Workers run HTTP API (one per CPU core)
// ===================================================

const NUM_CPUS = os.cpus().length; // 8 on Railway
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));



if (cluster.isPrimary) {
  console.log(`[MASTER] PID ${process.pid} — Starting ${NUM_CPUS} workers on ${NUM_CPUS} CPUs`);

  // Spawn one worker per CPU
  for (let i = 0; i < NUM_CPUS; i++) {
    cluster.fork();
  }

  // Restart dead workers automatically
  cluster.on('exit', (worker, code, signal) => {
    console.log(`[MASTER] Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });

  // ---- MASTER only: run bot polling & crons ----
  // (Only 1 bot instance allowed per token)
  import('./bot.js').then(async ({ bot, startSubscriptionCron, startExpiryWarningCron, startPaymentTimeoutCron, startRubRateCron }) => {
    import('./prisma.js').then(async ({ prisma }) => {
      try {
        // Seed if empty
        const channelCount = await prisma.channel.count();
        if (channelCount === 0) {
          console.log('[MASTER] Seeding initial data...');
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
        console.error('[MASTER] Seed error:', e);
      }

      // Start bot
      if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'dummy') {
        try {
          await bot.launch({ allowedUpdates: ['message', 'channel_post', 'callback_query', 'chat_join_request'] });
          console.log('[MASTER] Telegram bot started.');
        } catch (botErr) {
          console.error('[MASTER] Bot failed to start:', botErr);
        }
      }

      // Start crons
      startSubscriptionCron();
      startExpiryWarningCron();
      startPaymentTimeoutCron();
      startRubRateCron();
      console.log('[MASTER] All cron jobs started.');
    });
  });

  process.once('SIGINT', () => process.exit(0));
  process.once('SIGTERM', () => process.exit(0));

} else {
  // ---- WORKER: serve HTTP API ----
  import('./api.js').then(({ app }) => {
    app.listen(PORT, () => {
      console.log(`[WORKER ${process.pid}] HTTP API running on port ${PORT}`);
    });
  });

  process.once('SIGINT', () => process.exit(0));
  process.once('SIGTERM', () => process.exit(0));
}
