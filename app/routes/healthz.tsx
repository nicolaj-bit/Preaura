import db from "../db.server";

// Render spørger her, om appen kører. Svarer 200, når databasen kan nås.
export const loader = async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return new Response("ok", { status: 200 });
  } catch {
    return new Response("Databasen kan ikke nås", { status: 503 });
  }
};
