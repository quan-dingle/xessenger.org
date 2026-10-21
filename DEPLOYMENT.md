# Xessenger branch deployment

This branch keeps the existing Node HTTP server and browser-native frontend. No application framework was added.

## Start a separate instance

Node.js 18 or newer is required. Runtime files (database.json, rooms.json, accounts.json, uploads.json, uploads/, history.json) are intentionally ignored by Git. Missing databases are initialized with an empty account store and a public global room.

    PORT=5011 npm start

Behind a TLS-terminating reverse proxy, forward X-Forwarded-Proto: https so session cookies receive the Secure flag. The server binds to localhost.

## Push notifications

Push notifications are disabled until these environment variables are configured: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and optionally VAPID_SUBJECT. The old private key was embedded in source; it is no longer shipped in this branch. Generate and configure a fresh VAPID keypair before enabling push notifications.

## Accounts and old rooms

On first request the server imports current legacy user records into accounts.json. Imported accounts use the “Link an existing token” flow once to set a password; room membership and existing room IDs are retained. New sign-in creates a high-entropy client session token stored as an HttpOnly cookie and maps it to an account ID. The browser never receives the account's internal room key.

## Files and previews

Uploads are limited to 50 MiB and stored outside the public directory under random IDs. /download/:id requires an authenticated session and forces download; /media/:id is limited to image, audio, video and PDF MIME types. TikTok, Instagram, and YouTube embeds are loaded client-side only after clicking an embed button. Other links remain safe external cards.
