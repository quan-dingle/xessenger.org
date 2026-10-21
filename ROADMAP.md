# Xessenger roadmap

## In progress / not yet implemented

- **Confidential rooms: real end-to-end encryption.** Design and review browser-side authenticated encryption, per-room key generation, secure key sharing/revocation, device recovery, and migration behavior before enabling it. The server must never receive room keys or plaintext for these rooms. Until that ships, the server rejects manual member additions to rooms labelled `Confidential`; do not treat the label as a security guarantee.
- **Top-Secret rooms.** Intentionally left to the project owner.
- **Push delivery configuration and end-to-end test.** Browser opt-in and a local service-worker test notification are implemented. Actual background push delivery still requires valid `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` environment variables on the deployed process, then a real push test from a second account/device.
- **Room configuration.** Rename rooms, edit descriptions/privacy, rotate/revoke public invite links, and transfer admin ownership.
- **Admin panel.** Account/room moderation and administrative audit history.
- **Chat stream/history cleanup.** The existing comments note that history loading should move from `/stream` to `/history`; currently `/stream` still sends the buffered history.
- **Room selector UX.** Improve navigation for users with many rooms.
- **Embed support.** TikTok/Reels improvements and the existing TODO for a successful animation after room creation.
- **Account recovery.** Email verification and password-reset delivery need a configured mail provider.

## Completed in this deployment

- Editable display name, short bio, and profile picture.
- Public room invite links and authenticated joining by invite link.
- Server-side admin-only enforcement for manually adding room members.
- Push opt-in moved out of the scrolling chat, with retry/error feedback and a service-worker test notification.
