# Etherius EmailGuard

Etherius EmailGuard is a Chrome extension built to help users detect suspicious emails before they turn into scams, credential theft, or payment fraud. It is designed for real customer use, with a lightweight inbox-side workflow that scans opened emails inside Gmail and Outlook and surfaces clear risk guidance directly where the user is reading mail.

## Why EmailGuard matters

Modern inbox attacks rarely look like obvious spam anymore. Many campaigns are polished, urgent, and targeted:

- fake internship and job offer scams
- phishing emails that imitate trusted brands
- invoice and payment redirection fraud
- impersonation attempts using lookalike domains
- messages that pressure the user into quick action

EmailGuard helps reduce those risks by analyzing the opened message context and presenting fast, readable warnings without forcing users into a complicated security workflow.

## Core benefits

- In-page scanning for Gmail and Outlook
- Fast manual scan from the extension popup
- Automatic scan support when a new email is opened
- Risk-level output designed for non-technical users
- Clear phishing and scam guidance directly inside the inbox
- Local settings storage for simple customer deployment
- Clean onboarding flow for first-time users
- Ready-to-brand Etherius extension identity and icon set

## What the extension does

When a user opens an email on a supported mail platform, EmailGuard can:

- extract the sender, subject, domain, and message body preview
- send the email context to the configured analysis API
- score the message risk level
- show an in-page alert banner for suspicious or dangerous mail
- display a compact safe indicator for low-risk mail
- keep a recent local scan history for quick review in the popup

## Supported platforms

- Gmail: `https://mail.google.com/*`
- Outlook Web: `https://outlook.live.com/*`
- Outlook 365 Web: `https://outlook.office.com/*`

## Repository structure

```text
Mail-guard-tool/
|- manifest.json
|- background.js
|- content.js
|- content.css
|- popup.html
|- popup.js
|- onboarding.html
|- settings.html
|- icons/
|  |- icon16.png
|  |- icon48.png
|  `- icon128.png
`- README.md
```

## Customer usage

### For customers

1. Download or clone the repository.
2. Extract the extension files if needed.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the `Mail-guard-tool` folder.
7. Pin the extension in Chrome.
8. Open Gmail or Outlook and start scanning emails.

### First-time flow

1. Install the extension.
2. The onboarding screen opens automatically.
3. Click **Start Protecting My Inbox**.
4. Open the popup if you want to save a customer license key.
5. Keep auto-scan enabled for the smoothest experience.

### Manual scan flow

1. Open a message in Gmail or Outlook.
2. Click the EmailGuard extension icon.
3. Select **Scan Current Email**.
4. Review the risk result, summary, and recommended next step.

## Settings

The extension ships with a customer-friendly settings page where you can:

- enable or disable auto-scan
- mark onboarding as completed
- save or clear the customer license key
- review supported mail surfaces and usage guidance

## Notes for deployment

- Customer settings and recent scan history are stored in Chrome local storage.
- The current analysis request is handled in `background.js`.
- The configured API endpoint is:

```text
https://etherius-api.vercel.app/api/scan
```

If your production API changes, update that value in `background.js`.

## Improvements included in this repo cleanup

- fixed a broken missing options page reference
- added a real `settings.html` page
- replaced broken text encoding with clean readable copy
- improved popup UX and manual scan feedback
- improved onboarding experience
- regenerated a cleaner extension icon set
- cleaned manifest structure for Chrome Manifest V3 compatibility

## Positioning

Etherius EmailGuard is not just a basic spam checker. It is part of the broader Etherius security vision: practical user-facing defenses that help organizations reduce day-to-day breach risk where employees are most exposed.
