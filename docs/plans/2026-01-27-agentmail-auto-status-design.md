# AgentMail Auto-Status Updates

## Overview

Automatically update job application statuses when emails arrive (rejections, interview requests, confirmations). The Chrome extension polls AgentMail directly - no Supabase relay needed, keeping customer data local.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome Extension (background service worker)                   │
│                                                                 │
│  AgentMailSync module:                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Poll AgentMail API every 60 seconds                  │   │
│  │ 2. Fetch new messages since last sync                   │   │
│  │ 3. Classify each email (confirmation/rejection/interview)│   │
│  │ 4. Match to existing application by company+role        │   │
│  │ 5. Update application status in chrome.storage.local   │   │
│  │ 6. Show desktop notification                            │   │
│  │ 7. Broadcast update to open tracker tabs                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Email Classification

| Type | Action | Detection Patterns |
|------|--------|-------------------|
| `confirmation` | Set `email_verified: true` | "thank you for applying", "received your application", "thanks for applying" |
| `rejection` | Move to `status: rejected` | "decided not to move forward", "other candidates", "position filled", "no longer available" |
| `interview` | Move to `status: interviewing`, add interview entry | "schedule an interview", "like to speak with you", "next steps", "invite you to" |
| `unknown` | No auto-action, log for review | Everything else |

## Data Flow

1. **User onboarding**: Peebo provisions AgentMail inbox (`userXYZ@agentmail.to`)
2. **User applies**: Application stored in `chrome.storage.local` with company, role, status
3. **Email arrives**: AgentMail receives email from company
4. **Extension polls**: Fetches new messages from AgentMail API
5. **Classification**: Determines email type from subject/body
6. **Matching**: Finds application by normalizing company name
7. **Update**: Changes status and adds notes with timestamp
8. **Notification**: Desktop notification + tracker UI refresh

## API Integration

AgentMail API endpoints used:
- `GET /v0/inboxes/{inbox_id}/messages` - Fetch messages
- `GET /v0/inboxes/{inbox_id}/messages/{message_id}` - Get full message body if needed

Authentication: Bearer token stored in `chrome.storage.local` (encrypted by Chrome)

## Storage Schema

```javascript
// chrome.storage.local
{
  peeboUser: {
    // ... existing user data
    agentmail_inbox_id: "userXYZ@agentmail.to",
    agentmail_api_key: "am_xxx..."  // Per-user or org-wide key
  },
  agentmailSyncState: {
    last_sync_at: "2026-01-27T16:00:00Z",
    processed_message_ids: ["msg1", "msg2", ...]
  },
  applications: [
    {
      id: "...",
      company: "Acme Corp",
      role: "Senior PM",
      status: "applied",  // → "rejected" or "interviewing"
      email_verified: false,  // → true on confirmation
      // ...
    }
  ]
}
```

## Notification Examples

- **Confirmation**: "✅ Acme Corp confirmed your application"
- **Rejection**: "📧 Update from Acme Corp - Application closed"
- **Interview**: "🎉 Acme Corp wants to schedule an interview!"

## Error Handling

- API failures: Retry next poll cycle, no user notification
- Rate limiting: Back off to 5-minute intervals temporarily
- Missing inbox: Prompt user to complete onboarding
- Unmatched email: Log but don't auto-update (user can manually link)

## Testing

1. Apply to test job via Peebo
2. Send test email to user's AgentMail inbox
3. Verify status updates within 60 seconds
4. Verify notification appears
5. Verify tracker UI reflects change

---

# Implementation Plan

## Task 1: Add AgentMail sync module to service worker

**Files:** `peebo-extension/background/service-worker.js`

**Steps:**
1. Add AgentMail API configuration constants
2. Create `startAgentMailSync()` function that runs on extension startup
3. Create `pollAgentMail()` function that fetches new messages
4. Create `classifyEmail(subject, preview, body)` function
5. Create `matchApplicationByCompany(company)` function
6. Create `updateApplicationStatus(appId, newStatus, notes)` function
7. Set up 60-second interval with `chrome.alarms` API
8. Handle alarm events to trigger polling

**Verification:** Console logs show polling activity and classification results

## Task 2: Add email classification logic

**Files:** `peebo-extension/background/service-worker.js`

**Steps:**
1. Define keyword patterns for each email type (confirmation, rejection, interview)
2. Implement `extractCompanyFromSender(fromAddress)` - reuse existing pattern
3. Implement `extractRoleFromEmail(subject, preview)`
4. Add fuzzy company name matching (handle "Acme" vs "Acme Corp" vs "Acme, Inc.")
5. Return classification result with confidence indicator

**Verification:** Test with sample email subjects/previews covering all types

## Task 3: Update application status on email events

**Files:** `peebo-extension/background/service-worker.js`

**Steps:**
1. On confirmation: Set `email_verified: true`, add timestamped note
2. On rejection: Set `status: 'rejected'`, add note with email preview
3. On interview: Set `status: 'interviewing'`, add interview entry with "TBD" date, add note
4. Broadcast `APPLICATION_UPDATED` message to tracker tabs
5. Create desktop notification with appropriate icon/message

**Verification:** Apply to test company, send test emails, verify status changes

## Task 4: Add sync state management

**Files:** `peebo-extension/background/service-worker.js`

**Steps:**
1. Load `agentmailSyncState` from storage on startup
2. Track `processed_message_ids` to avoid reprocessing
3. Update `last_sync_at` after each successful poll
4. Persist state to `chrome.storage.local` after each poll
5. Limit processed_message_ids array to last 500 to avoid bloat

**Verification:** Restart extension, verify it doesn't reprocess old emails

## Task 5: Update tracker UI to show sync status

**Files:** `peebo-extension/tracker/tracker.js`, `peebo-extension/tracker/tracker.html`

**Steps:**
1. Add "Last synced: X minutes ago" indicator in header
2. Add manual "Sync now" button
3. Listen for `APPLICATION_UPDATED` broadcasts and refresh affected cards
4. Show toast notification when status changes from email

**Verification:** Open tracker, trigger email update, see real-time card movement

## Task 6: Handle AgentMail inbox provisioning

**Files:** `peebo-extension/onboarding/onboarding.js`

**Steps:**
1. During onboarding, call Peebo backend to provision AgentMail inbox
2. Store `agentmail_inbox_id` in user profile
3. Store API key or use org-wide key with inbox scoping
4. Show user their application email address to use

**Verification:** New user onboarding creates inbox, displays email address

## Verification Checklist

- [ ] Extension polls AgentMail every 60 seconds when running
- [ ] Confirmation emails set `email_verified: true`
- [ ] Rejection emails move application to "Rejected" column
- [ ] Interview request emails move application to "Interviewing" column
- [ ] Desktop notifications appear for each email type
- [ ] Tracker UI updates in real-time without manual refresh
- [ ] Sync state persists across extension restarts
- [ ] No duplicate processing of emails
