// Peebo Sync Apps Edge Function
// Syncs applications from Chrome storage to Supabase

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Application {
  id?: string
  company: string
  role: string
  job_url: string
  status: 'applied' | 'interviewing' | 'rejected' | 'offer'
  salary_range?: string
  applied_at: string
  notes?: string
  metadata?: Record<string, unknown>
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

    // Initialize Supabase client
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
    const { data: peeboUser, error: userError } = await supabase
      .from('peebo_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (userError || !peeboUser) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const { applications, action } = await req.json() as {
      applications: Application[]
      action: 'sync' | 'pull'
    }

    if (action === 'pull') {
      // Pull applications from Supabase
      const { data, error } = await supabase
        .from('peebo_applications')
        .select('*')
        .eq('user_id', peeboUser.id)
        .order('applied_at', { ascending: false })

      if (error) {
        throw error
      }

      return new Response(
        JSON.stringify({ applications: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sync applications to Supabase
    if (!applications || !Array.isArray(applications)) {
      return new Response(
        JSON.stringify({ error: 'Invalid applications data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const results = {
      created: 0,
      updated: 0,
      errors: [] as string[]
    }

    for (const app of applications) {
      try {
        if (app.id) {
          // Update existing application
          const { error } = await supabase
            .from('peebo_applications')
            .update({
              company: app.company,
              role: app.role,
              status: app.status,
              salary_range: app.salary_range,
              notes: app.notes,
              metadata: app.metadata,
              updated_at: new Date().toISOString()
            })
            .eq('id', app.id)
            .eq('user_id', peeboUser.id)

          if (error) {
            results.errors.push(`Failed to update ${app.company}: ${error.message}`)
          } else {
            results.updated++
          }
        } else {
          // Check if application already exists by URL
          const { data: existing } = await supabase
            .from('peebo_applications')
            .select('id')
            .eq('user_id', peeboUser.id)
            .eq('job_url', app.job_url)
            .single()

          if (existing) {
            // Update existing
            const { error } = await supabase
              .from('peebo_applications')
              .update({
                status: app.status,
                notes: app.notes,
                metadata: app.metadata,
                updated_at: new Date().toISOString()
              })
              .eq('id', existing.id)

            if (error) {
              results.errors.push(`Failed to update ${app.company}: ${error.message}`)
            } else {
              results.updated++
            }
          } else {
            // Create new application
            const { error } = await supabase
              .from('peebo_applications')
              .insert({
                user_id: peeboUser.id,
                company: app.company,
                role: app.role,
                job_url: app.job_url,
                status: app.status,
                salary_range: app.salary_range,
                applied_at: app.applied_at || new Date().toISOString(),
                notes: app.notes,
                metadata: app.metadata
              })

            if (error) {
              results.errors.push(`Failed to create ${app.company}: ${error.message}`)
            } else {
              results.created++
            }
          }
        }
      } catch (error) {
        results.errors.push(`Error processing ${app.company}: ${error.message}`)
      }
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Sync error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Sync failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
