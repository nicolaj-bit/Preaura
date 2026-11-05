-- «Klar til afsendelse» sættes ikke længere ud fra en vilkårlig stigning i
-- lageret, så restbeholdningen af modtagne varer (readyCredit) er overflødig.
ALTER TABLE "VariantPlan" DROP COLUMN "readyCredit";

-- Engangsoprydning: i testbutikken blev tre forudbestillinger fejlagtigt
-- markeret klar efter en stigning i lageret, der ikke var varer. Da appen
-- kun kører på testbutikken, nulstilles alle markeringer og de tilhørende
-- «klar»-hændelser (leveringerne slettes med), så hændelsen kan sendes
-- igen, når varerne faktisk kommer.
UPDATE "Allocation" SET "readyAt" = NULL WHERE "readyAt" IS NOT NULL;

DELETE FROM "OutboxEvent" WHERE "type" = 'preorder.ready';
