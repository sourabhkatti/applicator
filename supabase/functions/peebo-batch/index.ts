// Peebo Batch Apply Edge Function
// Handles bulk job application sessions with REAL browser-use API

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Browser-use Cloud API
const BROWSER_USE_API_URL = 'https://api.browser-use.com/api/v2'

// AgentMail API for email verification
const AGENTMAIL_API_URL = 'https://api.agentmail.to/v0'
const AGENTMAIL_INBOX = 'applicator@agentmail.to'

// Types
interface BatchSession {
  id: string
  user_id: string
  status: 'setup' | 'scraping' | 'active' | 'complete' | 'stopped' | 'paused'
  created_at: string
  started_at: string | null
  completed_at: string | null
  config: {
    target_count: number
    criteria_summary: string
    resume_name: string
  }
  jobs: BatchJob[]
  total_cost: number
  completed_count: number
  failed_count: number
  scrape_task_id?: string | null
  current_job_task_id?: string | null
  request_data?: StartBatchRequest | null
}

interface BatchJob {
  id: string
  position: number
  company: string
  role: string
  job_url: string
  status: 'queued' | 'running' | 'success' | 'failed' | 'stopped'
  browser_use_task_id: string | null
  live_url: string | null
  started_at: string | null
  completed_at: string | null
  current_step: string | null
  agent_success: boolean | null
  email_verified: boolean
  error_message: string | null
  cost: number
}

interface StartBatchRequest {
  target_count: number
  criteria: {
    target_roles: string[]
    location?: string
    salary_min?: number
    industries?: string[]
  }
  resume_text: string
  user_info: {
    name: string
    email: string
    phone?: string
    linkedin?: string
  }
  // Optional: direct job URLs to skip scraping
  direct_jobs?: Array<{
    company: string
    role: string
    job_url: string
  }>
}

interface BrowserUseTaskResponse {
  id: string
  task_id?: string
  state?: string
  status?: string
  live_url?: string
  output?: string
  steps?: Array<{ action: string; result: string }>
  cost?: number
  error?: string
}

// Generate UUID
function generateUUID(): string {
  return crypto.randomUUID()
}

// Helper for JSON responses
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Get browser-use API key from environment
function getBrowserUseApiKey(): string {
  const key = Deno.env.get('BROWSER_USE_API_KEY') || Deno.env.get('PEEBO_BROWSER_USE_KEY')
  if (!key) {
    throw new Error('BROWSER_USE_API_KEY not configured')
  }
  return key
}

// Get AgentMail API key from environment
function getAgentMailApiKey(): string | null {
  return Deno.env.get('AGENTMAIL_API_KEY') || null
}

// Check for confirmation email from a company
async function checkForConfirmationEmail(company: string, afterTime: string): Promise<{found: boolean, subject?: string}> {
  const apiKey = getAgentMailApiKey()
  if (!apiKey) {
    console.log('[peebo-batch] AgentMail API key not configured, skipping email verification')
    return { found: false }
  }

  try {
    // Extract inbox ID from email address
    const inboxId = AGENTMAIL_INBOX.split('@')[0]

    const response = await fetch(
      `${AGENTMAIL_API_URL}/inboxes/${inboxId}/messages?after=${encodeURIComponent(afterTime)}&limit=10`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }
    )

    if (!response.ok) {
      console.error('[peebo-batch] AgentMail API error:', response.status)
      return { found: false }
    }

    const data = await response.json()
    const messages = data.messages || []

    // Check if any message is related to this company
    const companyLower = company.toLowerCase()
    for (const msg of messages) {
      const subject = (msg.subject || '').toLowerCase()
      const from = (msg.from_address || '').toLowerCase()

      // Check for confirmation indicators
      const isFromCompany = from.includes(companyLower) || from.includes('greenhouse') || from.includes('lever') || from.includes('ashby')
      const isConfirmation = subject.includes('thank') || subject.includes('application') || subject.includes('received') || subject.includes('confirm')
      const mentionsCompany = subject.includes(companyLower)

      if ((isFromCompany || mentionsCompany) && isConfirmation) {
        console.log(`[peebo-batch] Found confirmation email for ${company}: ${msg.subject}`)
        return { found: true, subject: msg.subject }
      }
    }

    return { found: false }
  } catch (error) {
    console.error('[peebo-batch] Email verification error:', error)
    return { found: false }
  }
}

