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
  // Product page
  "product.notFound": "The product doesn’t exist.",
  "product.notInApp": "The product isn’t in the app.",
  "product.goneInShopify": "The product no longer exists in Shopify",
  "product.variantGone": "The variant no longer exists in Shopify",
  "product.variantNotInApp": "The variant isn’t in the app.",
  "product.syncFailedSuffix": "{message}, but Shopify couldn’t be updated",
  "product.toast.enabled": "Pre-order turned on",
  "product.toast.disabled": "Pre-order turned off",
  "product.toast.created": "Delivery created",
  "product.toast.saved": "Delivery saved",
  "product.toast.deleted": "Delivery deleted",
  "product.toast.cancelled": "Delivery cancelled",
  "product.toast.forced": "Pre-order forced",
  "product.toast.unforced": "Forcing turned off",
  "product.toast.synced": "Synced with Shopify",
  "product.limits.heading": "Before you sell on pre-order",
  "product.limits.intro":
    "The customer only pays when you ship the item. Shopify saves the card when the order is placed and charges it when the order ships. This only works with certain payment providers and features:",
  "product.limits.gateways":
    "Only these payment providers support it: Shopify Payments, PayPal Express, Adyen and Stripe (for some stores only). If you use another one, customers can’t complete a pre-order.",
  "product.limits.localMethods":
    "Local payment methods (such as MobilePay and bank transfer) can’t be used for pre-orders.",
  "product.limits.channels":
    "Pre-orders can’t be sold in Shopify POS, on draft orders or to B2B customers.",
  "product.limits.discounts":
    "«Buy X, get Y» discounts don’t work on pre-ordered items.",
  "product.limits.permalinks":
    "Cart permalinks and a checkout customized with checkout.liquid don’t support pre-orders.",
  "product.limits.declined":
    "If the card has expired or has insufficient funds when you ship, the order is marked unpaid. See «Cancellations» for declined payments.",
  "product.modeAll.heading": "Pre-order only",
  "product.modeAll.text":
    "All variants are on pre-order. Shopify therefore only allows buying on pre-order: the «One-time purchase» option isn’t shown on the product page.",
  "product.modeAll.notSynced":
    "Shopify hasn’t been updated yet. Click «Sync» on one of the variants.",
  "product.modeMixed.heading": "Mixed: some variants are sold as usual",
  "product.modeMixed.text1":
    "Only some variants are on pre-order. Shopify can only require pre-order for the whole product, which would block the regular variants — so it isn’t turned on.",
  "product.modeMixed.text2":
    "Instead, the PREAURA block on the product page makes sure the variants on pre-order are bought as pre-orders. If someone buys without it anyway (for example on a draft order or in POS), the app counts the sale in the active delivery and shows it under Order processing.",
  "product.deliveries": "Deliveries",
  "product.toggle.label": "Pre-order when out of stock",
  "product.toggle.details":
    "The app switches by itself: selling from stock while there are items on the shelf, and pre-order when stock reaches 0 and a delivery has room.",
  "product.noActive":
    "Pre-order is turned on, but no delivery has room left. Create a delivery below.",
  "product.noDeliveries":
    "No deliveries yet. A delivery is a shipment you’re expecting: when you expect to ship the goods and how many you’ll sell on pre-order. Customers pre-order into the first delivery with room left and are promised its date. Create the first one below.",
  "product.editDelivery": "Edit delivery {position}",
  "product.newDelivery": "New delivery",
  "product.save": "Save",
  "product.addDelivery": "Add delivery",
  "product.mode.now": "Current mode:",
  "product.mode.stock": "Selling from stock",
  "product.mode.forced": "Pre-order (forced)",
  "product.mode.auto": "Pre-order (automatic)",
  "product.mode.stockText":
    "There are items in stock. The variant is sold like any other item, and the app touches neither the stock nor the product page.",
  "product.mode.forcedText":
    "You’ve forced the variant into pre-order, even though there may be items in stock. The app manages the stock until you turn forcing off.",
  "product.mode.autoText":
    "Stock is empty. Customers can pre-order, and the app manages the stock from the deliveries. If you add stock (as an adjustment, for example +20), the variant switches back by itself — once the pre-orders are covered.",
  "product.mode.lastChanged": "Last changed {date}: {reason}",
  "product.mode.neverChanged": "Hasn’t changed mode yet.",
  "product.force.label": "Force pre-order",
  "product.force.details":
    "Use this when the last units in stock are damaged or reserved. When forcing is turned off, stock is set back to what it was.",
  "product.sync.errorHeading": "Shopify isn’t updated",
  "product.sync.lastAttempt": "Last attempt: {date}",
  "product.sync.retry": "Try again",
  "product.sync.active": "Active delivery",
  "product.sync.activeValue": "No. {position} · {date}",
  "product.sync.stock": "Stock in Shopify now",
  "product.sync.unknown": "Unknown",
  "product.sync.last": "Last synced",
  "product.sync.never": "Never",
  "product.sync.button": "Sync",
  "product.state.ACTIVE": "Active",
  "product.state.UPCOMING": "Upcoming",
  "product.state.SOLD_OUT": "Sold out",
  "product.state.CANCELLED": "Cancelled",
  "product.col.position": "No.",
  "product.col.date": "Date",
  "product.col.quantity": "Quantity",
  "product.col.allocated": "Allocated",
  "product.col.remaining": "Remaining",
  "product.col.status": "Status",
  "product.col.actions": "Actions",
  "product.action.orders": "Orders",
  "product.action.edit": "Edit",
  "product.action.cancel": "Cancel",
  "product.action.delete": "Delete",
  "product.seeDeliveryOrders": "See the delivery’s orders",
  "product.cancelModal.heading": "Cancel delivery {position}?",
  "product.cancelModal.text":
    "The delivery on {date} will be marked as cancelled. This can’t be undone.",
  "product.cancelModal.allocated.one":
    "1 order line is allocated to the delivery. The allocations stay, so you can see afterwards which orders are affected.",
  "product.cancelModal.allocated.other":
    "{count} order lines are allocated to the delivery. The allocations stay, so you can see afterwards which orders are affected.",
  "product.cancelModal.none": "No orders are allocated to the delivery.",
  "product.cancelModal.confirm": "Cancel delivery",
  "product.cancelModal.keep": "Keep",
  "product.affected": "Affected orders",
  "product.order": "Order {number}",
  "product.form.date": "Date",
  "product.form.quantity": "Quantity",
  "product.form.alreadyAllocated": "{count} units are already allocated.",
  "product.form.undo": "Cancel",

  // Delivery orders
  "delivery.notFound": "The delivery doesn’t exist.",
  "delivery.heading": "Delivery {position} · {date}",
  "delivery.readyNone": "All pre-orders were already ready",
  "delivery.ready.one": "1 pre-order marked ready to ship",
  "delivery.ready.other": "{count} pre-orders marked ready to ship",
  "delivery.arrived": "The goods have arrived — ready to ship",
  "delivery.activeLines": "Active order lines",
  "delivery.orders": "Orders",
  "delivery.noOrders": "No orders in this delivery yet.",
  "delivery.col.order": "Order",
  "delivery.col.ordered": "Ordered",
  "delivery.col.promised": "Promised date",
  "delivery.status.ACTIVE": "Active",
  "delivery.status.CANCELLED": "Cancelled",
  "delivery.readyBadge": "Ready to ship",

  // Delivery errors
  "validation.dateMissing":
    "Choose the date you expect to ship the goods. It’s the date customers are promised.",
  "validation.dateInvalid":
    "The date can’t be read. Pick it in the calendar, or write it as YYYY-MM-DD, for example 2027-01-15.",
  "validation.dateNotFuture":
    "The date is today or has passed. Choose a date from tomorrow onwards — it’s the date customers are promised.",
  "validation.quantityInvalid":
    "Write the quantity as a whole number, for example 50 — without commas, spaces or «units».",
  "validation.quantityNotPositive":
    "The quantity must be at least 1: it’s how many you can sell on pre-order in the delivery. To stop selling, cancel the delivery instead.",
  "validation.quantityBelowAllocated":
    "{allocated} units have already been sold in the delivery, so the quantity must be at least {allocated}. To sell fewer, cancel orders in Shopify first.",
  "validation.dateOverlaps":
    "Delivery {position} already has the date {date}. Change the quantity of delivery {position} instead, or choose another date.",
  "validation.dateBeforeExisting":
    "New deliveries are sold after the existing ones, so the date must be after {date} (delivery {position}). If goods arrive earlier, change the date of delivery {position} instead.",
  // Settings
  "settings.heading": "Settings",
  "settings.saved": "Settings saved",
  "settings.error.mode": "Choose a display.",
  "settings.error.empty": "The text can’t be empty.",
  "settings.error.tooLong": "At most {max} characters.",
  "settings.date.heading": "Date in the online store",
  "settings.date.label": "Show the delivery date as",
  "settings.date.shipping": "Expected to ship",
  "settings.date.delivery": "Expected delivery",
  "settings.texts.heading": "Text with the plan in cart and checkout",
  "settings.texts.intro":
    "Shopify shows this text with the pre-order in the cart, at checkout and in the order confirmation. The standard text is translated into the customer’s language automatically; if you write your own, it’s used as it is. You change the texts on the product page and in the cart on the block in the theme editor.",
  "settings.texts.shipping": "Text for expected shipping",
  "settings.texts.delivery": "Text for expected delivery",
  "settings.texts.dateHint": "{date} is replaced by the delivery date.",
  // Event types
  "event.preorder.created": "Pre-order created",
  "event.preorder.delayed": "Pre-order delayed",
  "event.preorder.ready": "Pre-order ready to ship",
  "event.preorder.cancelled": "Pre-order cancelled",
  "event.preorder.payment_failed": "Pre-order: payment declined",
  "event.waitlist.available": "Waitlist: item available",

  // Order processing
  "queue.heading": "Order processing",
  "queue.status.ACTIVE": "Allocated",
  "queue.status.UNRESOLVED": "Unresolved",
  "queue.status.CANCELLED": "Cancelled",
  "queue.topic.CUSTOMERS_DATA_REQUEST": "Data request",
  "queue.topic.CUSTOMERS_REDACT": "Customer erasure",
  "queue.topic.SHOP_REDACT": "Store erasure",
  "queue.topic.ORDERS_CREATE": "New order",
  "queue.topic.ORDERS_UPDATED": "Order updated",
  "queue.topic.ORDERS_CANCELLED": "Order cancelled",
  "queue.topic.REFUNDS_CREATE": "Refund",
  "queue.topic.ORDER_TRANSACTIONS_CREATE": "Payment",
  "queue.waitlistLine":
    "Waitlist: variant {variant} (product {product}), signed up {signedUp}, {notified}",
  "queue.waitlistNotified": "notified {date}",
  "queue.waitlistWaiting": "waiting to be notified",
  "queue.lineUnits": "{count} units",
  "queue.linePromised": "promised {date}",
  "queue.eventSent": "{event} sent to {recipients}",
  "queue.noRecipients": "no recipients",
  "queue.contactEncrypted": " (name and email stored encrypted)",
  "queue.unknownError": "Unknown error.",
  "queue.retried.one": "1 event queued again",
  "queue.retried.other": "{count} events queued again",
  "queue.answered": "Marked as answered",
  "queue.requestMissing": "The request doesn’t exist.",
  "queue.unknownOrder": "Unknown order.",
  "queue.reprocessing": "The order is being processed again",
  "queue.retryAll": "Retry all",
  "queue.pending.one":
    "1 event is waiting to be processed. This normally happens within a minute.",
  "queue.pending.other":
    "{count} events are waiting to be processed. This normally happens within a minute.",
  "queue.data.heading": "Customer data requests",
  "queue.data.intro":
    "A customer has asked the store to see the information stored about them. Here is everything PREAURA stores about the customer’s orders. Name and email are only stored in events sent on the store’s instructions (Flow, webhook, Klaviyo), encrypted and for at most 30 days. Send this to the customer together with the store’s own information, and mark the request as answered. Answered requests are deleted after 30 days.",
  "queue.data.customer": "Customer {id}",
  "queue.data.answered": "Answered {date}",
  "queue.data.waiting": "Waiting for an answer",
  "queue.data.received": "Received {date}",
  "queue.data.nothing.one":
    "PREAURA stores no information about the customer’s order.",
  "queue.data.nothing.other":
    "PREAURA stores no information about the customer’s {count} orders.",
  "queue.data.events": ". Events: {events}",
  "queue.data.markAnswered": "Mark as answered",
  "queue.unresolved.heading": "Unresolved orders",
  "queue.unresolved.none": "All pre-orders have room in a delivery.",
  "queue.unresolved.intro":
    "These order lines are paid, but no delivery had room. Create a delivery with room and process the order again. The orders are tagged «Forudbestilling uafklaret» in Shopify.",
  "queue.col.order": "Order",
  "queue.col.unplaced": "Quantity without room",
  "queue.col.ordered": "Ordered",
  "queue.col.action": "Action",
  "queue.col.quantity": "Quantity",
  "queue.col.status": "Status",
  "queue.col.event": "Event",
  "queue.col.error": "Error",
  "queue.col.received": "Received",
  "queue.reprocess": "Process again",
  "queue.withoutPlan.heading": "Sold without a pre-order plan",
  "queue.withoutPlan.none": "All pre-orders were bought as pre-orders.",
  "queue.withoutPlan.intro.one":
    "1 order in the last 30 days bought an item on pre-order without choosing pre-order — for example a draft order, a POS sale, an order from another app, or because the PREAURA block is missing from the product page. The app counted it in the active delivery so the item isn’t oversold. If it happens often, something in the setup is usually wrong.",
  "queue.withoutPlan.intro.other":
    "{count} orders in the last 30 days bought an item on pre-order without choosing pre-order — for example a draft order, a POS sale, an order from another app, or because the PREAURA block is missing from the product page. The app counted them in the active delivery so the item isn’t oversold. If it happens often, something in the setup is usually wrong.",
  "queue.failed.heading": "Events that failed",
  "queue.failed.none": "No errors.",
  "queue.retry": "Try again",
  // Cancellations
  "releases.heading": "Cancellations",
  "releases.error.window": "Choose a deadline.",
  "releases.error.approval": "Choose how cancellations are approved.",
  "releases.error.number": "Enter a whole number from {min} to {max}.",
  "releases.toast.approved": "The cancellation is approved",
  "releases.toast.rejected": "The request is rejected",
  "releases.toast.retry": "Trying again",
  "releases.toast.releasing": "The units are being released",
  "releases.toast.extended": "The deadline is extended by {count} days",
  "releases.toast.saved": "Settings saved",
  "releases.deliveryLine": "{count} units in delivery {position} ({date})",
  "releases.request.PENDING": "Waiting for you",
  "releases.request.APPROVED": "In progress",
  "releases.request.DONE": "Cancelled",
  "releases.request.REJECTED": "Rejected",
  "releases.request.FAILED": "Failed",
  "releases.issue.OPEN": "Waiting for payment",
  "releases.issue.RELEASING": "Being released",
  "releases.issue.RELEASED": "Released",
  "releases.issue.PAID": "Paid",
  "releases.issue.CLOSED": "Order cancelled",
  "releases.noPayout":
    "The app never pays out money. When a pre-order is cancelled, the order is changed in Shopify without a refund, and the units go back into the delivery. If the customer has paid anything, you refund it yourself in Shopify.",
  "releases.requests.heading": "Requests from customers ({count})",
  "releases.requests.none": "No requests are waiting.",
  "releases.col.order": "Order",
  "releases.col.received": "Received",
  "releases.col.units": "Units",
  "releases.col.action": "Action",
  "releases.col.declined": "Declined",
  "releases.col.releases": "Released",
  "releases.col.delivery": "Delivery",
  "releases.approve": "Approve",
  "releases.reject": "Reject",
  "releases.issues.heading": "Declined payments ({count})",
  "releases.issues.intro":
    "Orders where the payment was declined when you shipped the item (for example an expired card). The customer gets the number of days you chose under Rules to pay. If the customer doesn’t pay, the pre-order is cancelled and the item goes back into the delivery.",
  "releases.issues.none": "No declined payments.",
  "releases.now": "Now",
  "releases.releaseNow": "Release now",
  "releases.extend": "Extend",
  "releases.rules.heading": "Rules",
  "releases.rules.window": "Customers can cancel",
  "releases.rules.untilShipped": "Until the item has shipped",
  "releases.rules.days": "A number of days after ordering",
  "releases.rules.daysLabel": "Days after ordering",
  "releases.rules.daysDetails":
    "Cancellation can’t be turned off completely. Remember the withdrawal rules that apply to your customers.",
  "releases.rules.approval": "Approval",
  "releases.rules.manual": "I always approve myself",
  "releases.rules.auto":
    "Approve automatically within a number of days after ordering",
  "releases.rules.autoLabel": "Automatic approval, days after ordering",
  "releases.rules.autoDetails": "Later cancellations wait for your approval.",
  "releases.rules.grace": "Days to pay if the payment is declined",
  "releases.rules.graceDetails":
    "The customer only pays when you ship the item. If the payment is declined then — for example because the card has expired — the customer gets this many days to pay. If the customer doesn’t pay by then, the pre-order is cancelled and the item goes back into the delivery so someone else can buy it.",
  "releases.rules.link":
    "The customer’s cancellation link is on the order as the metafield {field} and in the events to Klaviyo, Shopify Flow and webhook.",
  "releases.history": "History",
  "releases.history.request": "{order}: {count} units, {date} —",
  "releases.history.retrying": "Retrying: ",
  "releases.history.issue": "{order}: payment declined {date} —",
  // Waitlist
  "waitlist.heading": "Waitlist",
  "waitlist.saved": "Settings saved",
  "waitlist.inStock": "In stock",
  "waitlist.delivery": "Delivery {date}",
  "waitlist.noRecipients.heading": "No recipients are turned on",
  "waitlist.noRecipients.text":
    "Sign-ups are collected, but no notifications are sent until at least one recipient is turned on under",
  "waitlist.waiting.heading": "Waiting to be notified ({count})",
  "waitlist.empty":
    "Nobody has signed up yet. The field is shown on the product page when a variant can neither be bought from stock nor pre-ordered — turn it on in the «Pre-order» block in the theme editor.",
  "waitlist.col.product": "Product",
  "waitlist.col.variant": "Variant",
  "waitlist.col.waiting": "Waiting now",
  "waitlist.col.notified": "Notified",
  "waitlist.how.heading": "How notifications are sent",
  "waitlist.how.text":
    "When a variant can be bought again — because it’s back in stock, or because a delivery with room has opened — the people who signed up are notified in the order they signed up. Each sign-up gets one notification and is then closed. You send the actual message through Shopify Flow or Klaviyo.",
  "waitlist.stable.label": "Waiting time (minutes)",
  "waitlist.stable.details":
    "The item must have been available this long before anything is sent, so a brief change in stock doesn’t trigger notifications.",
  "waitlist.batch.label": "Batch (number at a time)",
  "waitlist.batch.details":
    "This many are notified at a time. Set it to around the number available for sale.",
  "waitlist.interval.label": "Interval (minutes)",
  "waitlist.interval.details":
    "Time between two batches. Before each batch, the app checks that the item can still be bought.",
  "waitlist.only.heading": "Only about the item",
  "waitlist.only.text":
    "The customer asked for the notification, so it may be sent without consent — but only if it’s about the item. If you add offers, other products or discount codes, it becomes marketing and needs consent (in Denmark, section 10 of the Marketing Practices Act). The sign-up must not be used for newsletters.",
  // Events
  "events.heading": "Events",
  "events.toast.confirmed": "Confirmed",
  "events.toast.unconfirmed": "Confirmation removed",
  "events.toast.flowOn": "Flow turned on",
  "events.toast.flowOff": "Flow turned off",
  "events.toast.urlSaved": "The address is saved",
  "events.toast.urlRemoved": "The address is removed",
  "events.toast.webhookOn": "Webhook turned on",
  "events.toast.webhookOff": "Webhook turned off",
  "events.toast.secret": "New signing key created",
  "events.toast.keySaved": "The key is saved",
  "events.toast.keyRemoved": "The key is removed",
  "events.toast.klaviyoOn": "Klaviyo turned on",
  "events.toast.klaviyoOff": "Klaviyo turned off",
  "events.toast.retried.one": "1 delivery is being sent again",
  "events.toast.retried.other": "{count} deliveries are being sent again",
  "events.status.DONE": "Sent",
  "events.status.FAILED": "Failed",
  "events.status.PENDING": "Waiting",
  "events.waitlistRef": "Waitlist",
  "events.intro":
    "PREAURA sends an event when something happens to a pre-order: created, delayed, ready to ship, cancelled or payment declined — and when an item on the waitlist can be bought again. Each event contains the store, the customer’s name and email, order number, product and variant, quantity, the delivery date, the previous date if it changed, and a unique id. The content is the same for every recipient — you build the email.",
  "events.responsibility.heading": "Responsibility for customer data",
  "events.responsibility.warning":
    "Webhook and Klaviyo pass the customer’s name and email on to a third party. The store is responsible for having a lawful basis for this (for example consent or the customer’s order) and for its own agreement with the recipient. PREAURA only sends on the store’s instructions and is a data processor — not the sender.",
  "events.responsibility.label":
    "The store has a basis for sending customer data to the recipients it turns on below",
  "events.responsibility.accepted":
    "Confirmed {date}. If the confirmation is removed, webhook and Klaviyo are turned off.",
  "events.responsibility.required":
    "Required to turn on webhook and Klaviyo. Shopify Flow doesn’t require it — the data stays in Shopify.",
  "events.flow.label": "Send events to Shopify Flow",
  "events.flow.details":
    "Each event is a trigger in Flow, for example «Pre-order created» and «Pre-order ready to ship». Build a workflow in the Flow app, for example an email or a tag when the order is ready.",
  "events.webhook.intro":
    "The app sends the event as JSON with POST to your address. Use it for Zapier, Make, Drip, Omnisend, Mailchimp or Brevo, for example.",
  "events.webhook.saved": "Address saved: ••••{last4}",
  "events.remove": "Remove",
  "events.webhook.newUrl": "New address",
  "events.webhook.url": "Address",
  "events.webhook.save": "Save address",
  "events.webhook.label": "Send events to the webhook",
  "events.webhook.secret": "Signing key",
  "events.webhook.signature":
    "Every call has the header {header}: HMAC-SHA256 of the raw body of the call with this key, base64-encoded. Compute it yourself and compare — then you know the call comes from PREAURA. The header X-Preaura-Event-Id is the event’s id; use it to ignore repeats.",
  "events.webhook.newSecret": "Create a new signing key",
  "events.klaviyo.intro":
    "Events are sent to Klaviyo as metrics, for example «PREAURA: Forudbestilling klar til afsendelse», on the customer’s profile. Klaviyo creates the metric the first time, and it can be used as a trigger in a flow. Use a private API key with access to Events (Settings → API keys in Klaviyo).",
  "events.klaviyo.saved": "Key saved: ••••{last4}",
  "events.klaviyo.newKey": "New private API key",
  "events.klaviyo.key": "Private API key",
  "events.klaviyo.save": "Save key",
  "events.klaviyo.label": "Send events to Klaviyo",
  "events.encryption.heading": "The encryption key is missing",
  "events.encryption.text":
    "The server is missing the environment variable PREAURA_ENCRYPTION_KEY. Without it, events can’t be built, and keys and addresses can’t be saved. On Render: preaura → Environment, or Manual sync on the blueprint.",
  "events.waiting.heading": "Waiting to be sent",
  "events.waiting.intro":
    "These events haven’t been sent yet. That normally happens within a minute. If there’s an error, the app tries again every minute.",
  "events.col.event": "Event",
  "events.col.reference": "Order / product",
  "events.col.created": "Created",
  "events.col.error": "Error",
  "events.col.recipient": "Recipient",
  "events.col.time": "Time",
  "events.col.status": "Status",
  "events.col.message": "Message",
  "events.col.action": "Action",
  "events.failed.heading": "Failed deliveries",
  "events.failed.none": "No errors.",
  "events.failed.intro":
    "These events couldn’t be delivered, not even after 10 attempts with increasing waits (up to about 8 hours). Fix the cause and try again. The event’s data is deleted after 30 days.",
  "events.retryAll": "Retry all",
  "events.retry": "Try again",
  "events.dataDeleted": "Data deleted",
  "events.log.heading": "Log",
  "events.log.none":
    "No events yet. They’ll appear when a customer pre-orders.",
  "events.attempts": " ({count} attempts)",
  "events.others.heading": "Drip, Omnisend, Mailchimp, Brevo and others",
  "events.others.zapier":
    "Use the webhook. With Zapier: create a Zap with the trigger «Webhooks by Zapier → Catch Hook» and paste Zapier’s address above. Send a pre-order through so Zapier can see the fields, then choose your email system as the next step, for example «Add/Update Subscriber» with customer.email, and a tag or event based on type (for example preorder.ready).",
  "events.others.make":
    "With Make: create a scenario with the «Webhooks → Custom webhook» module, paste Make’s address above, and continue with your email system’s module. The fields are the same.",
};
