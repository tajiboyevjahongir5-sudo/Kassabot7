import { Telegraf, Markup } from 'telegraf';
import { prisma } from './prisma';
import 'dotenv/config';

export const bot = new Telegraf(process.env.BOT_TOKEN || 'dummy');

// ============ COMMANDS ============

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
    return;
  }

  await ctx.reply(
    '🛠 Admin Panelga xush kelibsiz! Kanallar va tariflarni boshqarish uchun pastdagi tugmani bosing.',
    Markup.inlineKeyboard([
      Markup.button.webApp('⚙️ Boshqaruv Paneli', `${webAppUrl}?admin=true`)
    ])
  );
});

// /mystatus — foydalanuvchi obunalarini ko'rsatish
bot.command('mystatus', async (ctx) => {
  const userId = ctx.from.id.toString();

  try {
    const subs = await prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { channel: true }
    });

    if (subs.length === 0) {
      return ctx.reply('📭 Sizda hozircha faol obunalar yo\'q.\n\nObuna bo\'lish uchun /start buyrug\'ini yuboring.');
    }

    let text = '📋 **Sizning obunalaringiz:**\n\n';
    for (const sub of subs) {
      const expiresAt = new Date(sub.expiresAt);
      const now = new Date();
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      text += `📺 **${sub.channel.title}**\n`;
      text += `   📅 Tugash: ${expiresAt.toLocaleDateString('uz-UZ')}\n`;
      text += `   ⏳ Qoldi: ${daysLeft > 0 ? daysLeft + ' kun' : '⚠️ Bugun tugaydi!'}\n\n`;
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('mystatus error:', err);
    await ctx.reply('Xatolik yuz berdi. Qaytadan urinib ko\'ring.');
  }
});

// /help — yordam
bot.command('help', async (ctx) => {
  await ctx.reply(
    '🤖 **Bot buyruqlari:**\n\n' +
    '/start — Botni ishga tushirish va obunalarni ko\'rish\n' +
    '/mystatus — Faol obunalaringizni tekshirish\n' +
    '/help — Shu yordam xabari\n\n' +
    '💡 **Qanday ishlaydi?**\n' +
    '1. /start tugmasini bosing\n' +
    '2. Kerakli tarifni tanlang\n' +
    '3. Ko\'rsatilgan summani kartaga o\'tkazing\n' +
    '4. To\'lov tasdiqlangach, kanalga kirish havolasi keladi\n\n' +
    '❓ Savollar bo\'lsa adminga murojaat qiling.',
    { parse_mode: 'Markdown' }
  );
});

// ============ CHANNEL POST LISTENER (Auto-verify payments) ============

bot.on('channel_post', async (ctx) => {
  const channelId = ctx.chat.id.toString();
  
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings || settings.paymentChannelId !== channelId) {
    return;
  }

  const text = (ctx.channelPost as any).text || "";
  if (!text) return;

  const normalizedText = text.replace(/[\s,]/g, '');

  const pendingPayments = await prisma.payment.findMany({ 
    where: { status: 'PENDING' },
    include: { plan: true, user: true }
  });

  for (const payment of pendingPayments) {
    const amountStr = payment.amount.toString();
    const regex = new RegExp('(^|\\D)' + amountStr + '(\\D|$)');
    
    if (regex.test(normalizedText)) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED' }
      });

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

      break;
    }
  }
});

// ============ INLINE BUTTON CALLBACKS (Admin confirm/reject from Telegram) ============

bot.on('callback_query', async (ctx) => {
  const data = (ctx.callbackQuery as any).data;
  if (!data) return;

  const adminId = process.env.ADMIN_ID;
  if (adminId && ctx.from.id.toString() !== adminId) {
    return ctx.answerCbQuery('⛔ Siz admin emassiz.');
  }

  const [action, paymentIdStr] = data.split(':');
  const paymentId = parseInt(paymentIdStr);
  if (isNaN(paymentId)) return;

  if (action === 'confirm_pay') {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { plan: true }
      });

      if (!payment || payment.status !== 'PENDING') {
        return ctx.answerCbQuery('⚠️ Bu to\'lov allaqachon qayta ishlangan.');
      }

      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'COMPLETED' }
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + payment.plan.duration);

      await prisma.subscription.create({
        data: {
          userId: payment.userId,
          channelId: payment.plan.channelId,
          expiresAt,
          status: 'ACTIVE'
        }
      });

      try {
        const inviteLink = await bot.telegram.createChatInviteLink(payment.plan.channelId, {
          member_limit: 1,
          expire_date: Math.floor(Date.now() / 1000) + 86400,
        });

        await bot.telegram.sendMessage(
          payment.userId,
          `✅ To'lovingiz (${payment.amount} so'm) admin tomonidan tasdiqlandi!\n\nKanalga kirish havolasi:\n${inviteLink.invite_link}`
        );
      } catch (err) {
        console.error('Invite link error:', err);
        await bot.telegram.sendMessage(
          payment.userId,
          `✅ To'lovingiz tasdiqlandi! Adminga murojaat qiling — kanalga kirish uchun.`
        ).catch(() => {});
      }

      await ctx.editMessageText(
        (ctx.callbackQuery as any).message.text + '\n\n✅ TASDIQLANDI',
        { reply_markup: undefined }
      );
      await ctx.answerCbQuery('✅ Tasdiqlandi!');
    } catch (err) {
      console.error('Confirm error:', err);
      await ctx.answerCbQuery('❌ Xatolik yuz berdi');
    }
  } else if (action === 'reject_pay') {
    try {
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.status !== 'PENDING') {
        return ctx.answerCbQuery('⚠️ Bu to\'lov allaqachon qayta ishlangan.');
      }

      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'CANCELLED' }
      });

      await bot.telegram.sendMessage(
        payment.userId,
        `❌ To'lovingiz (${payment.amount} so'm) qabul qilinmadi. Ma'lumotlarni tekshiring.`
      ).catch(() => {});

      await ctx.editMessageText(
        (ctx.callbackQuery as any).message.text + '\n\n❌ BEKOR QILINDI',
        { reply_markup: undefined }
      );
      await ctx.answerCbQuery('❌ Bekor qilindi');
    } catch (err) {
      console.error('Reject error:', err);
      await ctx.answerCbQuery('❌ Xatolik yuz berdi');
    }
  }
});