// Main handler
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  let path = url.pathname
  if (path.startsWith('/peebo-batch')) {
    path = path.replace('/peebo-batch', '')
  }
  if (path.startsWith('/functions/v1/peebo-batch')) {
    path = path.replace('/functions/v1/peebo-batch', '')
  }
  if (!path || path === '') {
    path = '/'
  } else if (!path.startsWith('/')) {
    path = '/' + path
  }

  console.log('[peebo-batch] Method:', req.method, 'Path:', path)

  try {
    // Initialize Supabase client with service role for database access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Route requests
    if (req.method === 'POST' && path === '/start') {
      return handleStartBatch(req, supabase)
    }

    if (req.method === 'GET' && path.match(/^\/[^/]+\/status$/)) {
      const sessionId = path.split('/')[1]
      return handleGetStatus(sessionId, supabase)
    }

    if (req.method === 'POST' && path.match(/^\/[^/]+\/stop$/)) {
      const sessionId = path.split('/')[1]
      return handleStopBatch(sessionId, supabase)
    }

    if (req.method === 'POST' && path.match(/^\/[^/]+\/pause$/)) {
      const sessionId = path.split('/')[1]
      return handlePauseBatch(sessionId, supabase)
    }

    if (req.method === 'POST' && path.match(/^\/[^/]+\/resume$/)) {
      const sessionId = path.split('/')[1]
      return handleResumeBatch(sessionId, supabase)
    }

    console.error('[peebo-batch] No route matched for:', req.method, path)
    return jsonResponse({ error: 'Not found', debug: { method: req.method, path } }, 404)

  } catch (error) {
    console.error('Peebo batch error:', error)
    return jsonResponse({ error: error.message || 'Internal server error' }, 500)
  }
})

