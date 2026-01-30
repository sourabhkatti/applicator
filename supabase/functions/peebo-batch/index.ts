// Peebo Batch Apply Edge Function
// Handles bulk job application sessions with REAL browser-use API

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Browser-use Cloud API
const BROWSER_USE_API_URL = 'https://api.browser-use.com/api/v2'

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

  const sessionId = generateUUID()
  const criteriaSummary = formatCriteriaSummary(body.criteria)

  // Create session in database with scraping status
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
        resume_name: 'resume_optimized.txt'
      },
      jobs: [],
      total_cost: 0,
      completed_count: 0,
      failed_count: 0
    })

  if (insertError) {
    console.error('Failed to create session:', insertError)
    return jsonResponse({ error: 'Failed to create session' }, 500)
  }

  // Start job scraping with browser-use (async)
  scrapeJobsWithBrowserUse(sessionId, supabase, body)

  return jsonResponse({
    session_id: sessionId,
    status: 'scraping',
    message: 'Searching for matching jobs...'
  })
}

// Scrape jobs using browser-use Cloud API
async function scrapeJobsWithBrowserUse(
  sessionId: string,
  supabase: ReturnType<typeof createClient>,
  request: StartBatchRequest
) {
  try {
    const apiKey = getBrowserUseApiKey()
    const roles = request.criteria.target_roles?.join(', ') || 'Software Engineer'
    const location = request.criteria.location || 'Remote'
    const count = request.target_count

    // Create browser-use task to scrape job listings
    const scrapeTask = {
      task: `Search for ${count} job openings matching these criteria:
- Roles: ${roles}
- Location: ${location}
${request.criteria.salary_min ? `- Minimum salary: $${request.criteria.salary_min}` : ''}
${request.criteria.industries?.length ? `- Industries: ${request.criteria.industries.join(', ')}` : ''}

Instructions:
1. Go to LinkedIn Jobs (linkedin.com/jobs) or Indeed (indeed.com)
2. Search for "${roles}" in "${location}"
3. Find ${count} job postings that match the criteria
4. For each job, extract:
   - Company name
   - Job title/role
   - Direct application URL (the actual job posting URL, not the search results)
5. Return the results as a JSON array with format:
   [{"company": "Company Name", "role": "Job Title", "job_url": "https://..."}]

IMPORTANT: Only include jobs with direct application links. Skip jobs that require external redirects to company career pages without direct application forms.`,
      max_steps: 30,
      use_vision: true
    }

    console.log('[peebo-batch] Starting job scrape task...')

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
    const scrapeTaskId = taskResult.id || taskResult.task_id

    console.log('[peebo-batch] Scrape task created:', scrapeTaskId)

    // Poll for scrape task completion
    const jobs = await pollScrapeTask(scrapeTaskId, apiKey, request)

    if (jobs.length === 0) {
      await supabase
        .from('batch_sessions')
        .update({
          status: 'complete',
          completed_at: new Date().toISOString(),
          jobs: []
        })
        .eq('id', sessionId)
      return
    }

    // Update session with found jobs
    await supabase
      .from('batch_sessions')
      .update({
        status: 'active',
        jobs: jobs
      })
      .eq('id', sessionId)

    // Start applying to jobs
    processJobApplications(sessionId, supabase, request, jobs)

  } catch (error) {
    console.error('[peebo-batch] Scrape error:', error)
    await supabase
      .from('batch_sessions')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        jobs: []
      })
      .eq('id', sessionId)
  }
}

