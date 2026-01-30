# Batch Apply Flow Bug Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the end-to-end batch apply flow so browser-use discovered jobs are properly parsed, passed to application agents, and tracked through completion.

**Architecture:** The batch flow uses a Supabase Edge Function (Deno) that orchestrates browser-use Cloud API calls for job discovery and application, with polling from tracker.js for status updates. Jobs flow through states: scraping → active → complete, with each job progressing: queued → running → success/failed.

**Tech Stack:** Supabase Edge Functions (Deno), browser-use Cloud API v2, AgentMail API, Flask backend, vanilla JS frontend.

---

## Task 1: Fix greedy regex parsing (CRITICAL Bug #1)

**Files:**
- Modify: `supabase/functions/peebo-batch/index.ts:425-459`

**Step 1: Write enhanced parseJobListings function**

Replace the `parseJobListings` function at line 425 with a multi-strategy parser:

```typescript
// Parse job listings from browser-use output
function parseJobListings(output: string, request: StartBatchRequest): BatchJob[] {
  const jobs: BatchJob[] = []

  console.log('[peebo-batch] === PARSING JOB LISTINGS ===')
  console.log('[peebo-batch] Output length:', output?.length || 0)
  console.log('[peebo-batch] Output preview (first 2000 chars):', (output || '').substring(0, 2000))

  if (!output) {
    console.error('[peebo-batch] No output to parse')
    return jobs
  }

  let parsed: any[] = []

  // Strategy 1: Look for JSON array starting with job objects (non-greedy)
  const arrayMatch = output.match(/\[\s*\{\s*"company"[\s\S]*?\}\s*\]/)
  if (arrayMatch) {
    try {
      parsed = JSON.parse(arrayMatch[0])
      console.log('[peebo-batch] Strategy 1 (non-greedy array) SUCCESS:', parsed.length, 'jobs')
    } catch (e) {
      console.log('[peebo-batch] Strategy 1 failed:', (e as Error).message)
    }
  }

  // Strategy 2: Extract from markdown code block
  if (!parsed.length) {
    const codeMatch = output.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
    if (codeMatch) {
      try {
        parsed = JSON.parse(codeMatch[1])
        console.log('[peebo-batch] Strategy 2 (code block) SUCCESS:', parsed.length, 'jobs')
      } catch (e) {
        console.log('[peebo-batch] Strategy 2 failed:', (e as Error).message)
      }
    }
  }

  // Strategy 3: Extract individual job objects via regex capture groups
  if (!parsed.length) {
    const jobPattern = /\{\s*"company"\s*:\s*"([^"]+)"\s*,\s*"role"\s*:\s*"([^"]+)"\s*,\s*"job_url"\s*:\s*"([^"]+)"\s*\}/g
    let match
    while ((match = jobPattern.exec(output)) !== null) {
      parsed.push({ company: match[1], role: match[2], job_url: match[3] })
    }
    if (parsed.length) {
      console.log('[peebo-batch] Strategy 3 (individual objects) SUCCESS:', parsed.length, 'jobs')
    }
  }

  // Strategy 4: Try parsing entire output as JSON array
  if (!parsed.length) {
    try {
      const trimmed = output.trim()
      if (trimmed.startsWith('[')) {
        const fullParse = JSON.parse(trimmed)
        if (Array.isArray(fullParse)) {
          parsed = fullParse
          console.log('[peebo-batch] Strategy 4 (full output) SUCCESS:', parsed.length, 'jobs')
        }
      }
    } catch (e) {
      console.log('[peebo-batch] Strategy 4 failed:', (e as Error).message)
    }
  }

  if (!parsed.length) {
    console.error('[peebo-batch] ALL PARSING STRATEGIES FAILED')
    console.error('[peebo-batch] Raw output sample:', output.substring(0, 1000))
    return jobs
  }

  // Convert to BatchJob format
  const targetCount = request?.target_count || 5
  for (let i = 0; i < parsed.length && i < targetCount; i++) {
    const item = parsed[i]
    const jobUrl = item.job_url || item.url || item.link || ''

    if (!jobUrl) {
      console.log(`[peebo-batch] Skipping job ${i} - no URL:`, item)
      continue
    }

    jobs.push({
      id: generateUUID(),
      position: i + 1,
      company: item.company || 'Unknown',
      role: item.role || item.title || request?.criteria?.target_roles?.[0] || 'Unknown',
      job_url: jobUrl,
      status: 'queued',
      browser_use_task_id: null,
      live_url: null,
      started_at: null,
      completed_at: null,
      current_step: null,
      agent_success: null,
      email_verified: false,
      error_message: null,
      cost: 0
    })
  }

  console.log('[peebo-batch] === PARSING COMPLETE ===')
  console.log('[peebo-batch] Total jobs created:', jobs.length)
  jobs.forEach(j => console.log(`[peebo-batch]   - ${j.company}: ${j.role} -> ${j.job_url}`))

  return jobs
}
```

