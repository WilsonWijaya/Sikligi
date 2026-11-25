import "dotenv/config";
import { prisma } from "../lib/db";
import { parseTicketImage, privatizeTicketImage } from "../lib/cloudinary";

async function main() {
  const tickets = await prisma.ticket.findMany({ select: { id: true, number: true, imageUrls: true }, orderBy: { number: "asc" } });
  let changed = 0;
  let failed = 0;
  for (const ticket of tickets) {
    if (!ticket.imageUrls.some((url) => parseTicketImage(url)?.type !== "authenticated")) continue;
    const imageUrls: string[] = [];
    for (const url of ticket.imageUrls) {
      try {
        const next = await privatizeTicketImage(url);
        if (next !== url) changed += 1;
        imageUrls.push(next);
      } catch (error) {
        failed += 1;
        imageUrls.push(url);
        console.error(`Tiket #${ticket.number}: ${error instanceof Error ? error.message : error}`);
      }
    }
    await prisma.ticket.update({ where: { id: ticket.id }, data: { imageUrls } });
  }
  console.log(`Gambar dijadikan privat: ${changed}. Gagal: ${failed}. Tiket diperiksa: ${tickets.length}.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
