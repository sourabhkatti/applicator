# Peebo - Job Application Automation Chrome Extension

Peebo is a Chrome extension that helps you apply to jobs automatically with ATS-optimized resumes and application tracking.

## Features

- **Autonomous job applications** via browser-use Cloud API
- **ATS resume optimization** for each job
- **Application tracking** in a kanban-style interface
- **Job detection** on major ATS platforms (Greenhouse, Lever, Ashby, Workday, etc.)
- **Usage limits** with free tier (5 apps/month) and premium (unlimited)

## Project structure

```
peebo-extension/
├── manifest.json              # Chrome extension manifest (v3)
├── popup/                     # Extension popup
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── tracker/                   # Full-page kanban tracker
│   ├── tracker.html
│   ├── tracker.js
│   └── tracker.css
├── background/
│   └── service-worker.js      # Background service worker
├── onboarding/                # Setup wizard
│   ├── onboarding.html
│   ├── onboarding.js
│   └── onboarding.css
├── content/                   # Content scripts
│   ├── job-detector.js        # Detects job pages
│   └── job-detector.css
└── assets/
    ├── design-system.css      # Shared CSS tokens & components
    └── mascot/                # Peebo bird mascot SVGs
        ├── peebo-idle.svg
        ├── peebo-working.svg
        ├── peebo-success.svg
        ├── peebo-error.svg
        └── peebo-sleeping.svg
```

## Development setup

### Prerequisites

1. Chrome browser
2. Supabase project with peebo tables (see `/supabase/migrations/`)
3. Environment configuration

### Configuration

Update these values in the extension files:

**In `popup/popup.js`, `background/service-worker.js`, `onboarding/onboarding.js`:**
```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

**In `manifest.json`:**
```json
"oauth2": {
  "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
}
```

### Generate icons

See `assets/mascot/ICONS.md` for instructions on generating PNG icons from SVG.

### Load the extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `peebo-extension` directory
5. The Peebo icon should appear in your toolbar

## Supabase infrastructure

The extension requires these Supabase components:

### Tables (in `supabase/migrations/`)
- `peebo_users` - User profiles and subscription info
- `peebo_applications` - Tracked job applications
- `peebo_usage_logs` - Analytics and usage tracking

### Edge Functions (in `supabase/functions/`)
- `peebo-proxy` - Proxies requests to browser-use Cloud with master API key
- `peebo-checkout` - Creates Stripe checkout sessions for premium upgrade
- `peebo-webhook` - Handles Stripe webhook events
- `peebo-sync-apps` - Syncs applications between extension and Supabase

### Environment secrets

Set these in your Supabase project:
```
PEEBO_BROWSER_USE_KEY=bu_xxx
PEEBO_STRIPE_SECRET_KEY=sk_live_xxx
PEEBO_STRIPE_WEBHOOK_SECRET=whsec_xxx
```

## Design system

Peebo uses a warm, cozy theme with these key colors:

- Primary: `#FFD93D` (Peebo Yellow)
- Background: `#FFF8E7` (Cream)
- Text: `#3D3428` (Warm Charcoal)
- Success: `#69F0AE` (Mint Green)
- Error: `#FF8A80` (Soft Coral)

See `assets/design-system.css` for the full token system.

## User flows

1. **Install → Onboarding**: Extension opens wizard for resume upload and preferences
2. **Apply from popup**: Paste URL → Click Apply → Progress updates → Toast notification
3. **Apply from page**: On job posting → Click extension → "Apply to this job" detected
4. **View tracker**: Click extension → "Open Tracker" → Full-page kanban

## Supported ATS platforms

- Greenhouse
- Lever
- Ashby
- Workday / MyWorkdayJobs
- iCIMS
- Jobvite
- SmartRecruiters
- LinkedIn Jobs

## License

Private - Peebo Cloud distribution only.
