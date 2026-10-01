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
        if ((ch as any).type === 'BOT') {
          // It's a Bot -> Check BotSubscriber table instead of telegram API
          const isSubbed = await prisma.botSubscriber.findFirst({
            where: { userId: String(userId), logChannelId: ch.channelId }
          });
          if (!isSubbed) missing.push(ch);
        } else {
          // Standard Channel/Group -> Check Telegram API
          const member = await bot.telegram.getChatMember(ch.channelId, userId);
          if (!['member', 'administrator', 'creator'].includes(member.status)) {
            missing.push(ch);
          }
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

  function getFreshWebAppUrl(base: string, params: string = ''): string {
    const sep = base.includes('?') ? '&' : '?';
    const vTag = `_t=${Date.now()}`;
    return params ? `${base}${sep}${params}&${vTag}` : `${base}${sep}${vTag}`;
  }

  const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
  const payload = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ')[1] : '';
  const isVideochat = payload === 'videochat';

  if (isVideochat) {
    await ctx.reply(
      `🔴 <b>VIP VIDEOCHAT JONLI EFIR</b>\n\nJonli efirga kirish uchun pastdagi tugmani bosing!`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔴 VIDEOCHATGA KIRISH', web_app: { url: getFreshWebAppUrl(webAppUrl, 'tab=videochat') } }],
            [{ text: '💎 VIP Obuna sotib olish', web_app: { url: getFreshWebAppUrl(webAppUrl) } }]
          ]
        }
      }
    );
  } else {
    // Send welcome with inline buttons only (no persistent keyboard)
    await ctx.reply(
      `👋 *Diora Vip kanaliga xush kelibsiz!*\n\nObuna sotib olish yoki VIDEOCHAT (jonli efir)ga kirish uchun quyidagi tugmalardan foydalaning:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎥 VIDEOCHAT (JONLI EFIR)', web_app: { url: getFreshWebAppUrl(webAppUrl, 'tab=videochat') } }],
            [{ text: '💎 VIP Obuna bo\'lish', web_app: { url: getFreshWebAppUrl(webAppUrl) } }]
          ],
          remove_keyboard: true
        } as any
      }
    );
  }
});

bot.command('videochat', async (ctx) => {
  const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
  const vTag = `_t=${Date.now()}`;
  const sep = webAppUrl.includes('?') ? '&' : '?';
  await ctx.reply(
    `🔴 <b>VIP VIDEOCHAT JONLI EFIR</b>\n\nJonli efirga kirish uchun pastdagi tugmani bosing:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔴 VIDEOCHATGA KIRISH', web_app: { url: `${webAppUrl}${sep}tab=videochat&${vTag}` } }]
        ]
      }
    }
  );
});

