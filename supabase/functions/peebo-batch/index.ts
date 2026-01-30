// Peebo Batch Apply Edge Function
// Handles bulk job application sessions with database persistence

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Types
interface BatchSession {
  id: string
  user_id: string
  status: 'setup' | 'scraping' | 'active' | 'complete' | 'stopped'
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

  // Generate mock jobs based on criteria for testing
  const mockJobs = generateMockJobs(body.target_count, body.criteria)

  // Create session in database
  const { error: insertError } = await supabase
    .from('batch_sessions')
    .insert({
      id: sessionId,
      user_id: 'anonymous',
      status: 'active', // Skip scraping since we have mock jobs
      started_at: new Date().toISOString(),
      config: {
        target_count: body.target_count,
        criteria_summary: criteriaSummary,
        resume_name: 'resume_optimized.txt'
      },
      jobs: mockJobs,
      total_cost: 0,
      completed_count: 0,
      failed_count: 0
    })

  if (insertError) {
    console.error('Failed to create session:', insertError)
    return jsonResponse({ error: 'Failed to create session' }, 500)
  }

  // Start background processing (simulate job applications)
  startBatchProcessing(sessionId, supabase, body)

  return jsonResponse({
    session_id: sessionId,
    status: 'active',
    message: 'Batch session started, processing jobs...'
  })
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

  // Stop all queued jobs
  const jobs = (session.jobs || []).map((job: BatchJob) => {
    if (job.status === 'queued' || job.status === 'running') {
      return { ...job, status: 'stopped' }
    }
    return job
  })

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

// Generate mock jobs for testing
function generateMockJobs(count: number, criteria: StartBatchRequest['criteria']): BatchJob[] {
  const companies = [
    { name: 'Stripe', url: 'https://stripe.com/jobs' },
    { name: 'Airbnb', url: 'https://careers.airbnb.com' },
    { name: 'Figma', url: 'https://www.figma.com/careers' },
    { name: 'Notion', url: 'https://www.notion.so/careers' },
    { name: 'Linear', url: 'https://linear.app/careers' },
    { name: 'Vercel', url: 'https://vercel.com/careers' },
    { name: 'Supabase', url: 'https://supabase.com/careers' },
    { name: 'Retool', url: 'https://retool.com/careers' },
    { name: 'Loom', url: 'https://www.loom.com/careers' },
    { name: 'Mercury', url: 'https://mercury.com/careers' }
  ]

  const role = criteria.target_roles?.[0] || 'Product Manager'

  return companies.slice(0, count).map((company, index) => ({
    id: generateUUID(),
    position: index + 1,
    company: company.name,
    role: role,
    job_url: company.url,
    status: 'queued' as const,
    browser_use_task_id: null,
    live_url: `https://cloud.browser-use.com/task/${generateUUID()}`,
    started_at: null,
    completed_at: null,
    current_step: null,
    agent_success: null,
    email_verified: false,
    error_message: null,
    cost: 0
  }))
}

// Background processing - simulates applying to jobs
async function startBatchProcessing(
  sessionId: string,
  supabase: ReturnType<typeof createClient>,
  request: StartBatchRequest
) {
  // Process jobs sequentially with delays to simulate real applications
  const processJob = async (jobIndex: number) => {
    // Re-fetch session to get current state
    const { data: session } = await supabase
      .from('batch_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (!session || session.status === 'stopped' || session.status === 'paused') {
      return // Stop processing
    }

    const jobs = session.jobs || []
    if (jobIndex >= jobs.length) {
      // All jobs processed
      await supabase
        .from('batch_sessions')
        .update({
          status: 'complete',
          completed_at: new Date().toISOString(),
          completed_count: jobs.filter((j: BatchJob) => j.status === 'success').length,
          failed_count: jobs.filter((j: BatchJob) => j.status === 'failed').length
        })
        .eq('id', sessionId)
      return
    }

    const job = jobs[jobIndex]
    if (job.status !== 'queued') {
      // Skip non-queued jobs
      processJob(jobIndex + 1)
      return
    }

    // Start this job
    job.status = 'running'
    job.started_at = new Date().toISOString()
    job.current_step = 'Navigating to application page...'

    await supabase
      .from('batch_sessions')
      .update({ jobs })
      .eq('id', sessionId)

    // Simulate application steps with delays
    const steps = [
      'Navigating to application page...',
      'Clicking apply button...',
      'Filling in personal information...',
      'Uploading resume...',
      'Answering screening questions...',
      'Submitting application...',
      'Confirming submission...'
    ]

    for (let i = 0; i < steps.length; i++) {
      // Check if stopped
      const { data: checkSession } = await supabase
        .from('batch_sessions')
        .select('status')
        .eq('id', sessionId)
        .single()

      if (checkSession?.status === 'stopped' || checkSession?.status === 'paused') {
        job.status = 'stopped'
        await supabase
          .from('batch_sessions')
          .update({ jobs })
          .eq('id', sessionId)
        return
      }

      job.current_step = steps[i]
      await supabase
        .from('batch_sessions')
        .update({ jobs })
        .eq('id', sessionId)

      // Simulate step taking 2-4 seconds
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000))
    }

    // Complete job (90% success rate for demo)
    const isSuccess = Math.random() > 0.1
    job.status = isSuccess ? 'success' : 'failed'
    job.agent_success = isSuccess
    job.completed_at = new Date().toISOString()
    job.current_step = isSuccess ? 'Application submitted successfully!' : 'Application failed'
    job.cost = 0.02 + Math.random() * 0.03 // $0.02-0.05 per application
    job.email_verified = isSuccess && Math.random() > 0.3 // 70% get confirmation emails

    if (!isSuccess) {
      job.error_message = 'Could not complete application - login required'
    }

    // Update total cost
    const totalCost = jobs.reduce((sum: number, j: BatchJob) => sum + (j.cost || 0), 0)

    await supabase
      .from('batch_sessions')
      .update({ jobs, total_cost: totalCost })
      .eq('id', sessionId)

    // Process next job after a short delay
    setTimeout(() => processJob(jobIndex + 1), 1000)
  }

  // Start processing first job
  processJob(0)
}
