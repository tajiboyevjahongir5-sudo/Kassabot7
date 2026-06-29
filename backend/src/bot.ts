import { Telegraf, Markup } from 'telegraf';
import { prisma } from './prisma';
import { incrementCardTransfer } from './cardService';
import 'dotenv/config';
import cron from 'node-cron';

export const bot = new Telegraf(process.env.BOT_TOKEN || 'dummy');

// ============ HELPERS ============

// Parse ADMIN_ID env variable (supports comma-separated IDs)
function getAdminIds(): string[] {
  const adminId = process.env.ADMIN_ID;
  if (!adminId) return [];
  return adminId.split(',').map(id => id.trim()).filter(id => id.length > 0);
}

function isAdmin(userId: string): boolean {
  const adminIds = getAdminIds();
  return adminIds.includes(userId);
}

// ============ MANDATORY SUBSCRIPTION CHECK ============

async function checkMandatorySubscription(userId: number): Promise<{ ok: boolean; missing: any[] }> {
  try {
    const mandatoryChannels = await prisma.mandatoryChannel.findMany({ orderBy: { order: 'asc' } });
    if (mandatoryChannels.length === 0) return { ok: true, missing: [] };

    const missing: any[] = [];
    for (const ch of mandatoryChannels) {
      try {
        const member = await bot.telegram.getChatMember(ch.channelId, userId);
        if (!['member', 'administrator', 'creator'].includes(member.status)) {
          missing.push(ch);
        }
      } catch {
        missing.push(ch);
      }
    }
    return { ok: missing.length === 0, missing };
  } catch {
    return { ok: true, missing: [] }; // fail open
  }
}

async function sendSubscriptionPrompt(ctx: any, missing: any[]) {
  const urlButtons: any[] = missing.map((ch: any) => [
    Markup.button.url(`📢 ${ch.title}`, ch.inviteLink || `https://t.me/${ch.channelId.replace('@', '')}`)
  ]);
  const checkButton: any[] = [[Markup.button.callback('✅ Tekshirish', 'check_subscription')]];
  const allButtons = [...urlButtons, ...checkButton];
  
  await ctx.reply(
    `⚠️ Botdan foydalanish uchun quyidagi kanal(lar)ga obuna bo'lishingiz shart:\n\nObuna bo'lgach, "✅ Tekshirish" tugmasini bosing.`,
    Markup.inlineKeyboard(allButtons as any)
  );
}

// ============ COMMANDS ============

