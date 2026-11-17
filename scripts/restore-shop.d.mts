import type { PrismaClient } from "@prisma/client";

export const RESTORED_TABLES: string[];

export function restoreShop(input: {
  source: PrismaClient;
  target: PrismaClient;
  shop: string;
  since: Date;
  apply?: boolean;
}): Promise<{
  applied: boolean;
  rows: Record<string, number>;
  orderEvents: number;
  redactEvents: number;
}>;
