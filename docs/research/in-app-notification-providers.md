# In-app notification providers for Cadence

Research for issue #2. Researched 2026-11-11 against official docs and pricing pages. Pricing and SDK details change often, so re-check the cited pages before committing to anything.

**Scope.** Cadence wants **in-app notifications only**, delivered by a third-party provider that is the **single source of truth**: Cadence stores no copy of notifications in SQLite. Live updates are nice to have, and a refresh on reload is acceptable. Email later is a nice-to-have. This document compares the options. It does **not** pick one; that is the job of a separate grilling ticket (#3).

## What these products are

All five candidates are "notification infrastructure" services. They work roughly the same way:

1. Cadence's **server** calls the provider's API to trigger a notification for a recipient. For example: "Refund Request approved, send to Student 42". The provider runs a *workflow* (some call it a template), which decides which channels to send on (in-app, email, and so on), applies the user's preferences, and stores the message.
2. The provider **stores the in-app feed** for every user. This is what makes the provider the single source of truth.
3. Cadence's **browser UI** renders a prebuilt React component, usually a bell with an unread badge that opens a feed. The component talks **directly** to the provider's API from the browser, not through Cadence's server.
4. The browser has to prove *which* user it is, so the feed can't be read by someone who guesses another user's ID. To do this, Cadence's server signs a token, or a hash, with a secret and hands it to the page. The section [How recipients authenticate to the feed](#how-recipients-authenticate-to-the-feed) covers the details.

Adding email later usually means connecting an email provider (SendGrid, Postmark, SES, and so on) in the provider's dashboard and adding an email step to the workflow. Cadence's trigger code stays the same.

### The candidates

- **Knock** ([knock.app](https://knock.app)) is a polished, developer-focused, cloud-only service. It has a strong preferences model, signs tokens with JWT/RS256, and has a generous free tier, but its paid tier is expensive.
- **Novu** ([novu.co](https://novu.co)) is an **open-source** (MIT core) notification platform with a cloud offering. It is the only candidate with a realistic self-hosting story. Its `<Inbox />` component includes a bell, feed, and preferences out of the box. It has the cheapest entry paid tier.
- **MagicBell** ([magicbell.com](https://www.magicbell.com)) started life as an "embeddable notification inbox" and is now multichannel. It has prebuilt Inbox and UserPreferences React components. Its free tier is small (1,000 deliveries a month).
- **Courier** ([courier.com](https://www.courier.com)) is a large multichannel platform with a strong email and template focus. It has prebuilt Inbox, Toast, and Preferences React components, and the clearest documentation on SSR ("renders client-side only"). It charges pay-as-you-go after a free tier.
- **SuprSend** ([suprsend.com](https://www.suprsend.com)) is a multichannel platform with a mid-priced tier. Its in-app inbox is free on all plans, but **user preferences start at the $250/month Business tier**.

Other options worth knowing about but not researched in depth: **Engagespot** (similar product category), and the do-it-yourself route with a realtime pub/sub service such as Pusher or Ably. The DIY route was excluded because Cadence would then have to store the notifications itself, which breaks the single-source-of-truth requirement.

## Comparison table

| | Knock | Novu | MagicBell | Courier | SuprSend |
|---|---|---|---|---|---|
| **React package** | `@knocklabs/react` [^knock-react] | `@novu/react` [^novu-inbox] | `@magicbell/react` [^mb-react] | `@trycourier/courier-react` [^courier-react] | `@suprsend/react` [^ss-react] |
| **Prebuilt feed UI** | Yes: `NotificationIconButton` (bell), `NotificationFeedPopover`, `NotificationFeed` [^knock-react] | Yes: `<Inbox />` with Bell, Notifications, and Preferences [^novu-inbox] | Yes: `FloatingInbox`, `Inbox` [^mb-react] | Yes: `CourierInbox`, `CourierInboxPopupMenu`, `CourierToast` [^courier-react] | Yes: `Inbox` (bell and popover), `NotificationFeed` [^ss-search] |
| **Prebuilt preferences UI** | No component. Hooks plus guide for a custom center, or a hosted preference page [^knock-react] [^knock-prefs] | Yes, inside `<Inbox />` [^novu-inbox] | Yes: `UserPreferences` [^mb-react] | Yes: `CourierPreferences` [^courier-react] | Yes (preferences feature needs the Business plan) [^ss-pricing] |
| **SSR / React Router v7** | No RR7-specific docs. Ships `next` and `tanstack` entry points, none for RR [^knock-pkg]. Render client-only (see below) | No SSR docs. Next.js example uses `'use client'` [^novu-next]. Render client-only | No SSR docs [^mb-react]. Render client-only | Docs: "support Next.js but render client-side only" [^courier-react]. Render client-only | No SSR docs found. Render client-only |
| **Real-time** | Yes, socket-based real-time feed [^knock-feed] | Yes: live unread counts and sync [^novu-inbox] (self-host runs a separate WS service [^novu-selfhost]) | Yes: "persistent connection … appears instantly … without requiring a page refresh" [^mb-inapp] | Yes, over WebSocket [^courier-react] | Yes, socket connection in web SDK [^ss-search] |
| **Per-user preferences / muting** | Opt out per workflow, category, or channel type [^knock-prefs] (all plans [^knock-pricing]) | Per workflow and channel, managed from the Inbox [^novu-inbox] | Per category and channel [^mb-react] | Topic subscriptions via preference center [^courier-react] | **Business plan ($250/mo) and above** [^ss-pricing] |
| **Email later** | Yes, multichannel | Yes; Free plan already lists email [^novu-pricing] | Yes; each channel counts as a delivery [^mb-pricing] | Yes (email is a core strength) | Yes; unlimited channels on Free [^ss-pricing] |
| **Feed auth** | Signed **JWT, RS256**, `sub` = user ID, default 1h expiry. Enforced by "enhanced security mode" [^knock-auth] | **HMAC-SHA256** of `subscriberId` with secret key, passed as `subscriberHash`. Doesn't expire [^novu-hmac] | Backend-generated **User JWT** from project secret key, sent as Bearer token [^mb-auth] | Backend-minted **scoped JWT**. Never expires unless `expires_in` is set; SDK doesn't refresh [^courier-auth] | Signed **JWT, ES256**, `entity_id` = user ID. Enforced only in "Enhanced Security Mode" (off in Sandbox) [^ss-auth] |
| **Self-hosting** | Not offered [^knock-pricing] | **Yes.** MIT core, with an enterprise folder under a commercial license [^novu-gh]. Community self-host loses some cloud-only features [^novu-selfhost] | Not offered [^mb-pricing] | Not offered [^courier-pricing] | Enterprise only (self-hosted / BYOC, beta) [^ss-pricing] |
| **Free tier** | 10,000 messages/mo, no card, no hard cap [^knock-pricing] | 10,000 workflow runs/mo, 5 workflows, 24h activity retention [^novu-pricing] | 1,000 deliveries/mo [^mb-pricing] | 10,000 sends/mo [^courier-pricing] | 10,000 notifications/mo, SuprSend branding on inbox [^ss-pricing] |
| **First paid tier** | Starter **$250/mo** incl. 50k, then $0.005/msg [^knock-pricing] | Pro **from $30/mo**, 30k+ runs, ~$1.20 per 1k extra [^novu-pricing] | Startup **$249/mo** incl. 50k, then $0.0025 [^mb-pricing] | Business **$0.005/send**, pay-as-you-go [^courier-pricing] | Essentials **$100/mo** incl. 50k (no preferences). Business **$250/mo** [^ss-pricing] |

How the units are counted: Knock, MagicBell, and SuprSend count **one unit per recipient per channel** [^knock-pricing] [^mb-pricing] [^ss-pricing]. Novu counts **workflow runs** [^novu-pricing]. Courier's pricing page doesn't define a "send" [^courier-pricing]. For in-app-only use at Cadence's likely scale, all five free tiers should cover early volume, except perhaps MagicBell's 1,000.

## How recipients authenticate to the feed

Every provider has a **public** key that sits in the browser. On its own, that key would let anyone read any user's feed if they could guess the user ID. Knock says plainly that without enhanced security, the public key "can act as any user" [^knock-auth]. Novu warns that an attacker "could potentially guess another subscriber's `subscriberId`" [^novu-hmac]. So the **Cadence server must sign something per user**, and the page passes it to the component. Cadence already has a server-side session (the DevUI user switcher puts a user in it), so a React Router `loader` could compute this value and return it to the page.

- **JWT** (Knock, MagicBell, Courier, SuprSend). The server signs a short-lived token naming the user. The JWT can expire, and some providers can scope it (for example Courier's scopes, or SuprSend's tenant scope). Expiry handling varies:
  - Knock has an `onUserTokenExpiring` hook for refreshing [^knock-auth], and SuprSend has a `refreshUserToken` callback [^ss-search].
  - Courier's SDK does **not** refresh, and a token minted without `expires_in` **never expires** [^courier-auth].
- **HMAC hash** (Novu). The server computes `HMAC-SHA256(subscriberId, secret)` [^novu-hmac]. It is simpler, needs no JWT library, and the value can even be cached. The trade-off is that the hash never changes, so a leaked hash gives permanent access to that user's feed unless the secret key is rotated. SuprSend has moved away from this approach: its auth was "upgraded from HMAC `subscriber_id` to signed JWT user tokens for better security" [^ss-react].
- **Gotcha:** Knock and SuprSend only *enforce* the signed token when "enhanced security mode" is switched on [^knock-auth] [^ss-auth]. SuprSend notes it is off in Sandbox, so a broken token can appear to work there [^ss-search]. Novu enforces HMAC once it is enabled, and the Inbox won't load without the hash [^novu-hmac].

## React Router v7 SSR

None of the providers document React Router v7 or Remix. Here is what the docs do say:

- Courier is explicit that its components "render client-side only" [^courier-react].
- Novu's Next.js example marks the Inbox file `'use client'` [^novu-next].
- Knock ships Next.js and TanStack Router helper entry points as optional peer dependencies, but none for React Router [^knock-pkg].

*Inference, not from a provider doc:* each of these components opens a browser socket and reads browser state, so in Cadence the safe pattern is to **render the bell/feed only on the client**. For example, mount it after hydration, using a `useEffect`-gated wrapper or a "ClientOnly" component, and server-render a placeholder bell. The signed token or hash can still come from the route `loader` on the server. With this pattern, SSR compatibility doesn't decide between the providers. It is the same small amount of glue work for all of them. A quick prototype would confirm it.

## Notable trade-offs

- **Cost cliff.** Every provider's free tier covers early volume, but the first paid step differs a lot: Novu from $30/mo, SuprSend $100/mo (without preferences), Courier pay-as-you-go at $0.005/send, and Knock, MagicBell, and SuprSend Business at about $250/mo.
- **Self-hosting.** Only Novu is realistically self-hostable [^novu-gh]. It is not lightweight: the API, Worker, WS, and Dashboard services, plus MongoDB, Redis (with AOF), and S3-compatible storage. Even the single-VM option needs 4 vCPUs and 8 GB of RAM [^novu-selfhost]. Some features are cloud-only [^novu-selfhost].
- **Preferences UI out of the box.** Novu, MagicBell, and Courier ship prebuilt preference UIs. Knock gives you hooks plus a hosted page, so you build the UI yourself. SuprSend has a prebuilt preferences UI, but the preferences feature is paywalled at Business [^ss-pricing].
- **Auth hygiene.** JWT providers allow expiring tokens, which is better practice. Novu's HMAC is simpler but static. Courier's tokens are non-expiring by default, so remember to set `expires_in`.
- **Retention.** Knock says in-app feed retention is "unlimited but configurable" on all plans [^knock-pricing]. This matters because the provider is the source of truth. The other pricing pages mostly talk about *log/activity* retention (Novu 24h on Free [^novu-pricing], SuprSend 30 days on Free [^ss-pricing]), which is not the same thing as how long a user's feed items persist. Confirm feed retention directly before choosing.
- **Branding.** SuprSend Free shows SuprSend branding on the inbox [^ss-pricing]. Knock's Starter plan lists "removal of Knock branding" [^knock-pricing], which implies Free shows Knock branding. Novu Pro "removes Novu branding" [^novu-pricing].

## Which look strongest (not a decision)

- **Novu** looks strongest on cost and flexibility: the cheapest paid tier, the only self-host escape hatch, and an all-in-one `<Inbox />` with preferences built in. Weak points are its short activity retention on Free and its static HMAC auth.
- **Knock** looks strongest on developer experience and preferences modelling: JWT auth with refresh, a rich preference model on every plan, unlimited feed retention, and a generous free tier. Weak points are the $250/mo first paid tier and the lack of a prebuilt preferences component.
- **Courier** has the clearest SSR guidance and prebuilt preferences, plus pay-as-you-go pricing. It is a good fit if email becomes important later.
- **MagicBell** and **SuprSend** look weaker for Cadence. MagicBell has a small free tier and a $249 jump. SuprSend paywalls preferences at $250/mo.

## Sources

[^knock-pricing]: Knock pricing, https://knock.app/pricing
[^knock-auth]: Knock, "Security and authentication", https://docs.knock.app/in-app-ui/security-and-authentication
[^knock-react]: Knock React overview, https://docs.knock.app/in-app-ui/react/overview
[^knock-feed]: Knock React feed, https://docs.knock.app/in-app-ui/react/feed
[^knock-prefs]: Knock preferences overview, https://docs.knock.app/preferences/overview
[^knock-pkg]: `@knocklabs/react` package.json (v0.15.1, peerDependencies), https://unpkg.com/@knocklabs/react/package.json
[^novu-pricing]: Novu pricing, https://novu.co/pricing
[^novu-inbox]: Novu Inbox overview, https://docs.novu.co/platform/inbox/overview
[^novu-hmac]: Novu, "Prepare for production" (HMAC), https://docs.novu.co/platform/inbox/prepare-for-production
[^novu-next]: Novu Next.js quickstart, https://docs.novu.co/platform/quickstart/nextjs
[^novu-selfhost]: Novu self-hosting overview, https://docs.novu.co/community/self-hosting-novu/overview
[^novu-gh]: Novu GitHub repository README (license), https://github.com/novuhq/novu
[^mb-pricing]: MagicBell pricing, https://www.magicbell.com/pricing
[^mb-react]: MagicBell React library, https://www.magicbell.com/docs/libraries/react
[^mb-inapp]: MagicBell in-app channel, https://www.magicbell.com/docs/channels/in_app
[^mb-auth]: MagicBell API authentication, https://www.magicbell.com/docs/api/authentication
[^courier-pricing]: Courier pricing, https://www.courier.com/pricing
[^courier-react]: Courier React SDK, https://www.courier.com/docs/sdk-libraries/courier-react-web
[^courier-auth]: Courier Inbox authentication, https://www.courier.com/docs/platform/inbox/authentication
[^ss-pricing]: SuprSend pricing, https://www.suprsend.com/pricing
[^ss-react]: SuprSend React inbox page, https://docs.suprsend.com/docs/inbox-react
[^ss-auth]: SuprSend client authentication, https://docs.suprsend.com/docs/client-authentication
[^ss-search]: SuprSend React inbox integration docs (search excerpts covering `Inbox`/`NotificationFeed`, ES256 token, `refreshUserToken`, sockets, Sandbox enforcement), https://docs.suprsend.com/docs/react-inbox-integration and https://docs.suprsend.com/docs/inbox-quick-start
