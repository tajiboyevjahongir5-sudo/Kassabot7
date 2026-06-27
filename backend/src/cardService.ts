import { prisma } from './prisma';

export async function incrementCardTransfer() {
  try {
    const activeCard = await prisma.card.findFirst({ where: { isActive: true } });
    if (!activeCard) return;

    const updatedCard = await prisma.card.update({
      where: { id: activeCard.id },
      data: { transferCount: { increment: 1 } }
    });

    if (updatedCard.transferCount >= updatedCard.maxTransfers) {
      // Rotate card
      const allCards = await prisma.card.findMany({ orderBy: { slot: 'asc' } });
      if (allCards.length === 0) return;

      let nextCard = allCards.find(c => c.slot > updatedCard.slot);
      if (!nextCard) {
        nextCard = allCards[0]; // loop back to first
      }

      await prisma.$transaction([
        prisma.card.updateMany({ data: { isActive: false } }),
        prisma.card.update({ where: { id: nextCard.id }, data: { isActive: true, transferCount: 0 } })
      ]);
      console.log(`[Card Rotation] Rotated from slot ${updatedCard.slot} to slot ${nextCard.slot}`);
    }
  } catch (error) {
    console.error("[Card Rotation Error]", error);
  }
}