bot.start(async (ctx) => {
  const user = ctx.from;
  if (user) {
    await prisma.user.upsert({
      where: { id: user.id.toString() },
      update: { username: user.username, firstName: user.first_name },
      create: { id: user.id.toString(), username: user.username, firstName: user.first_name }
    });
  }

  // Check mandatory subscriptions
  const { ok, missing } = await checkMandatorySubscription(ctx.from.id);
  if (!ok) {
    return sendSubscriptionPrompt(ctx, missing);
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
  const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';

  if (!isAdmin(ctx.from.id.toString())) {
    return;
  }

  await ctx.reply(
    '🛠 Admin Panelga xush kelibsiz! Kanallar va tariflarni boshqarish uchun pastdagi tugmani bosing.',
    Markup.inlineKeyboard([
      Markup.button.webApp('⚙️ Boshqaruv Paneli', `${webAppUrl}?admin=true`)
    ])
  );
});

// ✅ Check subscription callback — fires when user clicks "Tekshirish"
bot.action('check_subscription', async (ctx) => {
  await ctx.answerCbQuery();
  const { ok, missing } = await checkMandatorySubscription(ctx.from!.id);
  if (!ok) {
    await sendSubscriptionPrompt(ctx, missing);
  } else {
    const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
    try { await ctx.deleteMessage(); } catch {}
    await ctx.reply(
      '✅ Rahmat! Siz barcha kanallarga obuna bo\'lganingiz tasdiqlandi.\n\nPastdagi tugmani bosing:',
      Markup.inlineKeyboard([
        Markup.button.webApp('🚀 Obunalarni boshqarish', webAppUrl)
      ])
    );
  }
});

// 🔒 Middleware: every non-admin user message checks mandatory subscriptions
bot.use(async (ctx, next) => {
  // Only check for private chats and actual users (not channel posts)
  if (ctx.chat?.type !== 'private' || !ctx.from) return next();
  // Skip admins
  if (isAdmin(ctx.from.id.toString())) return next();

  const { ok, missing } = await checkMandatorySubscription(ctx.from.id);
  if (!ok) {
    return sendSubscriptionPrompt(ctx, missing);
  }
  return next();
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
      if (daysLeft > 3650) {
        text += `   📅 Tugash: Butun umrlik\n`;
        text += `   ⏳ Qoldi: Cheklanmagan\n\n`;
      } else {
        text += `   📅 Tugash: ${expiresAt.toLocaleDateString('uz-UZ')}\n`;
        text += `   ⏳ Qoldi: ${daysLeft > 0 ? daysLeft + ' kun' : '⚠️ Bugun tugaydi!'}\n\n`;
      }
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

function extractNumbers(text: string): number[] {
  // Remove decimal .00 or ,00
  let temp = text.replace(/[,.]00\b/g, '');
  
  // Match candidate numbers (digits optionally separated by spaces, commas or dots)
  const matches = temp.match(/\b\d+(?:[\s,.]\d+)*\b/g) || [];
  const results: number[] = [];
  for (const m of matches) {
    const cleanVal = m.replace(/[\s,.]/g, '');
    const num = parseInt(cleanVal, 10);
    if (!isNaN(num)) {
      results.push(num);
    }
  }
  return results;
}

// ============ CHANNEL POST LISTENER (Auto-verify payments) ============

bot.on('channel_post', async (ctx) => {
  const channelId = ctx.chat.id.toString();
  
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings || settings.paymentChannelId !== channelId) {
    return;
  }

  const text = (ctx.channelPost as any).text || "";
  if (!text) return;

  const pendingPayments = await prisma.payment.findMany({ 
    where: { status: 'PENDING' },
    include: { plan: true, user: true }
  });

  const extractedNumbers = extractNumbers(text);
  const exactMatches: any[] = [];
  const closeMatches: any[] = [];

  for (const num of extractedNumbers) {
    for (const payment of pendingPayments) {
      if (payment.amount === num) {
        exactMatches.push(payment);
      } else if (Math.abs(payment.amount - num) <= 500) {
        closeMatches.push({ payment, foundAmount: num, expectedAmount: payment.amount });
      }
    }
  }

  if (exactMatches.length > 0) {
    // Process exact matches
    const uniqueExactMatches = exactMatches.filter((p, index, self) => 
      self.findIndex(t => t.id === p.id) === index
    );

    for (const payment of uniqueExactMatches) {
      try {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'COMPLETED' }
        });
        
        await incrementCardTransfer();

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

        const inviteLink = await bot.telegram.createChatInviteLink(payment.plan.channelId, {
          creates_join_request: true,
          expire_date: Math.floor(Date.now() / 1000) + 7 * 86400,
        });

        const durationText = payment.plan.duration === 0 
          ? "butun umr" 
          : `${payment.plan.duration} kun`;

        await bot.telegram.sendMessage(
          payment.userId, 
          `✅ To'lovingiz (${payment.amount} so'm) tasdiqlandi!\n\nObunangiz sotib olingan vaqtdan boshlab ${durationText} amal qiladi.\n\nKanalga kirish uchun maxsus havola (faqat siz uchun, uni boshqalarga bermang):\n${inviteLink.invite_link}`
        );
      } catch (err) {
        console.error("Auto confirmation error for payment ID " + payment.id + ":", err);
        try {
          await bot.telegram.sendMessage(
            payment.userId, 
            `✅ To'lovingiz tasdiqlandi, lekin kanalga havola yaratishda xatolik yuz berdi. Iltimos, adminga murojaat qiling.`
          );
        } catch (e) {}
      }
    }
  } else if (closeMatches.length > 0) {
    // Process close matches
    const uniqueCloseMatches = closeMatches.filter((m, index, self) => 
      self.findIndex(t => t.payment.id === m.payment.id) === index
    );

    const adminIds = getAdminIds();

    for (const match of uniqueCloseMatches) {
      const payment = match.payment;
      const foundAmount = match.foundAmount;
      const expectedAmount = match.expectedAmount;
      const usernameVal = payment.user?.username ? payment.user.username : 'yo\'q';

      // Notify all admins
      for (const aid of adminIds) {
        await bot.telegram.sendMessage(
          aid,
          `⚠️ Noto'g'ri summa keldi! Kimdir ${foundAmount} to'ladi, lekin kutilgan summa ${expectedAmount} edi. To'lov ID: #${payment.id}. Foydalanuvchi: @${usernameVal}`
        ).catch(e => console.error("Admin notification error:", e));
      }

      // Notify user
      await bot.telegram.sendMessage(
        payment.userId,
        `❌ To'lovingiz ${foundAmount} so'm bo'lib keldi, lekin biz ${expectedAmount} so'm kutgandik. Iltimos, adminga murojaat qiling yoki qaytadan urinib ko'ring.`
      ).catch(e => console.error("User warning notification error:", e));
    }
  }
});