// ============ CRON JOBS ============

// 1. Expire old subscriptions and kick from channel (every hour)
export function startSubscriptionCron() {
  setInterval(async () => {
    try {
      const expiredSubs = await prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lt: new Date() }
        },
        include: { channel: true, user: true }
      });

      for (const sub of expiredSubs) {
        // Mark as expired
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED' }
        });

        // Try to kick from channel
        try {
          await bot.telegram.banChatMember(sub.channelId, parseInt(sub.userId));
          // Immediately unban so they can rejoin later if they re-subscribe
          await bot.telegram.unbanChatMember(sub.channelId, parseInt(sub.userId));
        } catch (err) {
          console.error(`Failed to kick user ${sub.userId} from ${sub.channelId}:`, err);
        }

        // Notify user
        try {
          await bot.telegram.sendMessage(
            sub.userId,
            `⏰ Sizning "${sub.channel.title}" kanaliga obunangiz tugadi.\n\nQayta obuna bo'lish uchun /start buyrug'ini yuboring.`
          );
        } catch (err) {} // user blocked bot
      }

      if (expiredSubs.length > 0) {
        console.log(`[CRON] ${expiredSubs.length} ta obuna muddati tugadi va bekor qilindi.`);
      }
    } catch (err) {
      console.error('[CRON] Subscription expiry error:', err);
    }
  }, 60 * 60 * 1000); // Every 1 hour
}

// 2. Warn users 1 day before expiry (every 6 hours)
export function startExpiryWarningCron() {
  setInterval(async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const today = new Date();

      const expiringSoon = await prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: {
            gte: today,
            lte: tomorrow
          }
        },
        include: { channel: true }
      });

      for (const sub of expiringSoon) {
        try {
          await bot.telegram.sendMessage(
            sub.userId,
            `⚠️ Diqqat! "${sub.channel.title}" kanaliga obunangiz ertaga tugaydi!\n\nQayta obuna bo'lish uchun /start buyrug'ini yuboring.`
          );
        } catch (err) {} // user blocked bot
      }
    } catch (err) {
      console.error('[CRON] Expiry warning error:', err);
    }
  }, 6 * 60 * 60 * 1000); // Every 6 hours
}

// 3. Auto-cancel payments older than 5 minutes (every 1 minute)
export function startPaymentTimeoutCron() {
  setInterval(async () => {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      const expiredPayments = await prisma.payment.findMany({
        where: {
          status: 'PENDING',
          createdAt: { lt: fiveMinutesAgo }
        }
      });

      if (expiredPayments.length > 0) {
        await prisma.payment.updateMany({
          where: {
            status: 'PENDING',
            createdAt: { lt: fiveMinutesAgo }
          },
          data: { status: 'CANCELLED' }
        });

        // Notify users
        for (const pay of expiredPayments) {
          try {
            await bot.telegram.sendMessage(
              pay.userId,
              `⏰ To'lov muddati tugadi (5 daqiqa). To'lov bekor qilindi.\n\nQaytadan urinish uchun /start buyrug'ini yuboring.`
            );
          } catch (err) {} // user blocked bot
        }

        console.log(`[CRON] ${expiredPayments.length} ta to'lov 5 daqiqadan oshgani uchun bekor qilindi.`);
      }
    } catch (err) {
      console.error('[CRON] Payment timeout error:', err);
    }
  }, 60 * 1000); // Every 1 minute
}

// ============ ADMIN NOTIFICATION HELPER ============

export async function notifyAdminNewPayment(payment: any, user: any, plan: any) {
  const adminId = process.env.ADMIN_ID;
  if (!adminId) return;

  try {
    const text = 
      `💰 **Yangi to'lov!**\n\n` +
      `👤 Ism: ${user.firstName || 'Ismsiz'}\n` +
      `📛 Username: ${user.username ? '@' + user.username : 'yo\'q'}\n` +
      `💵 Summa: ${payment.amount.toLocaleString()} UZS\n` +
      `📦 Tarif: ${plan.name}\n` +
      `🆔 To'lov ID: #${payment.id}`;

    await bot.telegram.sendMessage(adminId, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.callback('✅ Tasdiqlash', `confirm_pay:${payment.id}`),
        Markup.button.callback('❌ Bekor qilish', `reject_pay:${payment.id}`)
      ])
    });
  } catch (err) {
    console.error('Admin notification error:', err);
  }
}
