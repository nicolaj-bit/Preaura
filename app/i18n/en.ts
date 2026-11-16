import type { MessageKey } from "./da";

// The app's texts in English. Same keys as da.ts (TypeScript checks it).
// Texts with a number: «.one» and «.other», {count} is the number.

export const en: Record<MessageKey, string> = {
  // Navigation and shared
  "nav.home": "PREAURA",
  "nav.products": "Products",
  "nav.queue": "Order processing",
  "nav.releases": "Cancellations",
  "nav.waitlist": "Waitlist",
  "nav.events": "Events",
  "nav.settings": "Settings",
  "nav.subscription": "Subscription",
  "common.unknownProduct": "Unknown product",
  "common.unknownAction": "Unknown action.",
  "common.of": "{done} of {total}",
  "common.units": "{count} units",
  "common.none": "None",

  // Subscription missing / can't be checked
  "billing.errorHeading": "The subscription couldn’t be checked",
  "billing.errorGeneric":
    "The subscription couldn’t be checked. Please try again shortly.",
  "subscriptionRequired.heading": "Choose a subscription",
  "subscriptionRequired.text":
    "PREAURA needs an active subscription. You’re being taken to Shopify’s page where you choose it. Your deliveries and pre-orders are saved and waiting until the subscription is active.",
  "subscriptionRequired.button": "Go to subscription",

  // Theme block missing
  "themeBlock.headingPreorderOn": "Your customers can’t see the pre-order yet",
  "themeBlock.headingPreorderOff":
    "The PREAURA block is missing from your theme",
  "themeBlock.consequence":
    "Pre-orders aren’t shown to customers until the PREAURA block is added to the product page in your theme. Without it, customers see neither the delivery date nor the terms, and the date isn’t added to the cart and the order.",
  "themeBlock.howTo":
    "The button opens the theme editor with the block ready — click Save. Shopify only checks your published theme, so the block must be in that one. If the button doesn’t open the block, your theme probably doesn’t support app blocks (that needs an Online Store 2.0 theme). Write to us and we’ll help.",
  "themeBlock.button": "Add the block to the theme",
  "themeBlock.reason.noAnswer": "no answer from Shopify",
  "themeBlock.reason.noExtension":
    "Shopify Admin doesn’t offer app.extensions()",

  // Home page
  "home.heading": "Pre-orders",
  "home.selectProducts": "Select products",
  "home.productsAdded": "Products added",
  "home.unresolved.heading": "Orders with no room in a delivery",
  "home.unresolved.text.one":
    "1 order has pre-ordered items that don’t fit in any delivery.",
  "home.unresolved.text.other":
    "{count} orders have pre-ordered items that don’t fit in any delivery.",
  "home.seeOrders": "See the orders",
  "home.dataRequests.heading": "A customer has asked for their data",
  "home.dataRequests.text.one":
    "1 data request is waiting for an answer. The customer is entitled to an answer within 30 days.",
  "home.dataRequests.text.other":
    "{count} data requests are waiting for an answer. The customer is entitled to an answer within 30 days.",
  "home.dataRequests.link": "See the request",
  "home.failed.heading": "Orders couldn’t be processed",
  "home.failed.text.one":
    "1 event from Shopify failed and is waiting for you to try again.",
  "home.failed.text.other":
    "{count} events from Shopify failed and are waiting for you to try again.",
  "home.failed.link": "Go to order processing",
  "home.withoutPlan.heading": "Pre-orders bought without a plan",
  "home.withoutPlan.text.one":
    "1 order in the last 7 days bought an item on pre-order without choosing pre-order. The app counted it, but it may mean something in the setup is wrong.",
  "home.withoutPlan.text.other":
    "{count} orders in the last 7 days bought an item on pre-order without choosing pre-order. The app counted them, but it may mean something in the setup is wrong.",
  "home.products.heading": "Products",
  "home.products.empty":
    "You haven’t selected any products yet. Select the products that should be available for pre-order when they sell out — for example an item you’re expecting a new shipment of. The products are sold from stock as usual until stock reaches 0.",
  "home.stats.orders30": "Pre-orders (30 days)",
  "home.stats.units30": "Units pre-ordered (30 days)",
  "home.stats.waiting": "Waiting for stock",
  "home.stats.ready": "{count} units ready to ship",
  "home.stats.next": "Next delivery",
  "home.deliveries.heading": "Deliveries",
  "home.deliveries.empty":
    "No deliveries yet. A delivery is a shipment of goods you’re expecting: an expected date and a quantity. Customers pre-order into the first delivery with room left and are promised its date. When it sells out, sales continue in the next one.",
  "home.deliveries.createFirst": "Create the first delivery",
  "home.col.product": "Product",
  "home.col.date": "Date",
  "home.col.sold": "Sold",
  "home.col.status": "Status",
  "home.col.variantsOn": "Variants with pre-order",
  "home.state.active": "Active",
  "home.state.soldOut": "Sold out",
  "home.state.upcoming": "Upcoming",
  "home.productGone": "The product no longer exists",
  "home.badge.off": "Off",
  "home.badge.onlyPreorder": "Pre-order only",
  "home.badge.mixed": "Mixed",
  "home.badge.stock": "Selling from stock",
  "home.help.heading": "Need help?",
  "home.help.text":
    "We answer on weekdays, usually the same day. Please include your store’s name and, if it’s about an order, the order number.",
  "home.help.writeTo": "Write to",

  // Setup guide
  "guide.headingDone": "PREAURA is set up",
  "guide.heading": "Get started with PREAURA",
  "guide.progress": "{done} of {total} steps done",
  "guide.progressDone": " — your customers can now pre-order.",
  "guide.show": "Show steps",
  "guide.hide": "Hide",
  "guide.openProduct": "Open the product",
  "guide.addBlock": "Add the block",
  "guide.confirmBlock": "I’ve added the block",
  "guide.enableCart": "Turn on in the cart",
  "guide.confirmCart": "I’ve turned it on",
  "guide.products.title": "Select the products that can be pre-ordered",
  "guide.products.text":
    "For example an item you’re expecting a new shipment of. The products are sold from stock as usual until it runs out.",
  "guide.delivery.title": "Create the first delivery",
  "guide.delivery.text":
    "Open the product and enter when you expect to ship the goods and how many you’ll sell on pre-order. The date is the one customers are promised.",
  "guide.enable.title": "Turn on pre-order",
  "guide.enable.text":
    "Turn on «Pre-order when out of stock» for the variant. The app switches to pre-order by itself when stock reaches 0. If the item is still in stock, customers won’t see the pre-order yet — to see it right away, turn on «Force pre-order» for the product.",
  "guide.block.title": "Show the pre-order on the product page",
  "guide.block.text":
    "Add the PREAURA block to your theme. The button opens the theme editor with the block ready — you just click Save.",
  "guide.block.unknown":
    "Shopify can’t tell us whether the block has been added{reason}. If you’ve added it and clicked Save, mark the step as done.",
  "guide.cart.title": "Show in the cart that nothing is due today",
  "guide.cart.text":
    "Turn on «PREAURA cart» under App embeds. Each pre-ordered item in the cart then says that nothing is due today, and above the checkout button it shows what is charged when the item ships. The button opens the theme editor with it turned on — you just click Save.",
  "guide.cart.unknown":
    "Shopify can’t tell us whether it’s turned on{reason}. If you’ve turned it on and clicked Save, mark the step as done.",

  // Subscription
  "subscription.heading": "Subscription",
  "subscription.off":
    "The subscription isn’t turned on yet. All features are available.",
  "subscription.none":
    "The store has no active subscription, so PREAURA is closed. Your deliveries and pre-orders are saved and waiting for you.",
  "subscription.start": "Start subscription",
  "subscription.badge.trial": "Free trial",
  "subscription.badge.active": "Active",
  "subscription.lastDay": "Last day of the free trial",
  "subscription.daysLeft": "{count} days left of the free trial",
  "subscription.endsOn": " (ends {date}).",
  "subscription.cancelled":
    "The subscription has been cancelled and stops at the end of the current period. Your deliveries and pre-orders aren’t deleted.",
  "subscription.about":
    "The subscription gives access to all of PREAURA’s features. It’s managed by Shopify, and payment runs through the store’s Shopify invoice.",
  "subscription.seeAtShopify": "View the subscription at Shopify",
  "subscription.ifStops.heading": "If the subscription stops",
  "subscription.ifStops.text":
    "If the free trial ends without a subscription, or you cancel, the app’s features close. Deliveries, pre-orders and orders are never deleted. If you start the subscription again, everything is as it was.",
};