// Start a new batch session
async function handleStartBatch(
  req: Request,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const body = await req.json() as StartBatchRequest

  // Validate
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

  const sessionId = generateUUID()
  const criteriaSummary = formatCriteriaSummary(body.criteria)
  const apiKey = getBrowserUseApiKey()

  // Check if direct jobs were provided (skip scraping)
  if (body.direct_jobs && body.direct_jobs.length > 0) {
    return handleDirectJobs(sessionId, body, criteriaSummary, apiKey, supabase)
  }

  // Otherwise, create browser-use scraping task
  const roles = body.criteria.target_roles?.join(', ') || 'Software Engineer'
  const location = body.criteria.location || 'Remote'
  const count = body.target_count

  const scrapeTask = {
    task: `Find ${count} job openings matching these criteria:
- Roles: ${roles}
- Location: ${location}
${body.criteria.salary_min ? `- Minimum salary: $${body.criteria.salary_min}` : ''}
${body.criteria.industries?.length ? `- Industries: ${body.criteria.industries.join(', ')}` : ''}

Instructions:
1. Go to Google and search: "${roles}" jobs "${location}" site:greenhouse.io OR site:lever.co OR site:jobs.ashbyhq.com
2. Click on the job listing links from the search results (NOT the main search page)
3. Find ${count} different job postings from different companies
4. For each job posting page you visit, extract:
   - Company name (from the page or URL)
   - Job title/role
   - The current page URL (the direct job posting URL)

OUTPUT FORMAT - THIS IS CRITICAL:
Your FINAL output MUST be ONLY a valid JSON array, nothing else. No explanations, no markdown, no extra text.
Example: [{"company": "Acme", "role": "PM", "job_url": "https://..."}]

REQUIREMENTS:
- Visit the actual job posting pages, not just the search results
- Only include direct application URLs from Greenhouse, Lever, or Ashby job boards
- If a search doesn't yield results, try simplifying to just "${roles}" jobs site:greenhouse.io
- Your final response must be ONLY the JSON array - no other text`,
    max_steps: 40,
    use_vision: true
  }

  console.log('[peebo-batch] Starting job scrape task...')

  let scrapeTaskId: string | null = null
  try {
    const response = await fetch(`${BROWSER_USE_API_URL}/tasks`, {
      method: 'POST',
      headers: {
        'X-Browser-Use-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(scrapeTask)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Browser-use API error: ${errorText}`)
    }

    const taskResult = await response.json() as BrowserUseTaskResponse
    scrapeTaskId = taskResult.id || taskResult.task_id || null
    console.log('[peebo-batch] Scrape task created:', scrapeTaskId)
  } catch (error) {
    console.error('[peebo-batch] Failed to create scrape task:', error)
    return jsonResponse({ error: `Failed to start scraping: ${error.message}` }, 500)
  }

  // Create session in database with scrape task ID
  const { error: insertError } = await supabase
    .from('batch_sessions')
    .insert({
      id: sessionId,
      user_id: 'anonymous',
      status: 'scraping',
      started_at: new Date().toISOString(),
      config: {
        target_count: body.target_count,
        criteria_summary: criteriaSummary,
        resume_name: body.resume_name || 'resume.txt'
      },
      jobs: [],
      total_cost: 0,
      completed_count: 0,
      failed_count: 0,
      scrape_task_id: scrapeTaskId,
      request_data: body
    })

  if (insertError) {
    console.error('Failed to create session:', insertError)
    return jsonResponse({ error: 'Failed to create session' }, 500)
  }

  return jsonResponse({
    session_id: sessionId,
    status: 'scraping',
    scrape_task_id: scrapeTaskId,
    message: 'Searching for matching jobs...'
  })
}


// Handle direct jobs (skip scraping)
async function handleDirectJobs(
  sessionId: string,
  body: StartBatchRequest,
  criteriaSummary: string,
  apiKey: string,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  console.log('[peebo-batch] Using direct jobs mode, skipping scrape')

  // Convert direct jobs to BatchJob format
  const jobs: BatchJob[] = body.direct_jobs!.slice(0, body.target_count).map((job, i) => ({
    id: generateUUID(),
    position: i + 1,
    company: job.company,
    role: job.role,
    job_url: job.job_url,
    status: 'queued' as const,
    browser_use_task_id: null,
    live_url: null,
    started_at: null,
    completed_at: null,
    current_step: null,
    agent_success: null,
    email_verified: false,
    error_message: null,
    cost: 0
  }))

  // Start first job immediately
  const firstJob = jobs[0]
  firstJob.status = 'running'
  firstJob.started_at = new Date().toISOString()
  firstJob.current_step = 'Starting application...'

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

  // Create session in database
  const { error: insertError } = await supabase
    .from('batch_sessions')
    .insert({
      id: sessionId,
      user_id: 'anonymous',
      status: 'active',
      started_at: new Date().toISOString(),
      config: {
        target_count: body.target_count,
        criteria_summary: criteriaSummary,
        resume_name: body.resume_name || 'resume.txt'
      },
      jobs: jobs,
      total_cost: 0,
      completed_count: 0,
      failed_count: 0,
      scrape_task_id: null,
      current_job_task_id: taskId,
      request_data: body
    })

  if (insertError) {
    console.error('Failed to create session:', insertError)
    return jsonResponse({ error: 'Failed to create session' }, 500)
  }

  return jsonResponse({
    session_id: sessionId,
    status: 'active',
    jobs_count: jobs.length,
    message: `Started applying to ${jobs.length} jobs`
  })
}

// Parse job listings from browser-use output
function parseJobListings(output: string | object | unknown, request: StartBatchRequest): BatchJob[] {
  const jobs: BatchJob[] = []

  console.log('[peebo-batch] === PARSING JOB LISTINGS ===')
  console.log('[peebo-batch] Output type:', typeof output)
  console.log('[peebo-batch] Output raw:', JSON.stringify(output)?.substring(0, 2000))

  // Handle different output formats from browser-use API
  let outputStr: string = ''

  if (typeof output === 'string') {
    outputStr = output
  } else if (output && typeof output === 'object') {
    // If output is already an array, return it directly
    if (Array.isArray(output)) {
      console.log('[peebo-batch] Output is already an array with', output.length, 'items')
      return convertParsedToJobs(output, request)
    }
    // Try to extract from common wrapper formats
    const outputObj = output as Record<string, unknown>
    if (outputObj.json) {
      if (typeof outputObj.json === 'string') {
        outputStr = outputObj.json
      } else if (Array.isArray(outputObj.json)) {
        console.log('[peebo-batch] Output.json is already an array with', outputObj.json.length, 'items')
        return convertParsedToJobs(outputObj.json, request)
      }
    } else if (outputObj.result) {
      if (typeof outputObj.result === 'string') {
        outputStr = outputObj.result
      } else if (Array.isArray(outputObj.result)) {
        return convertParsedToJobs(outputObj.result, request)
      }
    } else if (outputObj.value) {
      if (typeof outputObj.value === 'string') {
        outputStr = outputObj.value
      } else if (Array.isArray(outputObj.value)) {
        return convertParsedToJobs(outputObj.value, request)
      }
    } else {
      // Try JSON.stringify and parse as string
      outputStr = JSON.stringify(output)
    }
  }

  console.log('[peebo-batch] Output string length:', outputStr?.length || 0)
  console.log('[peebo-batch] Output string preview (first 2000 chars):', (outputStr || '').substring(0, 2000))

  if (!outputStr) {
    console.error('[peebo-batch] No output to parse')
    return jobs
  }

  let parsed: any[] = []

  // Strategy 0: Strip common prefixes (json, JSON, Here are the jobs:) and try parsing
  const cleanedOutput = outputStr
    .replace(/^[\s\S]*?([\[{])/m, '$1')  // Remove everything before first [ or {
    .trim()

  if (cleanedOutput.startsWith('[')) {
    // Find the matching closing bracket by counting
    let depth = 0
    let endIndex = -1
    for (let i = 0; i < cleanedOutput.length; i++) {
      if (cleanedOutput[i] === '[') depth++
      else if (cleanedOutput[i] === ']') {
        depth--
        if (depth === 0) {
          endIndex = i
          break
        }
      }
    }
    if (endIndex > 0) {
      try {
        const jsonStr = cleanedOutput.substring(0, endIndex + 1)
        parsed = JSON.parse(jsonStr)
        console.log('[peebo-batch] Strategy 0 (bracket matching) SUCCESS:', parsed.length, 'jobs')
      } catch (e) {
        console.log('[peebo-batch] Strategy 0 failed:', (e as Error).message)
      }
    }
  }

  // Strategy 1: Look for JSON array with job objects (greedy, find last ])
  if (!parsed.length) {
    const startMatch = outputStr.match(/\[\s*\{\s*"company"/)
    if (startMatch && startMatch.index !== undefined) {
      const startIdx = startMatch.index
      // Find the last ] in the outputStr after startIdx
      const lastBracket = outputStr.lastIndexOf(']')
      if (lastBracket > startIdx) {
        try {
          const jsonStr = outputStr.substring(startIdx, lastBracket + 1)
          parsed = JSON.parse(jsonStr)
          console.log('[peebo-batch] Strategy 1 (greedy array) SUCCESS:', parsed.length, 'jobs')
        } catch (e) {
          console.log('[peebo-batch] Strategy 1 failed:', (e as Error).message)
        }
      }
    }
  }

  // Strategy 2: Extract from markdown code block
  if (!parsed.length) {
    const codeMatch = outputStr.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
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
    while ((match = jobPattern.exec(outputStr)) !== null) {
      parsed.push({ company: match[1], role: match[2], job_url: match[3] })
    }
    if (parsed.length) {
      console.log('[peebo-batch] Strategy 3 (individual objects) SUCCESS:', parsed.length, 'jobs')
    }
  }

  // Strategy 4: Try parsing entire outputStr as JSON array
  if (!parsed.length) {
    try {
      const trimmed = outputStr.trim()
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
    console.error('[peebo-batch] Raw output sample:', outputStr.substring(0, 1000))
    return jobs
  }

  return convertParsedToJobs(parsed, request)
}

// Helper to convert parsed job array to BatchJob format
function convertParsedToJobs(parsed: any[], request: StartBatchRequest): BatchJob[] {
  const jobs: BatchJob[] = []
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


// Get batch status
async function handleGetStatus(
  sessionId: string,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const { data: session, error } = await supabase
    .from('batch_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error || !session) {
    console.error('Session not found:', sessionId, error)
    return jsonResponse({ error: 'Session not found' }, 404)
  }

  // If scraping, check browser-use task status
  if (session.status === 'scraping' && session.scrape_task_id) {
    await checkScrapeTaskStatus(session, supabase)
    // Re-fetch updated session
    const { data: updatedSession } = await supabase
      .from('batch_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()
    if (updatedSession) {
      Object.assign(session, updatedSession)
    }
  }

  // If active and there's a current job task, check its status
  if (session.status === 'active' && session.current_job_task_id) {
    await checkCurrentJobStatus(session, supabase)
    // Re-fetch updated session
    const { data: updatedSession } = await supabase
      .from('batch_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()
    if (updatedSession) {
      Object.assign(session, updatedSession)
    }
  }

  const jobs = session.jobs || []
  const summary = {
    total: jobs.length,
    completed: jobs.filter((j: BatchJob) => j.status === 'success').length,
    failed: jobs.filter((j: BatchJob) => j.status === 'failed').length,
    running: jobs.filter((j: BatchJob) => j.status === 'running').length,
    queued: jobs.filter((j: BatchJob) => j.status === 'queued').length,
    stopped: jobs.filter((j: BatchJob) => j.status === 'stopped').length,
    total_cost: session.total_cost || 0
  }

  return jsonResponse({
    session_id: session.id,
    status: session.status,
    jobs: jobs,
    summary,
    config: session.config
  })
}

// Check scrape task status and update session
async function checkScrapeTaskStatus(
  session: any,
  supabase: ReturnType<typeof createClient>
) {
  const apiKey = getBrowserUseApiKey()
  const taskId = session.scrape_task_id

  try {
    const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${taskId}`, {
      headers: { 'X-Browser-Use-API-Key': apiKey }
    })

    if (!response.ok) {
      console.error('[peebo-batch] Scrape poll error:', response.status)
      return
    }

    const status = await response.json() as BrowserUseTaskResponse
    console.log('[peebo-batch] Scrape task response:', JSON.stringify({ state: status.state, status: status.status, error: status.error }))
    console.log('[peebo-batch] Full status object keys:', Object.keys(status))
    console.log('[peebo-batch] Output field type:', typeof status.output)
    console.log('[peebo-batch] Output field preview:', JSON.stringify(status.output)?.substring(0, 1000))

    const taskState = (status.state || status.status || '').toLowerCase()
    const isComplete = ['completed', 'success', 'succeeded', 'finished', 'done'].includes(taskState)
    const isFailed = ['failed', 'failure', 'error', 'stopped', 'cancelled'].includes(taskState)

    if (isComplete) {
      // Parse job listings from output
      const jobs = parseJobListings(status.output || '', session.request_data || {})

      if (jobs.length === 0) {
        const { error: updateError } = await supabase
          .from('batch_sessions')
          .update({
            status: 'complete',
            completed_at: new Date().toISOString(),
            jobs: []
          })
          .eq('id', session.id)
        if (updateError) console.error('[peebo-batch] DB update failed:', updateError)
      } else {
        // Update session with found jobs, start first application
        const firstJob = jobs[0]
        firstJob.status = 'running'
        firstJob.started_at = new Date().toISOString()
        firstJob.current_step = 'Starting application...'

        // Create browser-use task for first job
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

        const { error: updateError } = await supabase
          .from('batch_sessions')
          .update({
            status: 'active',
            jobs: jobs,
            current_job_task_id: taskId
          })
          .eq('id', session.id)
        if (updateError) console.error('[peebo-batch] DB update failed:', updateError)
      }
    } else if (isFailed) {
      console.error('[peebo-batch] Scrape task failed:', status.error || taskState)
      const { error: updateError } = await supabase
        .from('batch_sessions')
        .update({
          status: 'complete',
          completed_at: new Date().toISOString(),
          jobs: []
        })
        .eq('id', session.id)
      if (updateError) console.error('[peebo-batch] DB update failed:', updateError)
    }
  } catch (error) {
    console.error('[peebo-batch] Scrape check error:', error)
  }
}

// Start job application task
async function startJobApplication(
  job: BatchJob,
  request: StartBatchRequest,
  apiKey: string
): Promise<string | null> {
  try {
    // Parse name into first and last
    const nameParts = (request.user_info?.name || '').trim().split(' ')
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''

    const applyTask = {
      url: job.job_url,
      task: `Apply to this ${job.company} job. Fill out the application form and submit it.

APPLICANT INFORMATION (use these EXACT values for each field):
• First Name: ${firstName}
• Last Name: ${lastName}
• Email: ${request.user_info?.email || ''}
• Phone: ${request.user_info?.phone || ''}
• LinkedIn URL: ${request.user_info?.linkedin || ''}
• Location: San Francisco, CA

RESUME TEXT (copy this into resume/cover letter fields if needed):
${request.resume_text || ''}

INSTRUCTIONS:
1. Click "Apply" or "Apply for this job" button
2. Fill each form field with the EXACT value listed above - do NOT combine fields
3. For resume upload: click "Enter manually" or paste the resume text
4. For screening questions: Yes to work authorization, No to visa sponsorship needed
5. Click Submit/Send Application button
6. Wait for confirmation page

IMPORTANT: Each field must contain ONLY its designated value. First Name field = "${firstName}" only.

Report "APPLICATION_SUBMITTED_SUCCESSFULLY" if you see a thank you/confirmation page.
Report "APPLICATION_FAILED: <reason>" if you cannot submit.`,
      max_steps: 30,
      step_timeout: 60,
      use_vision: true
    }

    console.log(`[peebo-batch] Starting application for ${job.company}...`)

    const response = await fetch(`${BROWSER_USE_API_URL}/tasks`, {
      method: 'POST',
      headers: {
        'X-Browser-Use-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(applyTask)
    })

    if (!response.ok) {
      throw new Error(`Browser-use API error: ${await response.text()}`)
    }

    const taskResult = await response.json() as BrowserUseTaskResponse
    return taskResult.id || taskResult.task_id || null
  } catch (error) {
    console.error(`[peebo-batch] Failed to start application:`, error)
    return null
  }
}

// Check current job application status
async function checkCurrentJobStatus(
  session: any,
  supabase: ReturnType<typeof createClient>
) {
  const apiKey = getBrowserUseApiKey()
  const taskId = session.current_job_task_id
  const jobs: BatchJob[] = session.jobs || []
  const currentJob = jobs.find(j => j.status === 'running')

  if (!currentJob || !taskId) return

  try {
    const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${taskId}`, {
      headers: { 'X-Browser-Use-API-Key': apiKey }
    })

    if (!response.ok) return

    const status = await response.json() as BrowserUseTaskResponse
    const taskState = (status.state || status.status || '').toLowerCase()
    const isComplete = ['completed', 'success', 'succeeded', 'finished', 'done'].includes(taskState)
    const isFailed = ['failed', 'failure', 'error', 'stopped', 'cancelled'].includes(taskState)

    // Update current step from task progress
    if (status.steps && status.steps.length > 0) {
      const lastStep = status.steps[status.steps.length - 1]
      currentJob.current_step = lastStep.action || 'Processing...'
    }

    if (isComplete) {
      const output = status.output || ''
      currentJob.cost = status.cost || 0.03
      currentJob.completed_at = new Date().toISOString()

      // Check for confirmation email (ground truth for success)
      // Buffer 5 minutes before started_at to catch emails that arrive during form submission
      const checkAfterTime = currentJob.started_at
        ? new Date(new Date(currentJob.started_at).getTime() - 5 * 60 * 1000).toISOString()
        : new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const emailCheck = await checkForConfirmationEmail(currentJob.company, checkAfterTime)

      if (emailCheck.found) {
        // EMAIL RECEIVED = TRUE SUCCESS
        currentJob.status = 'success'
        currentJob.agent_success = true
        currentJob.email_verified = true
        currentJob.current_step = `Application confirmed! Email: ${emailCheck.subject}`
      } else {
        // No email - check browser-use output for explicit markers
        const agentClaimsSuccess = output.includes('APPLICATION_SUBMITTED_SUCCESSFULLY') ||
                       (output.toLowerCase().includes('application received') && output.toLowerCase().includes('thank you'))

        if (agentClaimsSuccess) {
          // Agent claims success but no email yet - mark as pending verification
          currentJob.status = 'success'  // Tentatively success
          currentJob.agent_success = true
          currentJob.email_verified = false
          currentJob.current_step = 'Submitted - awaiting email confirmation'
        } else {
          // Agent explicitly failed
          currentJob.status = 'failed'
          currentJob.agent_success = false
          currentJob.current_step = 'Application failed'
          currentJob.error_message = output ? output.substring(0, 500) : 'No output from browser-use'
        }
      }

      // Start next queued job
      const nextJob = jobs.find(j => j.status === 'queued')
      let nextTaskId: string | null = null

      if (nextJob) {
        nextJob.status = 'running'
        nextJob.started_at = new Date().toISOString()
        nextJob.current_step = 'Starting application...'
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
      }

      // Update session
      const completedCount = jobs.filter(j => j.status === 'success').length
      const failedCount = jobs.filter(j => j.status === 'failed').length
      const totalCost = jobs.reduce((sum, j) => sum + (parseFloat(String(j.cost)) || 0), 0)
      const allDone = !nextJob

      const { error: updateError } = await supabase
        .from('batch_sessions')
        .update({
          status: allDone ? 'complete' : 'active',
          completed_at: allDone ? new Date().toISOString() : null,
          jobs,
          total_cost: totalCost,
          completed_count: completedCount,
          failed_count: failedCount,
          current_job_task_id: nextTaskId
        })
        .eq('id', session.id)
      if (updateError) console.error('[peebo-batch] DB update failed:', updateError)

    } else if (isFailed) {
      currentJob.status = 'failed'
      currentJob.agent_success = false
      currentJob.completed_at = new Date().toISOString()
      currentJob.current_step = 'Application failed'
      currentJob.error_message = status.error || taskState || 'Task failed'
      currentJob.cost = status.cost || 0

      // Start next job
      const nextJob = jobs.find(j => j.status === 'queued')
      let nextTaskId: string | null = null

      if (nextJob) {
        nextJob.status = 'running'
        nextJob.started_at = new Date().toISOString()
        nextJob.current_step = 'Starting application...'
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
      }

      const completedCount = jobs.filter(j => j.status === 'success').length
      const failedCount = jobs.filter(j => j.status === 'failed').length
      const totalCost = jobs.reduce((sum, j) => sum + (parseFloat(String(j.cost)) || 0), 0)
      const allDone = !nextJob

      const { error: updateError2 } = await supabase
        .from('batch_sessions')
        .update({
          status: allDone ? 'complete' : 'active',
          completed_at: allDone ? new Date().toISOString() : null,
          jobs,
          total_cost: totalCost,
          completed_count: completedCount,
          failed_count: failedCount,
          current_job_task_id: nextTaskId
        })
        .eq('id', session.id)
      if (updateError2) console.error('[peebo-batch] DB update failed:', updateError2)
    } else {
      // Just update current step
      const { error: updateError } = await supabase
        .from('batch_sessions')
        .update({ jobs })
        .eq('id', session.id)
      if (updateError) console.error('[peebo-batch] DB update failed:', updateError)
    }
  } catch (error) {
    console.error('[peebo-batch] Job check error:', error)
  }
}

// Stop entire batch
async function handleStopBatch(
  sessionId: string,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const { data: session, error: fetchError } = await supabase
    .from('batch_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) {
    return jsonResponse({ error: 'Session not found' }, 404)
  }

  // Stop all queued/running jobs
  const jobs = (session.jobs || []).map((job: BatchJob) => {
    if (job.status === 'queued' || job.status === 'running') {
      return { ...job, status: 'stopped' }
    }
    return job
  })

  // Try to cancel any running browser-use tasks
  const apiKey = getBrowserUseApiKey()
  for (const job of jobs) {
    if (job.browser_use_task_id && job.status === 'stopped') {
      try {
        await fetch(`${BROWSER_USE_API_URL}/tasks/${job.browser_use_task_id}/cancel`, {
          method: 'POST',
          headers: { 'X-Browser-Use-API-Key': apiKey }
        })
      } catch (e) {
        console.error('Failed to cancel browser-use task:', e)
      }
    }
  }

  const { error: updateError } = await supabase
    .from('batch_sessions')
    .update({
      status: 'stopped',
      completed_at: new Date().toISOString(),
      jobs: jobs
    })
    .eq('id', sessionId)
  if (updateError) console.error('[peebo-batch] DB update failed:', updateError)

  return jsonResponse({ success: true, message: 'Batch stopped' })
}

// Pause batch
async function handlePauseBatch(
  sessionId: string,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const { data: session, error: fetchError } = await supabase
    .from('batch_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) {
    return jsonResponse({ error: 'Session not found' }, 404)
  }

  const { error: updateError } = await supabase
    .from('batch_sessions')
    .update({ status: 'paused' })
    .eq('id', sessionId)
  if (updateError) console.error('[peebo-batch] DB update failed:', updateError)

  return jsonResponse({ success: true, message: 'Batch paused' })
}

// Resume batch
async function handleResumeBatch(
  sessionId: string,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const { data: session, error: fetchError } = await supabase
    .from('batch_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) {
    return jsonResponse({ error: 'Session not found' }, 404)
  }

  const { error: updateError } = await supabase
    .from('batch_sessions')
    .update({ status: 'active' })
    .eq('id', sessionId)
  if (updateError) console.error('[peebo-batch] DB update failed:', updateError)

  return jsonResponse({ success: true, message: 'Batch resumed' })
}

// Format criteria summary for display
function formatCriteriaSummary(criteria: StartBatchRequest['criteria']): string {
  const parts = []
  if (criteria.target_roles?.length) {
    parts.push(`Roles: ${criteria.target_roles.join(', ')}`)
  }
  if (criteria.location) {
    parts.push(`Location: ${criteria.location}`)
  }
  if (criteria.salary_min) {
    parts.push(`Salary: $${Math.round(criteria.salary_min / 1000)}k+`)
  }
  return parts.join(' | ')
}
