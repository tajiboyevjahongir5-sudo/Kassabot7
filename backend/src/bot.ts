import { Telegraf, Markup } from 'telegraf';
import { prisma } from './prisma';
import 'dotenv/config';

export const bot = new Telegraf(process.env.BOT_TOKEN || 'dummy');

bot.start(async (ctx) => {
  const user = ctx.from;
  if (user) {
    await prisma.user.upsert({
      where: { id: user.id.toString() },
      update: {
        username: user.username,
        firstName: user.first_name,
      },
      create: {
        id: user.id.toString(),
        username: user.username,
        firstName: user.first_name,
      }
    });
  }

  const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
  
  await ctx.reply(
    '🌟 Salom! VIP kanallarga obuna bo\'lish va ularni boshqarish uchun pastdagi tugmani bosing.',
    Markup.inlineKeyboard([
      Markup.button.webApp('🚀 Obunalarni boshqarish', webAppUrl)
    ])
  );
});

bot.command('admin', async (ctx) => {
  const adminId = process.env.ADMIN_ID;
  const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';

  if (!adminId || ctx.from.id.toString() !== adminId) {
    // Silently ignore or send a generic message
    return;
  }

  await ctx.reply(
    '🛠 Admin Panelga xush kelibsiz! Kanallar va tariflarni boshqarish uchun pastdagi tugmani bosing.',
    Markup.inlineKeyboard([
      Markup.button.webApp('⚙️ Boshqaruv Paneli', `${webAppUrl}?admin=true`)
    ])
  );
});

bot.on('channel_post', async (ctx) => {
  const channelId = ctx.chat.id.toString();
  
  // Check if this channel is the designated payment channel
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings || settings.paymentChannelId !== channelId) {
    return; // Ignore messages from other channels
  }

  const text = (ctx.channelPost as any).text || "";
  if (!text) return;

  // Normalize text: remove spaces and commas to easily match amounts like "100 042" or "100,042"
  const normalizedText = text.replace(/[\s,]/g, '');

  const pendingPayments = await prisma.payment.findMany({ 
    where: { status: 'PENDING' },
    include: { plan: true, user: true }
  });

  for (const payment of pendingPayments) {
    // Look for the exact amount bounded by non-digits
    const amountStr = payment.amount.toString();
    const regex = new RegExp('(^|\\D)' + amountStr + '(\\D|$)');
    
    if (regex.test(normalizedText)) {
      // We found a match! Verify payment.
      
      // 1. Mark payment as completed
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED' }
      });

      // 2. Create or extend subscription
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

      // 3. Generate invite link and send it to the user
      try {
        const inviteLink = await ctx.telegram.createChatInviteLink(payment.plan.channelId, {
          member_limit: 1,
          expire_date: Math.floor(Date.now() / 1000) + 86400,
        });

        await bot.telegram.sendMessage(
          payment.userId, 
          `✅ To'lovingiz (${payment.amount} so'm) tasdiqlandi!\n\nKanalga kirish uchun maxsus havola (faqat siz uchun, uni boshqalarga bermang):\n${inviteLink.invite_link}`
        );
      } catch (err) {
        console.error("Create link error:", err);
        await bot.telegram.sendMessage(
          payment.userId, 
          `✅ To'lovingiz tasdiqlandi, lekin kanalga havola yaratishda xatolik yuz berdi. Iltimos, adminga murojaat qiling.`
        );
      }

      // Stop after processing this payment match so we don't apply one message to multiple identical payments (if any)
      break;
    }
  }
});
