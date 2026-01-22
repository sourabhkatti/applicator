# Job tracker assistant

## Overview

This folder contains a kanban-style job tracker for your job search. The tracker is a web app that reads from `jobs.json`. Claude helps manage the data.

## Files

- `index.html` - The kanban board (open in browser via local server)
- `jobs.json` - Job data storage
- `CLAUDE.md` - These instructions

## How to view the tracker

Start the Flask server:

```bash
python ~/applicator/tracker/app.py
```

This opens http://localhost:8080 automatically.

Or for static mode (without config API):
```bash
cd ~/applicator/tracker && python3 -m http.server 8080
```

## Commands

### Adding a job

User says: "Add job at [company] for [role]"

Add entry to jobs.json with:
- Generate UUID for id
- Set status to "applied"
- Set dateApplied to today
- Set lastActivityDate to today
- Set nextAction to "Wait for response"
- Ask user for salary range, job URL

### Moving a job

User says: "Move [company] to [stage]"

Valid stages: applied, recruiter_screen, hiring_manager, panel_onsite, offer, rejected

- Update status field
- Update lastActivityDate to today
- Update nextAction based on stage

### Logging an interview

User says: "Log interview with [company] on [date] - [type]"

- Add entry to interviews array
- Update lastActivityDate to today
- Set nextAction to "Prep for [type]"

### Adding notes

User says: "Add note to [company]: [text]"

- Append to notes field with timestamp

### Setting follow-up

User says: "Set follow-up for [company] on [date]"

- Set followUpBy field

### Checking follow-ups

User says: "What needs follow-up?"

- Read jobs.json
- Calculate which jobs need follow-up (2+ working days since last activity)
- List them with company name and days waiting

### Recording an offer

User says: "Got offer from [company]: [amount]"

- Move to offer status
- Create offer object with initial amount
- Ask about bonus, equity details

### Updating prep checklist

User says: "Mark [company] prep done: [item]"

Items: companyResearch, starStories, questionsReady, technicalPrep

- Update prepChecklist object

### Adding referral

User says: "Add referral for [company]: [contact name]"

- Set referralContact
- Set referralStatus to "requested" or "received"

## Metrics to monitor

When user asks about progress, calculate:
- Total active applications (not rejected)
- Conversion rates at each stage
- Jobs needing follow-up
- Upcoming interviews this week

## Job data schema

```json
{
  "id": "uuid",
  "company": "string",
  "role": "string",
  "status": "applied|recruiter_screen|hiring_manager|panel_onsite|offer|rejected",
  "dateApplied": "YYYY-MM-DD",
  "nextAction": "string",
  "jobUrl": "url",
  "salaryMin": number,
  "salaryMax": number,
  "recruiterName": "string",
  "recruiterEmail": "string",
  "hiringManagerName": "string",
  "hiringManagerEmail": "string",
  "referralContact": "string",
  "referralStatus": "none|requested|received",
  "interviews": [{ "date": "ISO datetime", "type": "string", "notes": "string" }],
  "lastActivityDate": "YYYY-MM-DD",
  "followUpBy": "YYYY-MM-DD or null",
  "notes": "string",
  "companyResearch": "string",
  "prepChecklist": {
    "companyResearch": boolean,
    "starStories": boolean,
    "questionsReady": boolean,
    "technicalPrep": boolean
  },
  "offer": {
    "initial": number,
    "counter": number,
    "final": number,
    "bonus": number,
    "equity": "string"
  } or null
}
```
