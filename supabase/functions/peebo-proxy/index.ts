// Peebo Proxy Edge Function
// Forwards requests to browser-use Cloud with master API key
// Enforces usage limits for free tier users

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PeeboUser {
  id: string
  auth_user_id: string
  email: string
  tier: 'free' | 'premium'
  monthly_app_limit: number
  apps_used_this_month: number
  current_period_start: string
  full_name?: string
  resume_text?: string
  linkedin_url?: string
  target_roles?: string[]
}

interface BrowserUseRequest {
  task: string
  jobUrl: string
  resumeText?: string
  userInfo?: {
    fullName: string
    email: string
    phone?: string
    location?: string
    linkedinUrl?: string
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client with user's JWT
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get Peebo user
    const { data: peeboUsers, error: userError } = await supabase
      .from('peebo_users')
      .select('*')
      .eq('auth_user_id', user.id)
      .single()

    if (userError || !peeboUsers) {
      return new Response(
        JSON.stringify({ error: 'User profile not found. Please complete onboarding.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const peeboUser = peeboUsers as PeeboUser

    // Check if user can apply (usage limits)
    const { data: canApply } = await supabase
      .rpc('peebo_can_apply', { p_user_id: peeboUser.id })

    if (!canApply) {
      const { data: remaining } = await supabase
        .rpc('peebo_remaining_apps', { p_user_id: peeboUser.id })

      return new Response(
        JSON.stringify({
          error: 'Monthly application limit reached',
          remaining: remaining,
          tier: peeboUser.tier,
          upgrade_url: `${supabaseUrl}/functions/v1/peebo-checkout`
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body = await req.json() as BrowserUseRequest

    // Log the application start
    await supabase.from('peebo_usage_logs').insert({
      user_id: peeboUser.id,
      action: 'application_started',
      job_url: body.jobUrl,
      metadata: { task: body.task }
    })

    // Get browser-use API key
    const browserUseKey = Deno.env.get('PEEBO_BROWSER_USE_KEY')
    if (!browserUseKey) {
      throw new Error('Browser-use API key not configured')
    }

    // Prepare the task for browser-use
    const browserUseTask = buildBrowserUseTask(body, peeboUser)

    // Forward to browser-use Cloud API
    const startTime = Date.now()
    const browserUseResponse = await fetch('https://api.browser-use.com/api/v1/run-task', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${browserUseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task: browserUseTask,
        save_browser_data: true
      })
    })

    const result = await browserUseResponse.json()
    const duration = Date.now() - startTime

    if (browserUseResponse.ok && result.id) {
      // Log success and increment usage
      await Promise.all([
        supabase.rpc('increment_peebo_usage', { p_user_id: peeboUser.id }),
        supabase.from('peebo_usage_logs').insert({
          user_id: peeboUser.id,
          action: 'application_completed',
          job_url: body.jobUrl,
          browser_use_task_id: result.id,
          duration_ms: duration
        })
      ])

      return new Response(
        JSON.stringify({
          success: true,
          taskId: result.id,
          message: 'Application started successfully'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      // Log failure
      await supabase.from('peebo_usage_logs').insert({
        user_id: peeboUser.id,
        action: 'application_failed',
        job_url: body.jobUrl,
        error_message: result.error || 'Unknown error',
        duration_ms: duration
      })

      return new Response(
        JSON.stringify({
          success: false,
          error: result.error || 'Failed to start application'
        }),
        { status: browserUseResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (error) {
    console.error('Peebo proxy error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Build the task string for browser-use
function buildBrowserUseTask(request: BrowserUseRequest, user: PeeboUser): string {
  const userInfo = request.userInfo || {
    fullName: user.full_name || '',
    email: user.email,
    linkedinUrl: user.linkedin_url || ''
  }

  return `
Apply to the job at: ${request.jobUrl}

Use the following information to fill out the application:
- Full Name: ${userInfo.fullName}
- Email: ${userInfo.email}
${userInfo.phone ? `- Phone: ${userInfo.phone}` : ''}
${userInfo.location ? `- Location: ${userInfo.location}` : ''}
${userInfo.linkedinUrl ? `- LinkedIn: ${userInfo.linkedinUrl}` : ''}

${request.resumeText ? `Resume content to copy/paste if needed:\n${request.resumeText.substring(0, 2000)}` : ''}

Instructions:
1. Navigate to the job URL
2. Click on the apply button
3. Fill in all required fields with the provided information
4. Upload the resume if there's a file upload field
5. Answer any screening questions appropriately based on the resume content
6. Submit the application
7. Confirm the application was submitted successfully

Important:
- Do not agree to any terms or consent forms without explicit approval
- If there's a CAPTCHA, stop and report it
- If login is required, stop and report it
- Take screenshots at key steps for verification
`.trim()
}