bot.hears(['🎥 VIDEOCHAT', '🎥 VIDEOCHAT (JONLI EFIR)', 'VIDEOCHAT', 'Videochat'], async (ctx) => {
  const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
  const vTag = `_t=${Date.now()}`;
  const sep = webAppUrl.includes('?') ? '&' : '?';
  await ctx.reply(
    `🔴 <b>VIP VIDEOCHAT JONLI EFIR</b>\n\nJonli efirga kirish uchun pastdagi tugmani bosing:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔴 VIDEOCHATGA KIRISH', web_app: { url: `${webAppUrl}${sep}tab=videochat&${vTag}` } }]
        ]
      }
    }
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

// ============ ADMIN STATE TRACKING ============
const adminStates = new Map<string, string>();

// /setjoinmsg — Admin sets the join request welcome message (text/photo/video)
bot.command('setjoinmsg', async (ctx) => {
  if (!isAdmin(ctx.from.id.toString())) return;

  adminStates.set(ctx.from.id.toString(), 'waiting_join_msg');
  await ctx.reply(
    '📩 <b>Zayavka xabarini o\'rnatish</b>\n\nQuyidagilardan birini yuboring:\n• Matnli xabar\n• Rasm (caption bilan)\n• Video (caption bilan)\n\n❌ Bekor qilish uchun /cancel yozing.',
    { parse_mode: 'HTML' }
  );
});

bot.command('cancel', async (ctx) => {
  if (adminStates.has(ctx.from.id.toString())) {
    adminStates.delete(ctx.from.id.toString());
    await ctx.reply('❌ Bekor qilindi.');
  }
});

// Capture admin's join request message (photo/video/text)
bot.use(async (ctx, next) => {
  if (!ctx.from || !ctx.message) return next();
  const state = adminStates.get(ctx.from.id.toString());
  if (state !== 'waiting_join_msg') return next();

  adminStates.delete(ctx.from.id.toString());

  try {
    const msg = ctx.message as any;
    let mediaType: string | null = null;
    let mediaFileId: string | null = null;
    let caption: string | null = null;

    if (msg.photo) {
      mediaType = 'photo';
      mediaFileId = msg.photo[msg.photo.length - 1].file_id;
      caption = msg.caption || null;
    } else if (msg.video) {
      mediaType = 'video';
      mediaFileId = msg.video.file_id;
      caption = msg.caption || null;
    } else if (msg.animation) {
      mediaType = 'animation';
      mediaFileId = msg.animation.file_id;
      caption = msg.caption || null;
    } else if (msg.text) {
      caption = msg.text;
    } else {
      await ctx.reply('❌ Bu turdagi xabar qo\'llab-quvvatlanmaydi. Matn, rasm yoki video yuboring.');
      return;
    }

    await prisma.settings.upsert({
      where: { id: 1 },
      update: {
        joinRequestMessage: caption,
        joinRequestMediaType: mediaType,
        joinRequestMediaFileId: mediaFileId
      },
      create: {
        id: 1,
        joinRequestMessage: caption,
        joinRequestMediaType: mediaType,
        joinRequestMediaFileId: mediaFileId
      }
    });

    await ctx.reply(
      '✅ <b>Zayavka xabari saqlandi!</b>\n\nEndi maxfiy kanalga qo\'shilish so\'rovi yuborilganda, bot ushbu xabarni avtomatik yuboradi.',
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('setjoinmsg error:', err);
    await ctx.reply('❌ Xatolik yuz berdi.');
  }
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
  const text = (ctx.channelPost as any).text || (ctx.channelPost as any).caption || "";

  // 1. Check if this is a Log Channel for a mandatory Bot
  try {
    const isLogChannel = await prisma.mandatoryChannel.findFirst({ where: { channelId, type: 'BOT' } });
    if (isLogChannel) {
      let extractedUserId: string | null = null;
      const cp = ctx.channelPost as any;
      
      // Check forward
      if (cp.forward_from && cp.forward_from.id) {
        extractedUserId = cp.forward_from.id.toString();
      }
      // Check entities (text_mention)
      else if (cp.entities) {
        for (const ent of cp.entities) {
          if (ent.type === 'text_mention' && ent.user) {
            extractedUserId = ent.user.id.toString();
            break;
          }
        }
      }
      // Check regex for ID: 1234567
      if (!extractedUserId && text) {
        const match = text.match(/id:?\s*(\d{5,15})/i);
        if (match) extractedUserId = match[1];
      }

      if (extractedUserId) {
        await prisma.botSubscriber.upsert({
          where: { userId_logChannelId: { userId: extractedUserId, logChannelId: channelId } },
          update: {},
          create: { userId: extractedUserId, logChannelId: channelId }
        });
        console.log(`[BOT SUBSCRIBER] Saved user ${extractedUserId} for log channel ${channelId}`);
      }
    }
  } catch (err) {
    console.error("Bot log channel parsing error:", err);
  }

  // 2. Check if this is the Payment Verification channel
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings || settings.paymentChannelId !== channelId) {
    return;
  }

  if (!text) return;

  const pendingPayments = await prisma.payment.findMany({ 
    where: { status: 'PENDING' },
    include: { plan: true, user: true }
  });

  const pendingDonations = await (prisma as any).liveDonation.findMany({
    where: { status: 'PENDING' }
  });

  const extractedNumbers = extractNumbers(text);
  const exactMatches: any[] = [];
  const exactDonationMatches: any[] = [];

  // Check matching payments and donations
  for (const num of extractedNumbers) {
    for (const payment of pendingPayments) {
      if (payment.amount === num) {
        exactMatches.push(payment);
      }
    }
    for (const donation of pendingDonations) {
      if (donation.amount === num) {
        exactDonationMatches.push(donation);
      }
    }
  }

  // Auto-confirm matched live donations!
  if (exactDonationMatches.length > 0) {
    const { triggerDonationDisplay } = await import('./api.js');
    for (const donation of exactDonationMatches) {
      try {
        const paidAt = new Date();
        const displayAt = new Date(Date.now() + 30000);

        await (prisma as any).liveDonation.update({
          where: { id: donation.id },
          data: { status: 'PAID', paidAt, displayAt }
        });

        await incrementCardTransfer();

        // Schedule 30-second broadcast to live stream
        setTimeout(() => {
          triggerDonationDisplay(donation.id);
        }, 30000);

        // Notify user via Telegram bot
        if (donation.userId) {
          ctx.telegram.sendMessage(
            donation.userId,
            `🎉 <b>Donat to'lovingiz muvaffaqiyatli qabul qilindi!</b>\n\n` +
            `🎁 Sovg'a: ${donation.giftIcon} ${donation.giftName}\n` +
            `💰 Summa: ${donation.amount.toLocaleString()} so'm\n\n` +
            `⏳ Donatingiz 30 sekunddan keyin jonli efirda chiqadi va ovoz bilan o'qib beriladi!`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }

        console.log(`[DONATION] Auto-confirmed donation #${donation.id} for ${donation.amount} UZS`);
      } catch (dErr) {
        console.error('Auto-confirm donation error:', dErr);
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
  } else {
    // No exact match. Identify the likely payment amount from the bank SMS (the number closest to any pending payment)
    let bestMatch: { payment: any; foundAmount: number; diff: number } | null = null;

    for (const num of extractedNumbers) {
      for (const payment of pendingPayments) {
        const diff = Math.abs(payment.amount - num);
        // We look for a number that is somewhat close to avoid picking bank balances (e.g. diff <= 50000)
        if (diff <= 50000 && (!bestMatch || diff < bestMatch.diff)) {
          bestMatch = { payment, foundAmount: num, diff };
        }
      }
    }

    if (bestMatch) {
      const adminIds = getAdminIds();
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentPendingPayments = pendingPayments.filter(p => new Date(p.createdAt) >= fiveMinutesAgo);

      if (recentPendingPayments.length > 0) {
        // Notify admin
        for (const aid of adminIds) {
          await bot.telegram.sendMessage(
            aid,
            `⚠️ Noto'g'ri summa keldi!\n\nKelgan summa: ${bestMatch.foundAmount} so'm\n\nOxirgi 5 daqiqa ichida to'lov qilmoqchi bo'lgan ${recentPendingPayments.length} ta mijozga chek so'rab xabar yuborildi.`
          ).catch(e => console.error("Admin notification error:", e));
        }

        // Notify all recent pending users
        for (const payment of recentPendingPayments) {
          try {
            await bot.telegram.sendMessage(
              payment.userId,
              `⚠️ Bizga ${bestMatch.foundAmount} so'm kelib tushdi, lekin sizning to'lovingiz ${payment.amount} so'm bo'lishi kerak edi.\n\nAgar bu to'lovni siz amalga oshirgan bo'lsangiz, iltimos to'lov chekini (skrinshotini) shu yerga yuboring.`
            );
          } catch (e) {}
        }
      }
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

      const cbMsg = (ctx.callbackQuery as any)?.message;
      const isPhoto = cbMsg?.caption !== undefined;
      const textVal = isPhoto ? cbMsg.caption : (cbMsg?.text || '');

      try {
        if (isPhoto) {
          await ctx.editMessageCaption(textVal + '\n\n✅ TASDIQLANDI', { reply_markup: undefined });
        } else {
          await ctx.editMessageText(textVal + '\n\n✅ TASDIQLANDI', { reply_markup: undefined });
        }
      } catch (e) {
        await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      }

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

      const cbMsg = (ctx.callbackQuery as any)?.message;
      const isPhoto = cbMsg?.caption !== undefined;
      const textVal = isPhoto ? cbMsg.caption : (cbMsg?.text || '');

      try {
        if (isPhoto) {
          await ctx.editMessageCaption(textVal + '\n\n❌ BEKOR QILINDI', { reply_markup: undefined });
        } else {
          await ctx.editMessageText(textVal + '\n\n❌ BEKOR QILINDI', { reply_markup: undefined });
        }
      } catch (e) {
        await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      }

      await ctx.answerCbQuery('❌ Bekor qilindi');
    } catch (err) {
      console.error("Reject payment error:", err);
      await ctx.answerCbQuery('❌ Xatolik yuz berdi');
    }
  }
});