// Poll scrape task until complete
async function pollScrapeTask(
  taskId: string,
  apiKey: string,
  request: StartBatchRequest
): Promise<BatchJob[]> {
  const maxAttempts = 60 // 5 minutes max
  let attempts = 0

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)) // Poll every 5 seconds
    attempts++

    try {
      const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${taskId}`, {
        headers: { 'X-Browser-Use-API-Key': apiKey }
      })

      if (!response.ok) {
        console.error('[peebo-batch] Poll error:', response.status)
        continue
      }

      const status = await response.json() as BrowserUseTaskResponse
      console.log('[peebo-batch] Scrape task state:', status.state || status.status)

      if (status.state === 'completed' || status.state === 'success' || status.status === 'completed') {
        // Parse job listings from output
        return parseJobListings(status.output || '', request)
      }

      if (status.state === 'failed' || status.status === 'failed') {
        console.error('[peebo-batch] Scrape task failed:', status.error)
        return []
      }

    } catch (error) {
      console.error('[peebo-batch] Poll fetch error:', error)
    }
  }

  console.error('[peebo-batch] Scrape task timed out')
  return []
}

// Parse job listings from browser-use output
function parseJobListings(output: string, request: StartBatchRequest): BatchJob[] {
  const jobs: BatchJob[] = []

  try {
    // Try to find JSON array in output
    const jsonMatch = output.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      for (let i = 0; i < parsed.length && i < request.target_count; i++) {
        const item = parsed[i]
        jobs.push({
          id: generateUUID(),
          position: i + 1,
          company: item.company || 'Unknown',
          role: item.role || item.title || request.criteria.target_roles?.[0] || 'Unknown',
          job_url: item.job_url || item.url || '',
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
    }
  } catch (error) {
    console.error('[peebo-batch] Failed to parse job listings:', error)
  }

  return jobs
}

// Process job applications sequentially
async function processJobApplications(
  sessionId: string,
  supabase: ReturnType<typeof createClient>,
  request: StartBatchRequest,
  jobs: BatchJob[]
) {
  const apiKey = getBrowserUseApiKey()

  for (let i = 0; i < jobs.length; i++) {
    // Check session status
    const { data: session } = await supabase
      .from('batch_sessions')
      .select('status')
      .eq('id', sessionId)
      .single()

    if (!session || session.status === 'stopped' || session.status === 'paused') {
      console.log('[peebo-batch] Session stopped/paused, halting processing')
      return
    }

    const job = jobs[i]
    if (job.status !== 'queued') continue

    // Update job to running
    job.status = 'running'
    job.started_at = new Date().toISOString()
    job.current_step = 'Starting application...'

    await supabase
      .from('batch_sessions')
      .update({ jobs })
      .eq('id', sessionId)

    try {
      // Create browser-use task to apply
      const applyTask = {
        url: job.job_url,
        task: `Apply to this job posting at ${job.company}.

My Information:
- Name: ${request.user_info.name}
- Email: ${request.user_info.email}
- Phone: ${request.user_info.phone || 'Not provided'}
- LinkedIn: ${request.user_info.linkedin || 'Not provided'}

Resume:
${request.resume_text || 'Please fill in manually if required'}

Instructions:
1. You are at the job application page
2. Click the "Apply" or "Apply Now" button
3. Fill out all required fields with my information
4. Upload or paste my resume if needed
5. Answer any screening questions appropriately
6. Submit the application
7. Confirm the application was submitted successfully

IMPORTANT: Stay on this page. Do NOT navigate to other jobs or search pages.`,
        max_steps: 50,
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
      job.browser_use_task_id = taskResult.id || taskResult.task_id || null
      job.live_url = taskResult.live_url || `https://cloud.browser-use.com/task/${job.browser_use_task_id}`

      // Update with task ID
      await supabase
        .from('batch_sessions')
        .update({ jobs })
        .eq('id', sessionId)

      // Poll for application completion
      const result = await pollApplicationTask(job.browser_use_task_id!, apiKey, job, jobs, sessionId, supabase)

      job.status = result.success ? 'success' : 'failed'
      job.agent_success = result.success
      job.completed_at = new Date().toISOString()
      job.current_step = result.success ? 'Application submitted!' : 'Application failed'
      job.cost = result.cost || 0
      job.error_message = result.error || null

    } catch (error) {
      console.error(`[peebo-batch] Application error for ${job.company}:`, error)
      job.status = 'failed'
      job.agent_success = false
      job.completed_at = new Date().toISOString()
      job.current_step = 'Application failed'
      job.error_message = error.message
    }

    // Update session with job result
    const totalCost = jobs.reduce((sum, j) => sum + (j.cost || 0), 0)
    await supabase
      .from('batch_sessions')
      .update({ jobs, total_cost: totalCost })
      .eq('id', sessionId)
  }

  // Mark session as complete
  const completedCount = jobs.filter(j => j.status === 'success').length
  const failedCount = jobs.filter(j => j.status === 'failed').length

  await supabase
    .from('batch_sessions')
    .update({
      status: 'complete',
      completed_at: new Date().toISOString(),
      completed_count: completedCount,
      failed_count: failedCount
    })
    .eq('id', sessionId)

  console.log(`[peebo-batch] Session complete: ${completedCount} success, ${failedCount} failed`)
}

// Poll application task until complete
async function pollApplicationTask(
  taskId: string,
  apiKey: string,
  job: BatchJob,
  jobs: BatchJob[],
  sessionId: string,
  supabase: ReturnType<typeof createClient>
): Promise<{ success: boolean; cost?: number; error?: string }> {
  const maxAttempts = 120 // 10 minutes max per application
  let attempts = 0

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)) // Poll every 5 seconds
    attempts++

    // Check if session was stopped
    const { data: session } = await supabase
      .from('batch_sessions')
      .select('status')
      .eq('id', sessionId)
      .single()

    if (session?.status === 'stopped') {
      return { success: false, error: 'Session stopped by user' }
    }

    try {
      const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${taskId}`, {
        headers: { 'X-Browser-Use-API-Key': apiKey }
      })

      if (!response.ok) continue

      const status = await response.json() as BrowserUseTaskResponse

      // Update current step from task progress
      if (status.steps && status.steps.length > 0) {
        const lastStep = status.steps[status.steps.length - 1]
        job.current_step = lastStep.action || 'Processing...'
        await supabase.from('batch_sessions').update({ jobs }).eq('id', sessionId)
      }

      if (status.state === 'completed' || status.state === 'success' || status.status === 'completed') {
        // Check if application was actually successful
        const output = status.output || ''
        const success = output.toLowerCase().includes('submit') ||
                       output.toLowerCase().includes('success') ||
                       output.toLowerCase().includes('applied') ||
                       output.toLowerCase().includes('thank you')
        return { success, cost: status.cost || 0.03 }
      }

      if (status.state === 'failed' || status.status === 'failed') {
        return { success: false, cost: status.cost || 0, error: status.error || 'Task failed' }
      }

    } catch (error) {
      console.error('[peebo-batch] Poll application error:', error)
    }
  }

  return { success: false, error: 'Application timed out' }
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

  await supabase
    .from('batch_sessions')
    .update({
      status: 'stopped',
      completed_at: new Date().toISOString(),
      jobs: jobs
    })
    .eq('id', sessionId)

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

  await supabase
    .from('batch_sessions')
    .update({ status: 'paused' })
    .eq('id', sessionId)

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

  await supabase
    .from('batch_sessions')
    .update({ status: 'active' })
    .eq('id', sessionId)

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
