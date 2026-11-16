// Appens tekster på dansk. Samme nøgler som en.ts (TypeScript tjekker det).
// Tekster med tal: «.one» og «.other», {count} er antallet.

export const da = {
  // Menu og fælles
  "nav.home": "PREAURA",
  "nav.products": "Produkter",
  "nav.queue": "Ordrebehandling",
  "nav.releases": "Annulleringer",
  "nav.waitlist": "Venteliste",
  "nav.events": "Hændelser",
  "nav.settings": "Indstillinger",
  "nav.subscription": "Abonnement",
  "common.unknownProduct": "Ukendt produkt",
  "common.unknownAction": "Ukendt handling.",
  "common.of": "{done} af {total}",
  "common.units": "{count} stk.",
  "common.none": "Ingen",

  // Abonnement mangler / kan ikke tjekkes
  "billing.errorHeading": "Abonnementet kunne ikke tjekkes",
  "billing.errorGeneric": "Abonnementet kunne ikke tjekkes. Prøv igen om lidt.",
  "subscriptionRequired.heading": "Vælg abonnement",
  "subscriptionRequired.text":
    "PREAURA kræver et aktivt abonnement. Du sendes nu videre til Shopifys side, hvor du vælger det. Dine leverancer og forudbestillinger er gemt og venter, til abonnementet er aktivt.",
  "subscriptionRequired.button": "Gå til abonnementet",

  // Temaets blok mangler
  "themeBlock.headingPreorderOn":
    "Dine kunder kan ikke se forudbestillingen endnu",
  "themeBlock.headingPreorderOff": "PREAURA-blokken mangler i dit tema",
  "themeBlock.consequence":
    "Forudbestillinger bliver ikke vist for kunderne, før PREAURA-blokken er slået til på produktsiden i dit tema. Uden den ser kunderne hverken leveringsdatoen eller vilkårene, og datoen kommer ikke med i kurven og på ordren.",
  "themeBlock.howTo":
    "Knappen åbner temaeditoren med blokken klar — tryk Gem. Shopify ser kun dit udgivne tema, så blokken skal ligge i det. Åbner knappen ikke blokken, understøtter dit tema sandsynligvis ikke app-blokke (det kræver et Online Store 2.0-tema). Skriv til os, så hjælper vi.",
  "themeBlock.button": "Tilføj blokken i temaet",
  "themeBlock.reason.noAnswer": "intet svar fra Shopify",
  "themeBlock.reason.noExtension":
    "Shopify Admin tilbyder ikke app.extensions()",

  // Forsiden
  "home.heading": "Forudbestilling",
  "home.selectProducts": "Vælg produkter",
  "home.productsAdded": "Produkter tilføjet",
  "home.unresolved.heading": "Ordrer uden plads i en leverance",
  "home.unresolved.text.one":
    "1 ordre har forudbestilte varer, der ikke er plads til i nogen leverance.",
  "home.unresolved.text.other":
    "{count} ordrer har forudbestilte varer, der ikke er plads til i nogen leverance.",
  "home.seeOrders": "Se ordrerne",
  "home.dataRequests.heading": "En kunde har bedt om sine data",
  "home.dataRequests.text.one":
    "1 dataanmodning venter på svar. Kunden har ret til svar inden for 30 dage.",
  "home.dataRequests.text.other":
    "{count} dataanmodninger venter på svar. Kunden har ret til svar inden for 30 dage.",
  "home.dataRequests.link": "Se anmodningen",
  "home.failed.heading": "Ordrer kunne ikke behandles",
  "home.failed.text.one":
    "1 hændelse fra Shopify fejlede og venter på, at du prøver igen.",
  "home.failed.text.other":
    "{count} hændelser fra Shopify fejlede og venter på, at du prøver igen.",
  "home.failed.link": "Gå til ordrebehandling",
  "home.withoutPlan.heading": "Forudbestillinger købt uden plan",
  "home.withoutPlan.text.one":
    "1 ordre de seneste 7 dage købte en vare på forudbestilling uden at vælge forudbestilling. Appen har talt den med, men det kan betyde, at noget i opsætningen er galt.",
  "home.withoutPlan.text.other":
    "{count} ordrer de seneste 7 dage købte en vare på forudbestilling uden at vælge forudbestilling. Appen har talt dem med, men det kan betyde, at noget i opsætningen er galt.",
  "home.products.heading": "Produkter",
  "home.products.empty":
    "Du har ikke valgt nogen produkter endnu. Vælg de produkter, der skal kunne forudbestilles, når de er udsolgt — fx en vare, du venter en ny forsendelse af. Produkterne bliver solgt almindeligt fra lageret, indtil lageret rammer 0.",
  "home.stats.orders30": "Forudbestillinger (30 dage)",
  "home.stats.units30": "Forudbestilte stk. (30 dage)",
  "home.stats.waiting": "Venter på varer",
  "home.stats.ready": "{count} stk. klar til afsendelse",
  "home.stats.next": "Næste leverance",
  "home.deliveries.heading": "Leverancer",
  "home.deliveries.empty":
    "Ingen leverancer endnu. En leverance er en forsendelse af varer, du venter hjem: en forventet dato og et antal. Kunderne forudbestiller i den første leverance med ledige pladser og får dens dato lovet. Når den er udsolgt, fortsætter salget i den næste.",
  "home.deliveries.createFirst": "Opret den første leverance",
  "home.col.product": "Produkt",
  "home.col.date": "Dato",
  "home.col.sold": "Solgt",
  "home.col.status": "Status",
  "home.col.variantsOn": "Varianter med forudbestilling",
  "home.state.active": "Aktiv",
  "home.state.soldOut": "Udsolgt",
  "home.state.upcoming": "Kommende",
  "home.productGone": "Produktet findes ikke længere",
  "home.badge.off": "Slået fra",
  "home.badge.onlyPreorder": "Kun forudbestilling",
  "home.badge.mixed": "Blandet",
  "home.badge.stock": "Lagermode",
  "home.help.heading": "Brug for hjælp?",
  "home.help.text":
    "Vi svarer på hverdage, som regel samme dag. Skriv gerne butikkens navn og, hvis det handler om en ordre, ordrenummeret.",
  "home.help.writeTo": "Skriv til",

  // Opsætningsguiden
  "guide.headingDone": "PREAURA er sat op",
  "guide.heading": "Kom i gang med PREAURA",
  "guide.progress": "{done} af {total} trin gjort",
  "guide.progressDone": " — dine kunder kan nu forudbestille.",
  "guide.show": "Vis trin",
  "guide.hide": "Skjul",
  "guide.openProduct": "Åbn produktet",
  "guide.addBlock": "Tilføj blokken",
  "guide.confirmBlock": "Jeg har tilføjet blokken",
  "guide.enableCart": "Slå til i kurven",
  "guide.confirmCart": "Jeg har slået den til",
  "guide.products.title": "Vælg de produkter, der skal kunne forudbestilles",
  "guide.products.text":
    "Fx en vare, du venter en ny forsendelse af. Produkterne sælges som normalt fra lageret, indtil det er tomt.",
  "guide.delivery.title": "Opret den første leverance",
  "guide.delivery.text":
    "Åbn produktet, og skriv hvornår du forventer at sende varerne, og hvor mange du vil sælge på forudbestilling. Datoen er den, kunderne får lovet.",
  "guide.enable.title": "Slå forudbestilling til",
  "guide.enable.text":
    "Slå «Forudbestilling, når lageret er tomt» til på varianten. Appen skifter selv til forudbestilling, når lageret rammer 0. Har varen stadig lager, ser kunderne ingen forudbestilling endnu — vil du se den med det samme, så slå «Tving forudbestilling» til på produktet.",
  "guide.block.title": "Vis forudbestillingen på produktsiden",
  "guide.block.text":
    "Tilføj PREAURA-blokken i dit tema. Knappen åbner temaeditoren med blokken klar — du skal kun trykke Gem.",
  "guide.block.unknown":
    "Shopify kan ikke fortælle os, om blokken er tilføjet{reason}. Har du tilføjet den og trykket Gem, så markér trinnet som gjort.",
  "guide.cart.title": "Vis i kurven, at der intet betales i dag",
  "guide.cart.text":
    "Slå «PREAURA kurv» til under App-integrationer. Så står der under hver forudbestilt vare i kurven, at der intet betales i dag, og over knappen til kassen, hvad der trækkes ved afsendelse. Knappen åbner temaeditoren med den slået til — du skal kun trykke Gem.",
  "guide.cart.unknown":
    "Shopify kan ikke fortælle os, om den er slået til{reason}. Har du slået den til og trykket Gem, så markér trinnet som gjort.",

  // Abonnement
  "subscription.heading": "Abonnement",
  "subscription.off":
    "Abonnementet er ikke slået til endnu. Alle funktioner er tilgængelige.",
  "subscription.none":
    "Butikken har intet aktivt abonnement, så PREAURA er lukket. Dine leverancer og forudbestillinger er gemt og venter på dig.",
  "subscription.start": "Start abonnement",
  "subscription.badge.trial": "Prøveperiode",
  "subscription.badge.active": "Aktiv",
  "subscription.lastDay": "Sidste dag af prøveperioden",
  "subscription.daysLeft": "{count} dage tilbage af prøveperioden",
  "subscription.endsOn": " (slutter {date}).",
  "subscription.cancelled":
    "Abonnementet er opsagt og stopper ved udgangen af den nuværende periode. Dine leverancer og forudbestillinger slettes ikke.",
  "subscription.about":
    "Abonnementet giver adgang til alle PREAURAs funktioner. Det styres hos Shopify, og betalingen kører over butikkens Shopify-faktura.",
  "subscription.seeAtShopify": "Se abonnementet hos Shopify",
  "subscription.ifStops.heading": "Hvis abonnementet stopper",
  "subscription.ifStops.text":
    "Udløber prøveperioden uden abonnement, eller opsiger du, lukkes appens funktioner. Leverancer, forudbestillinger og ordrer slettes aldrig. Starter du abonnementet igen, er alt, som det var.",
  // Produktsiden
  "product.notFound": "Produktet findes ikke.",
  "product.notInApp": "Produktet findes ikke i appen.",
  "product.goneInShopify": "Produktet findes ikke længere i Shopify",
  "product.variantGone": "Varianten findes ikke længere i Shopify",
  "product.variantNotInApp": "Varianten findes ikke i appen.",
  "product.syncFailedSuffix": "{message}, men Shopify kunne ikke opdateres",
  "product.toast.enabled": "Forudbestilling slået til",
  "product.toast.disabled": "Forudbestilling slået fra",
  "product.toast.created": "Leverance oprettet",
  "product.toast.saved": "Leverance gemt",
  "product.toast.deleted": "Leverance slettet",
  "product.toast.cancelled": "Leverance annulleret",
  "product.toast.forced": "Forudbestilling tvunget",
  "product.toast.unforced": "Tvang slået fra",
  "product.toast.synced": "Synkroniseret med Shopify",
  "product.limits.heading": "Før du sælger på forudbestilling",
  "product.limits.intro":
    "Kunden betaler først, når du sender varen. Shopify gemmer kortet ved bestilling og trækker beløbet ved afsendelse. Det virker kun sammen med visse betalingsløsninger og funktioner:",
  "product.limits.gateways":
    "Kun disse betalingsløsninger understøtter det: Shopify Payments, PayPal Express, Adyen og Stripe (kun for nogle butikker). Bruger du en anden, kan kunderne ikke gennemføre en forudbestilling.",
  "product.limits.localMethods":
    "Lokale betalingsmetoder (fx MobilePay og bankoverførsel) kan ikke bruges til forudbestillinger.",
  "product.limits.channels":
    "Forudbestillinger kan ikke sælges i Shopify POS, på kladdeordrer eller til B2B-kunder.",
  "product.limits.discounts":
    "Rabatter af typen «Køb X, få Y» virker ikke på forudbestilte varer.",
  "product.limits.permalinks":
    "Links direkte til kurven (cart permalinks) og en checkout, der er tilpasset med checkout.liquid, understøtter ikke forudbestilling.",
  "product.limits.declined":
    "Er kortet udløbet eller uden dækning, når du sender, står ordren som ubetalt. Se «Annulleringer» for afviste betalinger.",
  "product.modeAll.heading": "Kun forudbestilling",
  "product.modeAll.text":
    "Alle varianter er på forudbestilling. Shopify tillader derfor kun køb som forudbestilling: valget «Engangskøb» vises ikke på produktsiden.",
  "product.modeAll.notSynced":
    "Shopify er ikke opdateret endnu. Tryk «Synkronisér» på en af varianterne.",
  "product.modeMixed.heading": "Blandet: nogle varianter sælges almindeligt",
  "product.modeMixed.text1":
    "Kun nogle varianter er på forudbestilling. Shopify kan kun kræve forudbestilling for hele produktet, og det ville spærre de almindelige varianter — så det bliver ikke slået til.",
  "product.modeMixed.text2":
    "I stedet sørger PREAURA-blokken på produktsiden for, at varianterne på forudbestilling købes som forudbestilling. Køber nogen alligevel uden (fx via en kladdeordre eller POS), tæller appen salget med i den aktive leverance og viser det under Ordrebehandling.",
  "product.deliveries": "Leverancer",
  "product.toggle.label": "Forudbestilling, når lageret er tomt",
  "product.toggle.details":
    "Appen skifter selv: lagermode, når der er varer på hylden, og forudbestilling, når lageret rammer 0, og der er plads i en leverance.",
  "product.noActive":
    "Forudbestilling er slået til, men der er ingen leverance med ledige pladser. Opret en leverance nedenfor.",
  "product.noDeliveries":
    "Ingen leverancer endnu. En leverance er en forsendelse, du venter hjem: hvornår du forventer at sende varerne, og hvor mange du vil sælge på forudbestilling. Kunderne forudbestiller i den første leverance med ledige pladser og får dens dato lovet. Opret den første nedenfor.",
  "product.editDelivery": "Ret leverance {position}",
  "product.newDelivery": "Ny leverance",
  "product.save": "Gem",
  "product.addDelivery": "Tilføj leverance",
  "product.mode.now": "Tilstand nu:",
  "product.mode.stock": "Lagermode",
  "product.mode.forced": "Forudbestilling (tvunget)",
  "product.mode.auto": "Forudbestilling (automatisk)",
  "product.mode.stockText":
    "Der er varer på lager. Varianten sælges som enhver anden vare, og appen rører hverken lageret eller produktsiden.",
  "product.mode.forcedText":
    "Varianten er tvunget i forudbestilling af dig, selvom der kan være varer på lager. Appen styrer lageret, indtil du slår tvangen fra.",
  "product.mode.autoText":
    "Lageret er tomt. Kunderne kan forudbestille, og appen styrer lageret ud fra leverancerne. Lægger du varer på lager (som en tilføjelse, fx +20), skifter varianten selv tilbage — efter at forudbestillingerne er dækket.",
  "product.mode.lastChanged": "Sidst skiftet {date}: {reason}",
  "product.mode.neverChanged": "Har ikke skiftet tilstand endnu.",
  "product.force.label": "Tving forudbestilling",
  "product.force.details":
    "Bruges, når de sidste stk. på lager er beskadigede eller reserverede. Slås tvangen fra, sættes lageret tilbage til det, det var.",
  "product.sync.errorHeading": "Shopify er ikke opdateret",
  "product.sync.lastAttempt": "Seneste forsøg: {date}",
  "product.sync.retry": "Prøv igen",
  "product.sync.active": "Aktiv leverance",
  "product.sync.activeValue": "Nr. {position} · {date}",
  "product.sync.stock": "Lager i Shopify nu",
  "product.sync.unknown": "Ukendt",
  "product.sync.last": "Sidst synkroniseret",
  "product.sync.never": "Aldrig",
  "product.sync.button": "Synkronisér",
  "product.state.ACTIVE": "Aktiv",
  "product.state.UPCOMING": "Kommende",
  "product.state.SOLD_OUT": "Udsolgt",
  "product.state.CANCELLED": "Annulleret",
  "product.col.position": "Nr.",
  "product.col.date": "Dato",
  "product.col.quantity": "Antal",
  "product.col.allocated": "Tildelt",
  "product.col.remaining": "Resterende",
  "product.col.status": "Status",
  "product.col.actions": "Handlinger",
  "product.action.orders": "Ordrer",
  "product.action.edit": "Ret",
  "product.action.cancel": "Annullér",
  "product.action.delete": "Slet",
  "product.seeDeliveryOrders": "Se leverancens ordrer",
  "product.cancelModal.heading": "Annullér leverance {position}?",
  "product.cancelModal.text":
    "Leverancen den {date} markeres som annulleret. Det kan ikke fortrydes.",
  "product.cancelModal.allocated.one":
    "1 ordrelinje er tildelt leverancen. Tildelingerne bliver stående, så du bagefter kan se, hvilke ordrer der er berørt.",
  "product.cancelModal.allocated.other":
    "{count} ordrelinjer er tildelt leverancen. Tildelingerne bliver stående, så du bagefter kan se, hvilke ordrer der er berørt.",
  "product.cancelModal.none": "Ingen ordrer er tildelt leverancen.",
  "product.cancelModal.confirm": "Annullér leverance",
  "product.cancelModal.keep": "Behold",
  "product.affected": "Berørte ordrer",
  "product.order": "Ordre {number}",
  "product.form.date": "Dato",
  "product.form.quantity": "Antal",
  "product.form.alreadyAllocated": "{count} stk. er allerede tildelt.",
  "product.form.undo": "Fortryd",

  // Leverancens ordrer
  "delivery.notFound": "Leverancen findes ikke.",
  "delivery.heading": "Leverance {position} · {date}",
  "delivery.readyNone": "Alle forudbestillinger var allerede klar",
  "delivery.ready.one": "1 forudbestilling markeret klar til afsendelse",
  "delivery.ready.other":
    "{count} forudbestillinger markeret klar til afsendelse",
  "delivery.arrived": "Varerne er kommet — klar til afsendelse",
  "delivery.activeLines": "Aktive ordrelinjer",
  "delivery.orders": "Ordrer",
  "delivery.noOrders": "Ingen ordrer i denne leverance endnu.",
  "delivery.col.order": "Ordre",
  "delivery.col.ordered": "Bestilt",
  "delivery.col.promised": "Lovet dato",
  "delivery.status.ACTIVE": "Aktiv",
  "delivery.status.CANCELLED": "Annulleret",
  "delivery.readyBadge": "Klar til afsendelse",

  // Fejl i en leverance
  "validation.dateMissing":
    "Vælg den dato, du forventer at sende varerne. Det er den dato, kunderne får lovet.",
  "validation.dateInvalid":
    "Datoen kan ikke læses. Vælg den i kalenderen, eller skriv den som ÅÅÅÅ-MM-DD, fx 2027-01-15.",
  "validation.dateNotFuture":
    "Datoen er i dag eller er passeret. Vælg en dato fra i morgen og frem — det er den dato, kunderne får lovet.",
  "validation.quantityInvalid":
    "Skriv antallet som et helt tal, fx 50 — uden komma, mellemrum eller «stk.».",
  "validation.quantityNotPositive":
    "Antallet skal være mindst 1: det er, hvor mange du kan sælge på forudbestilling i leverancen. Vil du stoppe salget, så annullér leverancen i stedet.",
  "validation.quantityBelowAllocated":
    "{allocated} stk. er allerede solgt i leverancen, så antallet skal være mindst {allocated}. Vil du sælge færre, må du annullere ordrer i Shopify først.",
  "validation.dateOverlaps":
    "Leverance {position} har allerede datoen {date}. Ret antallet på leverance {position} i stedet, eller vælg en anden dato.",
  "validation.dateBeforeExisting":
    "Nye leverancer sælges efter de eksisterende, så datoen skal ligge efter {date} (leverance {position}). Kommer der varer før, så ret datoen på leverance {position} i stedet.",
};

export type MessageKey = keyof typeof da;