// ============ INLINE BUTTON CALLBACKS (Admin confirm/reject from Telegram) ============

bot.on('callback_query', async (ctx) => {
  const data = (ctx.callbackQuery as any).data;
  if (!data) return;

  if (!isAdmin(ctx.from.id.toString())) {
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
      
      await incrementCardTransfer();

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
          expiresAt,
          status: 'ACTIVE'
        }
      });

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
          `✅ To'lovingiz (${payment.amount} so'm) admin tomonidan tasdiqlandi!\n\nObunangiz sotib olingan vaqtdan boshlab ${durationText} amal qiladi.\n\nKanalga kirish havolasi:\n${inviteLink.invite_link}`
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

// ============ CHAT JOIN REQUEST LISTENER ============

bot.on('chat_join_request', async (ctx) => {
  const userId = ctx.chatJoinRequest.from.id.toString();
  const channelId = ctx.chatJoinRequest.chat.id.toString();
  const channelTitle = ctx.chatJoinRequest.chat.title || 'VIP';

  console.log(`[Join Request] User ${userId} requested to join channel ${channelId} (${channelTitle})`);

  try {
    // Check if user has an active subscription for this channel
    const activeSub = await prisma.subscription.findFirst({
      where: {
        userId,
        channelId,
        status: 'ACTIVE'
      }
    });

    if (activeSub) {
      await bot.telegram.approveChatJoinRequest(channelId, ctx.chatJoinRequest.from.id);
      console.log(`[Join Request] Approved user ${userId} for channel ${channelId}`);
      
      await bot.telegram.sendMessage(
        userId,
        `🎉 Sizning "${channelTitle}" kanaliga kirish so'rovingiz tasdiqlandi! Havolani bosib kirishingiz mumkin.`
      ).catch(() => {});
    } else {
      await bot.telegram.declineChatJoinRequest(channelId, ctx.chatJoinRequest.from.id);
      console.log(`[Join Request] Declined user ${userId} for channel ${channelId} (No active subscription)`);
      
      await bot.telegram.sendMessage(
        userId,
        `⚠️ Kechirasiz, sizda "${channelTitle}" kanaliga faol obuna mavjud emas. Obuna bo'lish uchun botdagi /start tugmasini bosib to'lov qiling.`
      ).catch(() => {});
    }
  } catch (err) {
    console.error(`[Join Request] Error processing request for user ${userId} in ${channelId}:`, err);
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

// Helper to get tomorrow's start and end dates in Tashkent timezone converted to UTC
function getTashkentTomorrowRange() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value);
  const day = parseInt(parts.find(p => p.type === 'day')!.value);

  // Tashkent today at 00:00:00
  const todayTashkentStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:00`;
  const todayTashkent = new Date(todayTashkentStr);

  // Tomorrow start in Tashkent
  const tomorrowStart = new Date(todayTashkent.getTime() + 24 * 60 * 60 * 1000);
  // Day after tomorrow start in Tashkent
  const dayAfterTomorrowStart = new Date(todayTashkent.getTime() + 2 * 24 * 60 * 60 * 1000);

  return {
    start: tomorrowStart,
    end: dayAfterTomorrowStart
  };
}

// 2. Warn users 1 day before expiry (3 times a day at 09:00, 15:00, 19:00 Tashkent time)
export function startExpiryWarningCron() {
  cron.schedule('0 9,15,19 * * *', async () => {
    try {
      const { start, end } = getTashkentTomorrowRange();

      const expiringSoon = await prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: {
            gte: start,
            lt: end
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
          console.log(`[Expiry Warning] Sent warning to user ${sub.userId} for channel ${sub.channelId}`);
        } catch (err) {} // user blocked bot
      }
    } catch (err) {
      console.error('[CRON] Expiry warning error:', err);
    }
  }, {
    timezone: "Asia/Tashkent"
  });
}

// 3. Auto-cancel payments older than 15 minutes (every 1 minute)
export function startPaymentTimeoutCron() {
  setInterval(async () => {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      const expiredPayments = await prisma.payment.findMany({
        where: {
          status: 'PENDING',
          createdAt: { lt: fifteenMinutesAgo }
        }
      });

      if (expiredPayments.length > 0) {
        await prisma.payment.updateMany({
          where: {
            status: 'PENDING',
            createdAt: { lt: fifteenMinutesAgo }
          },
          data: { status: 'CANCELLED' }
        });

        // Notify users
        for (const pay of expiredPayments) {
          try {
            await bot.telegram.sendMessage(
              pay.userId,
              `⏰ To'lov muddati tugadi (15 daqiqa). To'lov bekor qilindi.\n\nQaytadan urinish uchun /start buyrug'ini yuboring.`
            );
          } catch (err) {} // user blocked bot
        }

        console.log(`[CRON] ${expiredPayments.length} ta to'lov 15 daqiqadan oshgani uchun bekor qilindi.`);
      }
    } catch (err) {
      console.error('[CRON] Payment timeout error:', err);
    }
  }, 60 * 1000); // Every 1 minute
}