// ============ PHOTO / RECEIPT HANDLER ============

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id.toString();

  // Find if user has a pending payment
  const pendingPayment = await prisma.payment.findFirst({
    where: { userId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: { user: true, plan: true }
  });

  if (!pendingPayment) {
    return ctx.reply("Sizda kutilayotgan to'lov yo'q yoki to'lov vaqti o'tib ketgan.");
  }

  const adminIds = getAdminIds();
  if (adminIds.length === 0) {
    return ctx.reply("Adminga bog'lanib bo'lmadi.");
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  const usernameVal = pendingPayment.user?.username ? pendingPayment.user.username : 'yo\'q';
  
  const text = `🧾 **Foydalanuvchi chek yubordi!**\n\n` +
    `Foydalanuvchi: @${usernameVal}\n` +
    `Kutilgan summa: ${pendingPayment.amount} so'm\n` +
    `Tarif: ${pendingPayment.plan.name}\n` +
    `To'lov ID: #${pendingPayment.id}\n\n` +
    `Iltimos, chekni tekshirib tasdiqlang yoki rad qiling.`;

  let sent = false;
  for (const aid of adminIds) {
    try {
      await bot.telegram.sendPhoto(aid, photo, {
        caption: text,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          Markup.button.callback('✅ Tasdiqlash', `confirm_pay:${pendingPayment.id}`),
          Markup.button.callback('❌ Rad qilish', `reject_pay:${pendingPayment.id}`)
        ])
      });
      sent = true;
    } catch (e) {
      console.error(`Failed to send receipt to admin ${aid}:`, e);
    }
  }

  if (sent) {
    await ctx.reply("✅ Chek adminga yuborildi! Iltimos, tasdiqlashlarini kuting.");
  } else {
    await ctx.reply("❌ Xatolik: Chekni adminga yuborishning imkoni bo'lmadi.");
  }
});