**Step 2: Verify syntax**

Run: `cd /Users/sourabhkatti/applicator && npx tsc --noEmit --skipLibCheck supabase/functions/peebo-batch/index.ts 2>&1 || echo "Checking manually..."`

Expected: No errors (or Deno-specific imports ignored).

**Step 3: Commit**

```bash
git add supabase/functions/peebo-batch/index.ts
git commit -m "fix: replace greedy regex with multi-strategy parser

- Strategy 1: Non-greedy array match starting with 'company'
- Strategy 2: Extract from markdown code blocks
- Strategy 3: Capture groups for individual job objects
- Strategy 4: Parse entire output as JSON
- Add detailed logging for debugging

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add task failure handling (CRITICAL Bug #2)

**Files:**
- Modify: `supabase/functions/peebo-batch/index.ts:383-387, 572-576, 742-746, 784-788`

**Step 1: Fix direct jobs task failure (lines 383-387)**

Find this code block around line 383:
```typescript
const taskId = await startJobApplication(firstJob, body, apiKey)
if (taskId) {
  firstJob.browser_use_task_id = taskId
  firstJob.live_url = `https://cloud.browser-use.com/task/${taskId}`
}
```

Replace with:
```typescript
const taskId = await startJobApplication(firstJob, body, apiKey)
if (taskId) {
  firstJob.browser_use_task_id = taskId
  firstJob.live_url = `https://cloud.browser-use.com/task/${taskId}`
} else {
  console.error('[peebo-batch] Failed to start task for', firstJob.company)
  firstJob.status = 'failed'
  firstJob.error_message = 'Failed to create browser-use task'
  firstJob.completed_at = new Date().toISOString()
  firstJob.agent_success = false
}
```

**Step 2: Fix scrape completion task failure (lines 572-576)**

Find this code block around line 572:
```typescript
const taskId = await startJobApplication(firstJob, session.request_data, apiKey)
if (taskId) {
  firstJob.browser_use_task_id = taskId
  firstJob.live_url = `https://cloud.browser-use.com/task/${taskId}`
}
```

Replace with:
```typescript
const taskId = await startJobApplication(firstJob, session.request_data, apiKey)
if (taskId) {
  firstJob.browser_use_task_id = taskId
  firstJob.live_url = `https://cloud.browser-use.com/task/${taskId}`
} else {
  console.error('[peebo-batch] Failed to start task for', firstJob.company)
  firstJob.status = 'failed'
  firstJob.error_message = 'Failed to create browser-use task'
  firstJob.completed_at = new Date().toISOString()
  firstJob.agent_success = false
}
```

**Step 3: Fix success path next job failure (lines 742-746)**

Find this code block around line 742:
```typescript
nextTaskId = await startJobApplication(nextJob, session.request_data, apiKey)
if (nextTaskId) {
  nextJob.browser_use_task_id = nextTaskId
  nextJob.live_url = `https://cloud.browser-use.com/task/${nextTaskId}`
}
```

Replace with:
```typescript
nextTaskId = await startJobApplication(nextJob, session.request_data, apiKey)
if (nextTaskId) {
  nextJob.browser_use_task_id = nextTaskId
  nextJob.live_url = `https://cloud.browser-use.com/task/${nextTaskId}`
} else {
  console.error('[peebo-batch] Failed to start next task for', nextJob.company)
  nextJob.status = 'failed'
  nextJob.error_message = 'Failed to create browser-use task'
  nextJob.completed_at = new Date().toISOString()
  nextJob.agent_success = false
}
```

**Step 4: Fix failure path next job failure (lines 784-788)**

Find this code block around line 784:
```typescript
nextTaskId = await startJobApplication(nextJob, session.request_data, apiKey)
if (nextTaskId) {
  nextJob.browser_use_task_id = nextTaskId
  nextJob.live_url = `https://cloud.browser-use.com/task/${nextTaskId}`
}
```

Replace with:
```typescript
nextTaskId = await startJobApplication(nextJob, session.request_data, apiKey)
if (nextTaskId) {
  nextJob.browser_use_task_id = nextTaskId
  nextJob.live_url = `https://cloud.browser-use.com/task/${nextTaskId}`
} else {
  console.error('[peebo-batch] Failed to start next task for', nextJob.company)
  nextJob.status = 'failed'
  nextJob.error_message = 'Failed to create browser-use task'
  nextJob.completed_at = new Date().toISOString()
  nextJob.agent_success = false
}
```

**Step 5: Commit**

```bash
git add supabase/functions/peebo-batch/index.ts
git commit -m "fix: handle task creation failures to prevent stuck jobs