// ============ ADMIN NOTIFICATION HELPER ============

export async function notifyAdminNewPayment(payment: any, user: any, plan: any) {
  const adminIds = getAdminIds();
  if (adminIds.length === 0) return;

  const text = 
    `💰 **Yangi to'lov!**\n\n` +
    `👤 Ism: ${user.firstName || 'Ismsiz'}\n` +
    `📛 Username: ${user.username ? '@' + user.username : 'yo\'q'}\n` +
    `💵 Summa: ${payment.amount.toLocaleString()} UZS\n` +
    `📦 Tarif: ${plan.name}\n` +
    `🆔 To'lov ID: #${payment.id}`;

  for (const adminId of adminIds) {
    try {
      await bot.telegram.sendMessage(adminId, text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          Markup.button.callback('✅ Tasdiqlash', `confirm_pay:${payment.id}`),
          Markup.button.callback('❌ Bekor qilish', `reject_pay:${payment.id}`)
        ])
      });
    } catch (err) {
      console.error(`Admin notification error for ${adminId}:`, err);
    }
  }
}

// 4. Auto-update Ruble exchange rate (every 25 minutes)
export function startRubRateCron() {
  cron.schedule('*/25 * * * *', async () => {
    try {
      // Use CBR daily XML API or a free JSON API for UZS to RUB rate
      // 1 RUB = ? UZS
      const response = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
      if (response.ok) {
        const data = await response.json();
        const uzsData = data.Valute.UZS; // 10000 UZS = Value RUB
        if (uzsData) {
          // Calculate 1 RUB = X UZS
          // Value is RUB per Nominal UZS (e.g., 10000 UZS = 80.5 RUB)
          // So 1 RUB = Nominal / Value UZS (e.g. 10000 / 80.5 = 124.2 UZS)
          const uzsPerRub = uzsData.Nominal / uzsData.Value;
          
          await prisma.settings.upsert({
            where: { id: 1 },
            update: { rubRate: uzsPerRub },
            create: { id: 1, rubRate: uzsPerRub }
          });
          
          console.log(`[CRON] Ruble rate updated: 1 RUB = ${uzsPerRub.toFixed(2)} UZS`);
        }
      }
    } catch (err) {
      console.error('[CRON] Ruble rate update error:', err);
    }
  });
}