// ============ CHAT JOIN REQUEST LISTENER ============

bot.on('chat_join_request', async (ctx) => {
  const userId = ctx.chatJoinRequest.from.id.toString();
  const channelId = ctx.chatJoinRequest.chat.id.toString();
  const channelTitle = ctx.chatJoinRequest.chat.title || 'VIP';

  console.log(`[Join Request] User ${userId} requested to join channel ${channelId} (${channelTitle})`);

  try {
    // 1. Check if this is one of our Zayavka channels (from JoinRequestChannel or legacy Settings)
    const [jrChannel, settings] = await Promise.all([
      (prisma as any).joinRequestChannel.findUnique({ where: { channelId } }),
      prisma.settings.findUnique({ where: { id: 1 } })
    ]);

    const isZayavkaChannel = Boolean(
      jrChannel || 
      (settings?.joinRequestChannelId && settings.joinRequestChannelId === channelId)
    );

    if (isZayavkaChannel) {
      const displayTitle = jrChannel?.title || channelTitle;
      // Do NOT approve — just send a message to the user
      console.log(`[Join Request] User ${userId} requested to join ${channelId} (${displayTitle}) — sending message (not approving)`);

      // Save user to DB
      const user = ctx.chatJoinRequest.from;
      await prisma.user.upsert({
        where: { id: userId },
        update: { username: user.username, firstName: user.first_name },
        create: { id: userId, username: user.username, firstName: user.first_name }
      });

      // Save join request to track count and mass-approve later
      await prisma.joinRequest.upsert({
        where: { userId_channelId: { userId, channelId } },
        update: { status: 'PENDING', createdAt: new Date() },
        create: { userId, channelId, status: 'PENDING' }
      });

      // Send custom message (photo/video/text) with inline button
      const botInfo = await bot.telegram.getMe();
      const customMsg = jrChannel?.customMessage || settings?.joinRequestMessage;
      const caption = customMsg
        || `🎉 Salom! "${displayTitle}" kanaliga xush kelibsiz!\n\nBotimiz orqali VIP obuna sotib olishingiz mumkin.`;
      const replyMarkup = {
        inline_keyboard: [[{ text: '📲 KANALGA KIRISH', url: `https://t.me/${botInfo.username}?start=start` }]]
      };

      try {
        if (settings?.joinRequestMediaType === 'photo' && settings?.joinRequestMediaFileId) {
          await bot.telegram.sendPhoto(userId, settings.joinRequestMediaFileId, {
            caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          });
        } else if (settings?.joinRequestMediaType === 'video' && settings?.joinRequestMediaFileId) {
          await bot.telegram.sendVideo(userId, settings.joinRequestMediaFileId, {
            caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          });
        } else if (settings?.joinRequestMediaType === 'animation' && settings?.joinRequestMediaFileId) {
          await bot.telegram.sendAnimation(userId, settings.joinRequestMediaFileId, {
            caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          });
        } else {
          await bot.telegram.sendMessage(userId, caption, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          });
        }
      } catch (e) {}

      return; // Don't process further
    }

    // 2. Standard flow: Check if user has an active subscription for this channel
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



// Global error handler to catch 403 errors and avoid master process crashes
bot.catch((err: any, ctx) => {
  if (err.response?.error_code === 403) {
    console.log(`User ${ctx.from?.id} bloklagan, o'tkazib yuboramiz`);
    return;
  }
  console.error('Bot xatosi:', err);
});

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

// 3. Auto-cancel payments older than 3 minutes (every 60 seconds)
export function startPaymentTimeoutCron() {
  // One-time cleanup on startup: cancel all stale pending payments older than 3 min
  (async () => {
    try {
      const staleDate = new Date(Date.now() - 3 * 60 * 1000);
      const result = await prisma.payment.updateMany({
        where: { status: 'PENDING', createdAt: { lt: staleDate } },
        data: { status: 'CANCELLED' }
      });
      if (result.count > 0) {
        console.log(`[STARTUP] Cleaned up ${result.count} stale pending payments.`);
      }
    } catch (err) {
      console.error('[STARTUP] Stale payment cleanup error:', err);
    }
  })();

  setInterval(async () => {
    try {
      const timeoutDate = new Date(Date.now() - 3 * 60 * 1000); // 3 daqiqa

      const count = await prisma.payment.updateMany({
        where: { status: 'PENDING', createdAt: { lt: timeoutDate } },
        data: { status: 'CANCELLED' }
      });

      if (count.count > 0) {
        console.log(`Auto-cancelled ${count.count} expired payments (older than 3min).`);
      }
    } catch (err) {
      console.error('Error in payment timeout cron:', err);
    }
  }, 60 * 1000); // Check every 60 seconds
}

// 6. Auto database cleanup: purge CANCELLED payments older than 24 hours to keep DB lightweight
export function startDatabaseCleanupCron() {
  const cleanup = async () => {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const deleted = await prisma.payment.deleteMany({
        where: {
          status: 'CANCELLED',
          createdAt: { lt: oneDayAgo }
        }
      });
      if (deleted.count > 0) {
        console.log(`[CLEANUP] Purged ${deleted.count} cancelled payments older than 24h.`);
      }
    } catch (err) {
      console.error('[CLEANUP] Database cleanup error:', err);
    }
  };

  cleanup();
  setInterval(cleanup, 6 * 60 * 60 * 1000); // Every 6 hours
}

// ============ ADMIN NOTIFICATION HELPER ============

export async function notifyAdminNewPayment(payment: any, user: any, plan: any) {
  // Foydalanuvchi xohishiga ko'ra o'chirib qo'yildi - to'lovlar faqat Admin panelda
  // ko'rinadi, Telegram chatga "Yangi to'lov!" xabarlari kelmaydi.
  return;
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

// 5. Daily card transfer count reset (every day at 00:00 Tashkent time)
export function startCardResetCron() {
  cron.schedule('0 0 * * *', async () => {
    try {
      const result = await prisma.card.updateMany({
        data: { transferCount: 0 }
      });
      console.log(`[CRON] Daily card reset: ${result.count} cards reset to 0 transfers`);
    } catch (err) {
      console.error('[CRON] Card reset error:', err);
    }
  }, { timezone: 'Asia/Tashkent' });
}