Jobs now marked as 'failed' when browser-use task creation fails,
instead of staying 'running' forever with null task_id.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add DB error handling (HIGH Bug #4)

**Files:**
- Modify: `supabase/functions/peebo-batch/index.ts:556-563, 578-585, 755-766, 796-807, 858-865, 885-888, 908-911`

**Step 1: Add error handling to scrape completion DB update (lines 556-563)**

Find:
```typescript
await supabase
  .from('batch_sessions')
  .update({
    status: 'complete',
    completed_at: new Date().toISOString(),
    jobs: []
  })
  .eq('id', session.id)
```

Replace with:
```typescript
const { error: updateError } = await supabase
  .from('batch_sessions')
  .update({
    status: 'complete',
    completed_at: new Date().toISOString(),
    jobs: []
  })
  .eq('id', session.id)

if (updateError) {
  console.error('[peebo-batch] DB update failed:', updateError)
}
```

**Step 2: Apply same pattern to all other DB updates**

Repeat the same error handling pattern for the following locations:
- Lines 578-585 (active status update)
- Lines 755-766 (job completion update)
- Lines 796-807 (job failure update)
- Lines 858-865 (stop batch update)
- Lines 885-888 (pause batch update)
- Lines 908-911 (resume batch update)

Each should capture the error and log it:
```typescript
const { error: updateError } = await supabase...
if (updateError) {
  console.error('[peebo-batch] DB update failed:', updateError)
}
```

**Step 3: Commit**

```bash
git add supabase/functions/peebo-batch/index.ts
git commit -m "fix: add error handling to all database updates

Log errors when Supabase updates fail to aid debugging.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Fix form data not saved before start (HIGH Bug #5)

**Files:**
- Modify: `tracker/tracker.js:2696`

**Step 1: Read form values directly in startBatch**

Find the line that reads `batchConfig.targetCount` around line 2696:
```javascript
target_count: batchConfig.targetCount,
```

Add form value reading before the fetch call. Find the `startBatch` function and add at the beginning of the try block (after line 2669):

```javascript
// Read form values directly to ensure latest values are used
const targetCountInput = document.getElementById('batch-job-count');
const actualTargetCount = targetCountInput ? parseInt(targetCountInput.value) || 5 : (batchConfig.targetCount || 5);
```

Then update line 2696 to:
```javascript
target_count: actualTargetCount,
```

Also update line 2731 to:
```javascript
target_count: actualTargetCount,
```

**Step 2: Commit**

```bash
git add tracker/tracker.js
git commit -m "fix: read form values directly in startBatch

Ensures target_count reflects actual form input, not potentially
stale batchConfig value.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Fix storage race condition (HIGH Bug #6)

**Files:**
- Modify: `tracker/tracker.js:3101-3116`

**Step 1: Batch storage saves**

Find the polling callback code around lines 3101-3116:
```javascript
trackerData.settings.batch_session = batchSession;
await storage.save(trackerData);

// Update UI based on status
if (data.status === 'active' && batchPanelState !== 'active') {
  batchPanelState = 'active';
} else if (data.status === 'complete' || data.status === 'stopped') {
  batchPanelState = data.status;
  stopBatchPolling();

  // Add successful jobs to tracker
  for (const job of data.jobs || []) {
    if (job.agent_success) {
      await addBatchJobToTracker(job);
    }
  }
```

Replace with:
```javascript
// Update UI based on status
if (data.status === 'active' && batchPanelState !== 'active') {
  batchPanelState = 'active';
} else if (data.status === 'complete' || data.status === 'stopped') {
  batchPanelState = data.status;
  stopBatchPolling();

  // Add successful jobs to tracker (modify trackerData.jobs directly)
  for (const job of data.jobs || []) {
    if (job.agent_success) {
      // Inline job addition to avoid multiple saves
      const existingJob = trackerData.jobs.find(j =>
        j.jobUrl === job.job_url ||
        (j.company === job.company && j.role === job.role)
      );

      if (existingJob) {
        existingJob.status = 'applied';
        existingJob.lastActivityDate = new Date().toISOString().split('T')[0];
        existingJob.notes = (existingJob.notes || '') + `\n[Batch] Applied via Peebo on ${new Date().toLocaleDateString()}`;
      } else {
        trackerData.jobs.push({
          id: generateUUID(),
          company: job.company,
          role: job.role,
          status: 'applied',
          dateApplied: new Date().toISOString().split('T')[0],
          lastActivityDate: new Date().toISOString().split('T')[0],
          jobUrl: job.job_url,
          nextAction: 'Wait for response',
          notes: `Applied via Peebo batch apply. Cost: $${job.cost?.toFixed(4) || '0.00'}`,
          email_verified: job.email_verified || false
        });
      }
    }
  }
```

And move the single save to after all modifications:
```javascript
// Single save after all modifications
trackerData.settings.batch_session = batchSession;
await storage.save(trackerData);

// Check AgentMail for email verification
await checkAgentMailVerification();
```

**Step 2: Commit**

```bash
git add tracker/tracker.js
git commit -m "fix: batch all storage changes into single save

Prevents race condition where polling and job addition both
tried to save simultaneously.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Fix AgentMail verification timing (HIGH Bug #7)

**Files:**
- Modify: `tracker/tracker.js:2841-2852`

**Step 1: Wait for sync response**

Find the `checkAgentMailVerification` function:
```javascript
async function checkAgentMailVerification() {
  try {
    // Trigger AgentMail sync via Flask endpoint
    const response = await fetch('/api/trigger_email_sync', { method: 'POST' });
    if (response.ok) {
      // Reload data to get email_verified updates
      await refreshUI();
    }
  } catch (error) {
    console.error('[Batch] AgentMail sync error:', error);
  }
}
```

Replace with:
```javascript
async function checkAgentMailVerification() {
  try {
    // Trigger AgentMail sync via Flask endpoint
    const response = await fetch('/api/trigger_email_sync', { method: 'POST' });
    if (!response.ok) {
      console.error('[Batch] AgentMail sync failed:', response.status);
      return;
    }

    const result = await response.json();
    console.log('[Batch] AgentMail sync result:', result);

    if (result.emails_verified && result.emails_verified > 0) {
      // Only refresh if emails were actually verified
      console.log('[Batch] Verified', result.emails_verified, 'emails, refreshing UI');
      await refreshUI();
    }
  } catch (error) {
    console.error('[Batch] AgentMail sync error:', error);
  }
}
```

**Step 2: Commit**

```bash
git add tracker/tracker.js
git commit -m "fix: wait for AgentMail sync result before refreshing

Only refresh UI if emails were actually verified, and log the
sync result for debugging.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Fix email check timestamp (MEDIUM Bug #8)

**Files:**
- Modify: `supabase/functions/peebo-batch/index.ts:706`

**Step 1: Add timestamp buffer**

Find line 706:
```typescript
const emailCheck = await checkForConfirmationEmail(currentJob.company, currentJob.started_at || '')
```

Replace with:
```typescript
// Buffer 5 minutes before started_at to catch emails that arrive during form submission
const checkAfterTime = currentJob.started_at
  ? new Date(new Date(currentJob.started_at).getTime() - 5 * 60 * 1000).toISOString()
  : new Date(Date.now() - 10 * 60 * 1000).toISOString()
const emailCheck = await checkForConfirmationEmail(currentJob.company, checkAfterTime)
```

**Step 2: Commit**

```bash
git add supabase/functions/peebo-batch/index.ts
git commit -m "fix: add 5-minute buffer for email verification timestamp

Catches emails that arrive during form submission, before started_at
was set.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Fix incomplete local session object (MEDIUM Bug #10)

**Files:**
- Modify: `tracker/tracker.js:2724-2739`

**Step 1: Copy all server response fields**

Find the local session creation:
```javascript
batchSession = {
  id: result.session_id,
  status: 'scraping',
  created_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  completed_at: null,
  config: {
    target_count: batchConfig.targetCount,
    criteria_summary: criteriaSummary,
    resume_name: batchConfig.resumeName
  },
  jobs: [],
  total_cost: 0,
  completed_count: 0,
  failed_count: 0
};
```

Replace with:
```javascript
batchSession = {
  id: result.session_id,
  status: result.status || 'scraping',
  scrape_task_id: result.scrape_task_id || null,
  created_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  completed_at: null,
  config: {
    target_count: actualTargetCount,
    criteria_summary: criteriaSummary,
    resume_name: batchConfig.resumeName || 'resume.txt'
  },
  jobs: result.jobs || [],
  total_cost: result.total_cost || 0,
  completed_count: result.completed_count || 0,
  failed_count: result.failed_count || 0
};
```

**Step 2: Commit**

```bash
git add tracker/tracker.js
git commit -m "fix: include server response fields in local session object

Ensures scrape_task_id and other fields from server are preserved.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Fix jobs with null agent_success skipped (MEDIUM Bug #11)

**Files:**
- Modify: `tracker/tracker.js:2805`

**Step 1: Only skip explicit false**

Find line 2805:
```javascript
if (!batchJob.agent_success) return;
```

Replace with:
```javascript
if (batchJob.agent_success === false) return;  // Only skip explicit failures, not null/pending
```

**Step 2: Commit**

```bash
git add tracker/tracker.js
git commit -m "fix: only skip jobs with explicit agent_success=false

Jobs with null agent_success (pending) should not be skipped.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Fix cost aggregation validation (LOW Bug #13)

**Files:**
- Modify: `supabase/functions/peebo-batch/index.ts:752, 793`

**Step 1: Ensure numeric cost values**

Find line 752:
```typescript
const totalCost = jobs.reduce((sum, j) => sum + (j.cost || 0), 0)
```

Replace with:
```typescript
const totalCost = jobs.reduce((sum, j) => sum + (parseFloat(String(j.cost)) || 0), 0)
```

Do the same for line 793.

**Step 2: Commit**

```bash
git add supabase/functions/peebo-batch/index.ts
git commit -m "fix: ensure numeric cost aggregation

Handles case where cost might be a string from JSON parsing.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Add request validation (LOW Bug #15)

**Files:**
- Modify: `supabase/functions/peebo-batch/index.ts:241-244`

**Step 1: Add comprehensive validation**

Find the validation block:
```typescript
if (!body.target_count || body.target_count < 1 || body.target_count > 20) {
  return jsonResponse({ error: 'target_count must be between 1 and 20' }, 400)
}
```

Replace with:
```typescript
if (!body.target_count || body.target_count < 1 || body.target_count > 20) {
  return jsonResponse({ error: 'target_count must be between 1 and 20' }, 400)
}

if (!body.criteria?.target_roles?.length) {
  return jsonResponse({ error: 'criteria.target_roles is required' }, 400)
}

if (!body.user_info?.email) {
  return jsonResponse({ error: 'user_info.email is required' }, 400)
}

if (!body.user_info?.name) {
  return jsonResponse({ error: 'user_info.name is required' }, 400)
}
```

**Step 2: Commit**

```bash
git add supabase/functions/peebo-batch/index.ts
git commit -m "fix: add comprehensive request validation

Validates target_roles, email, and name are provided.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Fix hardcoded resume name (LOW Bug #17)

**Files:**
- Modify: `supabase/functions/peebo-batch/index.ts:324, 400`

**Step 1: Use dynamic resume name**

Find line 324:
```typescript
resume_name: 'resume_optimized.txt'
```

Replace with:
```typescript
resume_name: body.resume_name || 'resume.txt'
```

Do the same for line 400.

**Step 2: Commit**

```bash
git add supabase/functions/peebo-batch/index.ts
git commit -m "fix: use dynamic resume name from request

Falls back to 'resume.txt' if not provided.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 13: Deploy edge function

**Files:**
- Deploy: `supabase/functions/peebo-batch/index.ts`

**Step 1: Deploy to Supabase**

Run: `cd /Users/sourabhkatti/applicator && npx supabase functions deploy peebo-batch --project-ref diplqphbqlomcvlujcxd`

Expected: Deployment successful message.

**Step 2: Verify deployment**

Run: `curl -s https://diplqphbqlomcvlujcxd.supabase.co/functions/v1/peebo-batch/ | head -20`

Expected: Returns JSON with "Not found" or similar (confirms function is responding).

**Step 3: Check logs**

Run: `npx supabase functions logs peebo-batch --project-ref diplqphbqlomcvlujcxd --tail`

Expected: See recent log entries (or empty if no recent calls).

---

## Task 14: End-to-end validation

**Files:**
- Run: `tracker/app.py`
- Test: `tracker/index.html` via http://localhost:8080

**Step 1: Start tracker**

Run: `python /Users/sourabhkatti/applicator/tracker/app.py`

Expected: Flask server starts, browser opens to http://localhost:8080

**Step 2: Verify applicant data loaded**

Open browser console and run:
```javascript
console.log('Resume loaded:', !!trackerData?.settings?.applicant?.resume_text)
console.log('Name:', trackerData?.settings?.applicant?.name)
console.log('Email:', trackerData?.settings?.applicant?.email)
```

Expected: Resume loaded: true, Name and Email populated.

**Step 3: Start batch apply**

1. Click "Apply to Jobs" sidebar button
2. Set target count to 2
3. Set criteria: Product Manager, San Francisco
4. Click "Start Applying"

**Step 4: Watch console logs**

Expected sequence:
- `[Batch] Real polling started`
- Status transitions: `scraping` → `active`
- Jobs appear in panel with company names from browser-use discovery

**Step 5: Monitor Supabase logs**

Run: `npx supabase functions logs peebo-batch --project-ref diplqphbqlomcvlujcxd`

Expected:
- `=== PARSING JOB LISTINGS ===`
- `Strategy X SUCCESS: N jobs`
- Job company/role names logged

**Step 6: Verify completion**

Expected:
- Both jobs complete (success or failed)
- Successful jobs appear in Applied column
- AgentMail verification runs
- Activity log updated

---

## Success Criteria

- [ ] Supabase logs show "Strategy X SUCCESS" with parsed jobs
- [ ] Discovered jobs (not empty) appear in UI
- [ ] Applications complete (not stuck as "running")
- [ ] Failed tasks marked as "failed" with error message
- [ ] Successful jobs added to tracker Applied column
- [ ] Activity log shows application events
- [ ] Email verification runs (if AgentMail configured)

---

## Ralph Loop Execution

After implementing all tasks, use `/ralph-loop:ralph-loop --max-iterations 30` to:
1. Deploy edge function
2. Test from tracker UI
3. If failure, diagnose from logs
4. Fix identified issues
5. Repeat until all success criteria pass
