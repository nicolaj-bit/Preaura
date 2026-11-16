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
    "Knappen åbner temaeditoren med blokken klar. Tryk Gem. Shopify ser kun dit udgivne tema, så blokken skal ligge i det. Åbner knappen ikke blokken, understøtter dit tema sandsynligvis ikke app-blokke (det kræver et Online Store 2.0-tema). Skriv til os, så hjælper vi.",
  "themeBlock.button": "Tilføj blokken i temaet",

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
    "Du har ikke valgt nogen produkter endnu. Vælg de produkter, der skal kunne forudbestilles, når de er udsolgt, fx en vare, du venter en ny forsendelse af. Produkterne bliver solgt almindeligt fra lageret, indtil lageret rammer 0.",
  "home.overview.heading": "Oversigt",
  "home.overview.intro": "Forudbestillinger fra ordrer i perioden. Beløb i butikkens valuta.",
  "home.period.days": "{count} dage",
  "home.stats.amount": "Forudbestilt for",
  "home.stats.amountNone": "Vises for nye ordrer fra nu af",
  "home.stats.amountPartial": "Ældre ordrer uden beløb er ikke med",
  "home.stats.orders": "Ordrer",
  "home.stats.average": "Gns. ordreværdi",
  "home.stats.units": "Forudbestilte stk.",
  "home.stats.paymentIssues": "Afviste betalinger",
  "home.stats.cancellations": "Annulleringsønsker",
  "home.stats.waitlist": "På ventelisten",
  "home.stats.see": "Se",
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
  "guide.progressDone": ", dine kunder kan nu forudbestille.",
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
    "Slå «Forudbestilling, når lageret er tomt» til på varianten. Appen skifter selv til forudbestilling, når lageret rammer 0. Har varen stadig lager, ser kunderne ingen forudbestilling endnu. Vil du se den med det samme, så slå «Tving forudbestilling» til på produktet.",
  "guide.block.title": "Vis forudbestillingen på produktsiden",
  "guide.block.text":
    "Tilføj PREAURA-blokken i dit tema. Knappen åbner temaeditoren med blokken klar. Du skal kun trykke Gem.",
  "guide.block.unknown":
    "Shopify kan ikke fortælle os, om blokken er tilføjet{reason}. Har du tilføjet den og trykket Gem, så markér trinnet som gjort.",
  "guide.cart.title": "Vis i kurven, at der intet betales i dag",
  "guide.cart.text":
    "Slå «PREAURA kurv» til under App-integrationer. Så står der under hver forudbestilt vare i kurven, at der intet betales i dag, og over knappen til kassen, hvad der trækkes ved afsendelse. Knappen åbner temaeditoren med den slået til. Du skal kun trykke Gem.",
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
    "Kun nogle varianter er på forudbestilling. Shopify kan kun kræve forudbestilling for hele produktet, og det ville spærre de almindelige varianter, så det bliver ikke slået til.",
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
    "Lageret er tomt. Kunderne kan forudbestille, og appen styrer lageret ud fra leverancerne. Lægger du varer på lager (som en tilføjelse, fx +20), skifter varianten selv tilbage, når forudbestillingerne er dækket.",
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
  "delivery.arrived": "Varerne er kommet, klar til afsendelse",
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
    "Datoen er i dag eller er passeret. Vælg en dato fra i morgen og frem. Det er den dato, kunderne får lovet.",
  "validation.quantityInvalid":
    "Skriv antallet som et helt tal, fx 50, uden komma, mellemrum eller «stk.».",
  "validation.quantityNotPositive":
    "Antallet skal være mindst 1: det er, hvor mange du kan sælge på forudbestilling i leverancen. Vil du stoppe salget, så annullér leverancen i stedet.",
  "validation.quantityBelowAllocated":
    "{allocated} stk. er allerede solgt i leverancen, så antallet skal være mindst {allocated}. Vil du sælge færre, må du annullere ordrer i Shopify først.",
  "validation.dateOverlaps":
    "Leverance {position} har allerede datoen {date}. Ret antallet på leverance {position} i stedet, eller vælg en anden dato.",
  "validation.dateBeforeExisting":
    "Nye leverancer sælges efter de eksisterende, så datoen skal ligge efter {date} (leverance {position}). Kommer der varer før, så ret datoen på leverance {position} i stedet.",
  // Indstillinger
  "settings.heading": "Indstillinger",
  "settings.saved": "Indstillinger gemt",
  "settings.error.mode": "Vælg en visning.",
  "settings.error.empty": "Teksten må ikke være tom.",
  "settings.error.tooLong": "Højst {max} tegn.",
  "settings.date.heading": "Dato i webshoppen",
  "settings.date.text": "Hvordan datoen vises på produktsiden, i kurven og i checkout.",
  "settings.language.heading": "Sprog",
  "settings.language.text": "Sproget i appen. Det bestemmer også, hvordan datoer og beløb skrives. Valutaen er altid butikkens.",
  "settings.language.label": "Appens sprog",
  "settings.theme.heading": "Produktside og kurv",
  "settings.theme.text": "PREAURA-blokken viser datoen på produktsiden; kurvens app embed viser, at der intet betales i dag.",
  "settings.theme.block": "Blok på produktsiden",
  "settings.theme.cart": "Kurv (app embed)",
  "settings.theme.editBlock": "Tilpas blokken",
  "settings.theme.editCart": "Tilpas kurven",
  "settings.release.heading": "Annullering og betaling",
  "settings.release.text": "Hvor længe kunden kan annullere, hvem der godkender, og hvor længe en afvist betaling holder enheden.",
  "settings.release.window": "Kunden kan annullere",
  "settings.release.windowFulfilled": "Indtil varen er sendt",
  "settings.release.windowDays": "{count} dage efter bestilling",
  "settings.release.approval": "Godkendelse",
  "settings.release.approvalManual": "Du godkender",
  "settings.release.approvalAuto": "Automatisk inden for {count} dage",
  "settings.release.grace": "Frist ved afvist betaling",
  "settings.release.graceDays": "{count} dage",
  "settings.waitlist.heading": "Venteliste",
  "settings.waitlist.text": "Kunder kan skrive sig op til en udsolgt vare og får én besked, når den kan købes igen.",
  "settings.waitlist.waiting": "Venter på besked",
  "settings.waitlist.pace": "Udsendelse",
  "settings.waitlist.paceValue": "{size} pr. {minutes} min.",
  "settings.integrations.heading": "Integrationer",
  "settings.integrations.text": "Send hændelser om forudbestillinger videre til Shopify Flow, din egen webhook eller Klaviyo.",
  "settings.customize": "Tilpas",
  "settings.see": "Se ventelisten",
  "settings.status.on": "Til",
  "settings.status.off": "Fra",
  "settings.status.active": "Aktiv",
  "settings.status.inactive": "Ikke tilføjet",
  "settings.status.unknown": "Ukendt",
  "language.label": "Sprog",
  "language.auto": "Følg Shopify",
  "settings.date.label": "Vis leverancens dato som",
  "settings.date.shipping": "Forventet afsendelse",
  "settings.date.delivery": "Forventet levering",
  "settings.texts.intro":
    "Shopify viser teksten ved forudbestillingen i kurven, i checkout og i ordrebekræftelsen. Standardteksten oversættes selv til kundens sprog; skriver du din egen, bruges den som den er. Teksterne på produktsiden og i kurven retter du på blokken i temaeditoren.",
  "settings.texts.shipping": "Tekst ved forventet afsendelse",
  "settings.texts.delivery": "Tekst ved forventet levering",
  "settings.texts.dateHint": "{date} erstattes af leverancens dato.",
  // Hændelsestyper
  "event.preorder.created": "Forudbestilling oprettet",
  "event.preorder.delayed": "Forudbestilling forsinket",
  "event.preorder.ready": "Forudbestilling klar til afsendelse",
  "event.preorder.cancelled": "Forudbestilling annulleret",
  "event.preorder.payment_failed": "Forudbestilling: betaling afvist",
  "event.waitlist.available": "Venteliste: varen kan købes",

  // Ordrebehandling
  "queue.heading": "Ordrebehandling",
  "queue.status.ACTIVE": "Tildelt",
  "queue.status.UNRESOLVED": "Uafklaret",
  "queue.status.CANCELLED": "Annulleret",
  "queue.topic.CUSTOMERS_DATA_REQUEST": "Dataanmodning",
  "queue.topic.CUSTOMERS_REDACT": "Sletning af kunde",
  "queue.topic.SHOP_REDACT": "Sletning af butik",
  "queue.topic.ORDERS_CREATE": "Ny ordre",
  "queue.topic.ORDERS_UPDATED": "Ordre ændret",
  "queue.topic.ORDERS_CANCELLED": "Ordre annulleret",
  "queue.topic.REFUNDS_CREATE": "Refundering",
  "queue.topic.ORDER_TRANSACTIONS_CREATE": "Betaling",
  "queue.waitlistLine":
    "Venteliste: variant {variant} (produkt {product}), tilmeldt {signedUp}, {notified}",
  "queue.waitlistNotified": "fik besked {date}",
  "queue.waitlistWaiting": "venter på besked",
  "queue.lineUnits": "{count} stk.",
  "queue.linePromised": "lovet {date}",
  "queue.eventSent": "{event} sendt til {recipients}",
  "queue.noRecipients": "ingen modtagere",
  "queue.contactEncrypted": " (navn og e-mail gemt krypteret)",
  "queue.unknownError": "Ukendt fejl.",
  "queue.retried.one": "1 hændelse sat i kø igen",
  "queue.retried.other": "{count} hændelser sat i kø igen",
  "queue.answered": "Markeret som besvaret",
  "queue.requestMissing": "Anmodningen findes ikke.",
  "queue.unknownOrder": "Ukendt ordre.",
  "queue.reprocessing": "Ordren behandles igen",
  "queue.retryAll": "Prøv alle igen",
  "queue.pending.one":
    "1 hændelse venter på at blive behandlet. Det sker normalt inden for et minut.",
  "queue.pending.other":
    "{count} hændelser venter på at blive behandlet. Det sker normalt inden for et minut.",
  "queue.data.heading": "Kunders dataanmodninger",
  "queue.data.intro":
    "En kunde har bedt butikken om at se de oplysninger, der gemmes om kunden. Her er alt, hvad PREAURA gemmer om kundens ordrer. Navn og e-mail gemmes kun i hændelser, der sendes på butikkens instruks (Flow, webhook, Klaviyo), krypteret og højst 30 dage. Send det til kunden sammen med butikkens egne oplysninger, og markér anmodningen som besvaret. Besvarede anmodninger slettes efter 30 dage.",
  "queue.data.customer": "Kunde {id}",
  "queue.data.answered": "Besvaret {date}",
  "queue.data.waiting": "Venter på svar",
  "queue.data.received": "Modtaget {date}",
  "queue.data.nothing.one":
    "PREAURA gemmer ingen oplysninger om kundens ordre.",
  "queue.data.nothing.other":
    "PREAURA gemmer ingen oplysninger om kundens {count} ordrer.",
  "queue.data.events": ". Hændelser: {events}",
  "queue.data.markAnswered": "Markér som besvaret",
  "queue.unresolved.heading": "Uafklarede ordrer",
  "queue.unresolved.none": "Alle forudbestillinger har plads i en leverance.",
  "queue.unresolved.intro":
    "Disse ordrelinjer er betalt, men der var ikke plads i nogen leverance. Opret en leverance med plads, og behandl ordren igen. Ordrerne har tagget «Forudbestilling uafklaret» i Shopify.",
  "queue.col.order": "Ordre",
  "queue.col.unplaced": "Antal uden plads",
  "queue.col.ordered": "Bestilt",
  "queue.col.action": "Handling",
  "queue.col.quantity": "Antal",
  "queue.col.status": "Status",
  "queue.col.event": "Hændelse",
  "queue.col.error": "Fejl",
  "queue.col.received": "Modtaget",
  "queue.reprocess": "Behandl igen",
  "queue.withoutPlan.heading": "Solgt uden forudbestillingsplan",
  "queue.withoutPlan.none":
    "Alle forudbestillinger er købt som forudbestilling.",
  "queue.withoutPlan.intro.one":
    "1 ordre de seneste 30 dage købte en vare på forudbestilling uden at vælge forudbestilling, fx en kladdeordre, et salg i POS, en ordre fra en anden app, eller fordi PREAURA-blokken mangler på produktsiden. Appen har talt den med i den aktive leverance, så varen ikke sælges for meget. Sker det tit, er der som regel noget galt i opsætningen.",
  "queue.withoutPlan.intro.other":
    "{count} ordrer de seneste 30 dage købte en vare på forudbestilling uden at vælge forudbestilling, fx en kladdeordre, et salg i POS, en ordre fra en anden app, eller fordi PREAURA-blokken mangler på produktsiden. Appen har talt dem med i den aktive leverance, så varen ikke sælges for meget. Sker det tit, er der som regel noget galt i opsætningen.",
  "queue.failed.heading": "Hændelser, der fejlede",
  "queue.failed.none": "Ingen fejl.",
  "queue.retry": "Prøv igen",
  // Annulleringer
  "releases.heading": "Annulleringer",
  "releases.error.window": "Vælg en frist.",
  "releases.error.approval": "Vælg godkendelse.",
  "releases.error.number": "Skriv et helt tal fra {min} til {max}.",
  "releases.toast.approved": "Annulleringen er godkendt",
  "releases.toast.rejected": "Anmodningen er afvist",
  "releases.toast.retry": "Prøves igen",
  "releases.toast.releasing": "Enhederne frigives nu",
  "releases.toast.extended": "Fristen er forlænget med {count} dage",
  "releases.toast.saved": "Indstillinger gemt",
  "releases.deliveryLine": "{count} stk. i leverance {position} ({date})",
  "releases.request.PENDING": "Venter på dig",
  "releases.request.APPROVED": "Udføres",
  "releases.request.DONE": "Annulleret",
  "releases.request.REJECTED": "Afvist",
  "releases.request.FAILED": "Fejlede",
  "releases.issue.OPEN": "Venter på betaling",
  "releases.issue.RELEASING": "Frigives",
  "releases.issue.RELEASED": "Frigivet",
  "releases.issue.PAID": "Betalt",
  "releases.issue.CLOSED": "Ordren annulleret",
  "releases.noPayout":
    "Appen udbetaler aldrig penge. Når en forudbestilling annulleres, rettes ordren i Shopify uden refundering, og enhederne kommer tilbage i leverancen. Har kunden betalt noget, refunderer du selv i Shopify.",
  "releases.requests.heading": "Anmodninger fra kunder ({count})",
  "releases.requests.none": "Ingen anmodninger venter.",
  "releases.col.order": "Ordre",
  "releases.col.received": "Modtaget",
  "releases.col.units": "Stk.",
  "releases.col.action": "Handling",
  "releases.col.declined": "Afvist",
  "releases.col.releases": "Frigives",
  "releases.col.delivery": "Leverance",
  "releases.approve": "Godkend",
  "releases.reject": "Afvis",
  "releases.issues.heading": "Afviste betalinger ({count})",
  "releases.issues.intro":
    "Ordrer, hvor betalingen blev afvist, da du sendte varen (fx et udløbet kort). Kunden får det antal dage, du har valgt under Regler, til at betale. Betaler kunden ikke, annulleres forudbestillingen, og varen kommer tilbage i leverancen.",
  "releases.issues.none": "Ingen afviste betalinger.",
  "releases.now": "Nu",
  "releases.releaseNow": "Frigiv nu",
  "releases.extend": "Forlæng",
  "releases.rules.heading": "Regler",
  "releases.rules.window": "Kunden kan annullere",
  "releases.rules.untilShipped": "Indtil varen er sendt",
  "releases.rules.days": "Et antal dage efter bestilling",
  "releases.rules.daysLabel": "Dage efter bestilling",
  "releases.rules.daysDetails":
    "Annullering kan ikke slås helt fra. Husk de regler for fortrydelse, der gælder dine kunder.",
  "releases.rules.approval": "Godkendelse",
  "releases.rules.manual": "Jeg godkender altid selv",
  "releases.rules.auto":
    "Godkend automatisk inden for et antal dage efter bestilling",
  "releases.rules.autoLabel": "Automatisk godkendelse i dage efter bestilling",
  "releases.rules.autoDetails":
    "Senere annulleringer venter på din godkendelse.",
  "releases.rules.grace": "Dage til at betale, hvis betalingen afvises",
  "releases.rules.graceDetails":
    "Kunden betaler først, når du sender varen. Afvises betalingen da, fx fordi kortet er udløbet, får kunden så mange dage til at betale. Betaler kunden ikke inden da, annulleres forudbestillingen, og varen kommer tilbage i leverancen, så en anden kan købe den.",
  "releases.rules.link":
    "Kundens link til at annullere står på ordren som metafeltet {field} og i hændelserne til Klaviyo, Shopify Flow og webhook.",
  "releases.history": "Historik",
  "releases.history.request": "{order}: {count} stk., {date}",
  "releases.history.retrying": "Forsøger igen: ",
  "releases.history.issue": "{order}: betaling afvist {date}",
  // Venteliste
  "waitlist.heading": "Venteliste",
  "waitlist.saved": "Indstillinger gemt",
  "waitlist.inStock": "På lager",
  "waitlist.delivery": "Leverance {date}",
  "waitlist.noRecipients.heading": "Ingen modtagere er slået til",
  "waitlist.noRecipients.text":
    "Tilmeldinger samles, men der udløses ingen beskeder, før mindst én modtager er slået til under",
  "waitlist.waiting.heading": "Venter på besked ({count})",
  "waitlist.empty":
    "Ingen har skrevet sig op endnu. Feltet vises på produktsiden, når en variant hverken kan købes på lager eller forudbestilles. Slå det til i blokken «Forudbestilling» i temaeditoren.",
  "waitlist.col.product": "Produkt",
  "waitlist.col.variant": "Variant",
  "waitlist.col.waiting": "Venter nu",
  "waitlist.col.notified": "Har fået besked",
  "waitlist.how.heading": "Sådan sendes beskederne",
  "waitlist.how.text":
    "Når en variant kan købes igen, fordi den er kommet på lager, eller fordi en leverance med ledige pladser er åbnet, får de tilmeldte besked i den rækkefølge, de skrev sig op. Hver tilmelding får én besked og lukkes derefter. Selve beskeden sender du via Shopify Flow eller Klaviyo.",
  "waitlist.stable.label": "Ventetid (minutter)",
  "waitlist.stable.details":
    "Varen skal have kunnet købes så længe, før der sendes. Så giver et kort udsving i lageret ingen beskeder.",
  "waitlist.batch.label": "Portion (antal pr. gang)",
  "waitlist.batch.details":
    "Så mange får besked ad gangen. Sæt den gerne omkring det antal, der er til salg.",
  "waitlist.interval.label": "Interval (minutter)",
  "waitlist.interval.details":
    "Tid mellem to portioner. Før hver portion tjekkes det, at varen stadig kan købes.",
  "waitlist.only.heading": "Kun besked om varen",
  "waitlist.only.text":
    "Kunden har selv bedt om beskeden, så den må sendes uden samtykke, men kun hvis den handler om varen. Lægger du tilbud, andre varer eller rabatkoder i den, bliver den markedsføring og kræver samtykke (i Danmark markedsføringslovens § 10). Tilmeldingen må ikke bruges til nyhedsbrev.",
  // Hændelser
  "events.heading": "Hændelser",
  "events.toast.confirmed": "Bekræftet",
  "events.toast.unconfirmed": "Bekræftelse fjernet",
  "events.toast.flowOn": "Flow slået til",
  "events.toast.flowOff": "Flow slået fra",
  "events.toast.urlSaved": "Adressen er gemt",
  "events.toast.urlRemoved": "Adressen er fjernet",
  "events.toast.webhookOn": "Webhook slået til",
  "events.toast.webhookOff": "Webhook slået fra",
  "events.toast.secret": "Ny signaturnøgle lavet",
  "events.toast.keySaved": "Nøglen er gemt",
  "events.toast.keyRemoved": "Nøglen er fjernet",
  "events.toast.klaviyoOn": "Klaviyo slået til",
  "events.toast.klaviyoOff": "Klaviyo slået fra",
  "events.toast.retried.one": "1 levering sendes igen",
  "events.toast.retried.other": "{count} leveringer sendes igen",
  "events.status.DONE": "Sendt",
  "events.status.FAILED": "Fejlet",
  "events.status.PENDING": "Venter",
  "events.waitlistRef": "Venteliste",
  "events.intro":
    "PREAURA sender en hændelse, når der sker noget med en forudbestilling: oprettet, forsinket, klar til afsendelse, annulleret eller betaling afvist, og når en vare på ventelisten kan købes igen. Hver hændelse indeholder butik, kundens navn og e-mail, ordrenummer, produkt og variant, antal, leverancens dato, den tidligere dato, hvis den er ændret, og et entydigt id. Indholdet er det samme hos alle modtagere. Det er jer, der bygger mailen.",
  "events.responsibility.heading": "Ansvar for kundeoplysninger",
  "events.responsibility.warning":
    "Webhook og Klaviyo sender kundens navn og e-mail videre til en tredjepart. Butikken er selv ansvarlig for at have et lovligt grundlag for det (fx samtykke eller kundens ordre) og for sin egen aftale med modtageren. PREAURA sender kun på butikkens instruks og er databehandler, ikke afsender.",
  "events.responsibility.label":
    "Butikken har grundlag for at sende kundeoplysninger til de modtagere, den slår til nedenfor",
  "events.responsibility.accepted":
    "Bekræftet {date}. Fjernes bekræftelsen, slås webhook og Klaviyo fra.",
  "events.responsibility.required":
    "Kræves for at slå webhook og Klaviyo til. Shopify Flow kræver det ikke, for det bliver i Shopify.",
  "events.flow.label": "Send hændelser til Shopify Flow",
  "events.flow.details":
    "Hver hændelse er en trigger i Flow, fx «Forudbestilling oprettet» og «Forudbestilling klar til afsendelse». Byg en workflow i Flow-appen, fx en mail eller et tag, når ordren er klar.",
  "events.webhook.intro":
    "Appen sender hændelsen som JSON med POST til jeres adresse. Brug den til fx Zapier, Make, Drip, Omnisend, Mailchimp eller Brevo.",
  "events.webhook.saved": "Adresse gemt: ••••{last4}",
  "events.remove": "Fjern",
  "events.webhook.newUrl": "Ny adresse",
  "events.webhook.url": "Adresse",
  "events.webhook.save": "Gem adresse",
  "events.webhook.label": "Send hændelser til webhooken",
  "events.webhook.secret": "Signaturnøgle",
  "events.webhook.signature":
    "Hvert kald har headeren {header}: HMAC-SHA256 af den rå tekst i kaldet med denne nøgle, base64-kodet. Beregn den selv, og sammenlign. Så ved I, at kaldet kommer fra PREAURA. Headeren X-Preaura-Event-Id er hændelsens id; brug den til at se bort fra gentagelser.",
  "events.webhook.newSecret": "Lav ny signaturnøgle",
  "events.klaviyo.intro":
    "Hændelserne sendes til Klaviyo som metrics, fx «PREAURA: Forudbestilling klar til afsendelse», på kundens profil. Klaviyo opretter selv metricen første gang, og den kan bruges som udløser i et flow. Brug en privat API-nøgle med adgang til Events (Settings → API keys i Klaviyo).",
  "events.klaviyo.saved": "Nøgle gemt: ••••{last4}",
  "events.klaviyo.newKey": "Ny privat API-nøgle",
  "events.klaviyo.key": "Privat API-nøgle",
  "events.klaviyo.save": "Gem nøgle",
  "events.klaviyo.label": "Send hændelser til Klaviyo",
  "events.encryption.heading": "Krypteringsnøglen mangler",
  "events.encryption.text":
    "Serveren mangler miljøvariablen PREAURA_ENCRYPTION_KEY. Uden den kan hændelser ikke bygges, og nøgler og adresser kan ikke gemmes. På Render: preaura → Environment, eller Manual sync på blueprintet.",
  "events.waiting.heading": "Venter på at blive sendt",
  "events.waiting.intro":
    "Disse hændelser er ikke sendt endnu. Normalt sker det inden for et minut. Står der en fejl, prøver appen igen hvert minut.",
  "events.col.event": "Hændelse",
  "events.col.reference": "Ordre / produkt",
  "events.col.created": "Oprettet",
  "events.col.error": "Fejl",
  "events.col.recipient": "Modtager",
  "events.col.time": "Tidspunkt",
  "events.col.status": "Status",
  "events.col.message": "Besked",
  "events.col.action": "Handling",
  "events.failed.heading": "Fejlede leveringer",
  "events.failed.none": "Ingen fejl.",
  "events.failed.intro":
    "Disse hændelser kunne ikke leveres, heller ikke efter 10 forsøg med voksende ventetid (op til omkring 8 timer). Ret årsagen, og prøv igen. Hændelsens data slettes efter 30 dage.",
  "events.retryAll": "Prøv alle igen",
  "events.retry": "Prøv igen",
  "events.dataDeleted": "Data slettet",
  "events.log.heading": "Logbog",
  "events.log.none":
    "Ingen hændelser endnu. De kommer, når en kunde forudbestiller.",
  "events.attempts": " ({count} forsøg)",
  "events.others.heading": "Drip, Omnisend, Mailchimp, Brevo og andre",
  "events.others.zapier":
    "Brug webhooken. Med Zapier: opret en Zap med udløseren «Webhooks by Zapier → Catch Hook», og indsæt Zapiers adresse ovenfor. Send en forudbestilling igennem, så Zapier kan se felterne, og vælg derefter jeres mailsystem som næste trin, fx «Add/Update Subscriber» med customer.email, og en tag eller hændelse ud fra type (fx preorder.ready).",
  "events.others.make":
    "Med Make: opret et scenarie med modulet «Webhooks → Custom webhook», indsæt Makes adresse ovenfor, og fortsæt med jeres mailsystems modul. Felterne er de samme.",
  // Gemte beskeder (fejl og årsager, vist senere)
  "stored.shopifyError": "{action}: {details}",
  "stored.shopifyRejected": "Shopify afviste forespørgslen: {details}",
  "shopifyAction.removeTag": "Fjernelse af tag fra ordren",
  "shopifyAction.removeVariant": "Fjernelse af variant fra selling plan group",
  "shopifyAction.requireSellingPlan": "Krav om forudbestilling på produktet",
  "shopifyAction.variantMetafield": "Metafelt på varianten",
  "shopifyAction.orderMetafields": "Metafelter på ordren",
  "shopifyAction.updateInventory": "Opdatering af lagerantal",
  "shopifyAction.createGroup": "Oprettelse af selling plan group",
  "shopifyAction.createPlan": "Oprettelse af selling plan",
  "shopifyAction.inventoryTracking": "Opsætning af lagersporing",
  "shopifyAction.translation": "Oversættelse",
  "shopifyAction.editQuantity": "Rettelse af antal",
  "shopifyAction.editOrder": "Rettelse af ordren",
  "shopifyAction.flow": "Shopify Flow",
  "shopifyAction.deleteGroup": "Sletning af selling plan group",
  "shopifyAction.addTag": "Tag på ordren",
  "shopifyAction.addVariant": "Tilknytning af variant til selling plan group",
  "shopifyAction.deletePlans": "Udfasning af selling plan",
  "stored.sync.variantGone": "Varianten findes ikke længere i Shopify.",
  "stored.sync.noLocation":
    "Varianten ligger ikke på noget lager i Shopify. Tilføj den til et lager, og synkronisér igen.",
  "stored.sync.notActivated":
    "Varianten er ikke aktiveret på sit lager i Shopify. Aktivér den på lageret, og synkronisér igen.",
  "stored.sync.planNotCreated":
    "Shopify oprettede ikke planen «{option}». Synkronisér igen.",
  "stored.order.gone": "Ordren findes ikke længere i Shopify.",
  "stored.order.noOrder": "Hændelsen indeholder ingen ordre.",
  "stored.order.noCustomer": "Hændelsen indeholder ingen kunde.",
  "stored.order.notWritten":
    "Ordren er tildelt, men leveringsdato og tag kunne ikke skrives på ordren i Shopify: {details}",
  "stored.mode.forced": "Tvunget i forudbestilling af webshopejeren.",
  "stored.mode.empty": "Lageret ramte 0, og der er plads i en leverance.",
  "stored.mode.unforced":
    "Tvang slået fra. {count} stk. er sat tilbage på lager.",
  "stored.mode.received": "Der kom {count} stk. på lager.",
  "stored.mode.receivedSplit":
    "Der kom {count} stk. på lager. {owed} går til forudbestillinger, {forSale} sælges som almindeligt lager.",
  "stored.outbox.signupDeleted":
    "Tilmeldingen er slettet, før beskeden kunne sendes.",
  "stored.outbox.dataDeleted":
    "Hændelsens data er slettet (efter 30 dage eller på kundens anmodning) og kan ikke sendes.",
  "stored.outbox.flowOff": "Shopify Flow er slået fra.",
  "stored.outbox.webhookOff": "Webhooken er slået fra.",
  "stored.outbox.klaviyoOff": "Klaviyo er slået fra.",
  "stored.outbox.unreachable": "Kunne ikke nå modtageren: {details}",
  "stored.outbox.noEmail":
    "Ordren har ingen e-mail, eller PREAURA har ikke adgang til kundens e-mail i Shopify. Klaviyo kræver en e-mail.",
  "stored.outbox.klaviyoKey":
    "Klaviyo afviste API-nøglen. Tjek, at det er en privat nøgle med adgang til Events.",
  "action.deliveryMissing": "Leverancen findes ikke.",
  "action.variantMissing": "Varianten findes ikke i appen.",
  "action.cancelledNoEdit": "En annulleret leverance kan ikke rettes.",
  "action.hasOrders":
    "Leverancen har tildelte ordrer og kan ikke slettes. Annullér den i stedet, så kan du se, hvilke ordrer der er berørt.",
  "integration.urlCredentials":
    "Adressen må ikke indeholde brugernavn eller adgangskode.",
  "integration.urlPublic":
    "Adressen skal være offentlig tilgængelig på internettet.",
  "integration.klaviyoKey":
    "Det ligner ikke en privat Klaviyo-nøgle. Den starter med pk_ og findes under Settings → API keys i Klaviyo.",
  // Noter på ordren i Shopify
  "orderNote.cancelled":
    "Annulleret af PREAURA. Intet er refunderet. Refundér i Shopify, hvis kunden har betalt.",
  "orderNote.reduced":
    "Antal nedsat af PREAURA (annullering). Intet er refunderet. Refundér i Shopify, hvis kunden har betalt.",
  // Kundens side til annullering (i butikken)
  "cancelPage.heading": "Annullér forudbestilling",
  "cancelPage.invalid":
    "Linket er ugyldigt eller udløbet. Kontakt butikken, hvis du vil annullere din forudbestilling.",
  "cancelPage.unavailable":
    "Annullering via link er ikke tilgængelig lige nu. Kontakt butikken, hvis du vil annullere din forudbestilling.",
  "cancelPage.alreadyRequested":
    "Vi har allerede modtaget din anmodning om at annullere. Du hører fra butikken.",
  "cancelPage.alreadyCancelled": "Forudbestillingen er allerede annulleret.",
  "cancelPage.windowClosed":
    "Fristen for at annullere via linket er udløbet, eller varen er sendt. Kontakt butikken.",
  "cancelPage.nothing":
    "Der er ingen forudbestilte varer at annullere på ordren.",
  "cancelPage.chooseSomething": "Vælg hvor mange du vil annullere.",
  "cancelPage.approved":
    "Din annullering er godkendt og gennemføres nu. Har du betalt noget, refunderer butikken det.",
  "cancelPage.requested":
    "Tak. Din anmodning om at annullere er sendt til butikken, som vender tilbage.",
  "cancelPage.order": "Ordre {name}",
  "cancelPage.expected": "Forventet: {date}",
  "cancelPage.quantity": "Antal at annullere (af {count})",
  "cancelPage.submit": "Annullér",
  // Teknisk forklaring i opsætningsguiden
  "setupReason.noAnswer": "intet svar fra Shopify",
  "setupReason.noThemeExtension":
    "ingen temaudvidelse i svaret ({count} udvidelser)",
  "setupReason.otherName": "temaudvidelsen hedder {names}",
  "setupReason.noApi": "Shopify Admin tilbyder ikke app.extensions()",
};

export type MessageKey = keyof typeof da;
