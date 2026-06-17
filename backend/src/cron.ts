import cron from 'node-cron';
import { prisma } from './prisma';
import { bot } from './bot';

export const startCronJobs = () => {
  // Run every hour to check for expired subscriptions
  cron.schedule('0 * * * *', async () => {
    console.log('Running cron to check expired subscriptions...');
    
    const now = new Date();
    
    const expiredSubs = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: now }
      }
    });

    for (const sub of expiredSubs) {
      try {
        // 1. Kick user from channel (ban then unban so they can rejoin later)
        await bot.telegram.banChatMember(sub.channelId, Number(sub.userId));
        await bot.telegram.unbanChatMember(sub.channelId, Number(sub.userId));
        
        // 2. Mark as expired
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED' }
        });
        
        // 3. Notify user
        await bot.telegram.sendMessage(sub.userId, `❌ Obunangiz yakunlandi va siz kanaldan o'chirildingiz. Qayta qo'shilish uchun bot orqali obunani yangilang.`);
        
      } catch (err) {
        console.error(`Error kicking user ${sub.userId} from channel ${sub.channelId}:`, err);
      }
    }
  });
  console.log("Cron jobs started.");
};
