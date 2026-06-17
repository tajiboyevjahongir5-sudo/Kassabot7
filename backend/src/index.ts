import { app } from './api';
import { bot } from './bot';
import { startCronJobs } from './cron';
import { prisma } from './prisma';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function bootstrap() {
  // ALWAYS Start API immediately so Railway doesn't kill the container due to timeout
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Server is running on port ${PORT}`);
  });

  try {
    // Dummy ma'lumotlar bilan to'ldirish (agar bo'sh bo'lsa)
    const channelCount = await prisma.channel.count();
    if (channelCount === 0) {
      console.log("Seeding initial data...");
      const ch = await prisma.channel.create({
        data: {
          id: "-1001234567890", // dummy telegram chat id
          title: "IT Dasturlash - Premium VIP",
          adminId: "123456789",
        }
      });
      await prisma.plan.create({
        data: {
          channelId: ch.id,
          name: "1 Oylik VIP Obuna",
          description: "Barcha maxfiy darslar va materiallarga 30 kunlik ruxsat",
          price: 100, // 100 Telegram Stars
          priceType: "STARS",
          duration: 30
        }
      });
      await prisma.plan.create({
        data: {
          channelId: ch.id,
          name: "3 Oylik VIP Obuna",
          description: "90 kunlik ruxsat + shaxsiy ustoz yordami",
          price: 250, // 250 Telegram Stars
          priceType: "STARS",
          duration: 90
        }
      });
    }

    // Start Bot
    if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'dummy') {
      bot.launch();
      console.log(`[Bot] Telegram bot started.`);
    } else {
      console.log(`[Bot] Skipping bot launch, no valid BOT_TOKEN provided.`);
    }

    // Start Cron
    startCronJobs();
  } catch (err) {
    console.error("Bootstrap error:", err);
  }

}

bootstrap();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
