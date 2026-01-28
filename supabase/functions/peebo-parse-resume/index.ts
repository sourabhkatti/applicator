import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get authenticated user
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get user's parse usage
    const { data: peeboUser, error: userError } = await supabaseClient
      .from('peebo_users')
      .select('resume_parses_used, resume_parse_limit')
      .eq('auth_user_id', user.id)
      .single()

    if (userError || !peeboUser) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check usage limit
    if (peeboUser.resume_parses_used >= peeboUser.resume_parse_limit) {
      return new Response(
        JSON.stringify({
          error: 'Parse limit reached',
          message: `You've used all ${peeboUser.resume_parse_limit} free resume parses. Upgrade to premium for unlimited parsing.`,
          upgrade_required: true
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const { resume_text } = await req.json()

    if (!resume_text || typeof resume_text !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid request. resume_text is required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Call OpenRouter API with Claude Haiku
    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!openrouterKey) {
      return new Response(
        JSON.stringify({ error: 'OpenRouter API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const systemPrompt = `You are a resume parsing assistant. Extract structured information from the provided resume text.

Return ONLY valid JSON with these fields:
{
  "full_name": "Full name of the person",
  "email": "Email address",
  "phone": "Phone number with country code",
  "location": "City, State or City, Country",
  "linkedin_url": "LinkedIn profile URL if present, otherwise null",
  "current_or_recent_title": "Most recent job title",
  "background_summary": "2-3 sentence summary of professional background",
  "key_achievements": ["Achievement 1", "Achievement 2", "Achievement 3"],
  "skills": ["Skill 1", "Skill 2", "Skill 3"],
  "work_history": [
    {
      "company": "Company name",
      "title": "Job title",
      "duration": "Time period (e.g., '2020-2023')",
      "description": "Brief description of role"
    }
  ],
  "education": [
    {
      "institution": "School name",
      "degree": "Degree earned",
      "year": "Graduation year"
    }
  ]
}

If a field is not found, use null for strings and [] for arrays. Ensure all JSON is properly formatted.`

    const openrouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://peebo.app',
        'X-Title': 'Peebo Resume Parser'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-haiku-20240307',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: resume_text
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    })

    if (!openrouterResponse.ok) {
      const errorText = await openrouterResponse.text()
      console.error('OpenRouter API error:', errorText)
      return new Response(
        JSON.stringify({ error: 'Failed to parse resume', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const openrouterData = await openrouterResponse.json()
    const parsedContent = openrouterData.choices[0].message.content

    // Try to parse the JSON response
    let parsedData
    try {
      parsedData = JSON.parse(parsedContent)
    } catch (parseError) {
      console.error('Failed to parse OpenRouter response as JSON:', parsedContent)
      return new Response(
        JSON.stringify({ error: 'Invalid response from AI', raw_response: parsedContent }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Add original resume text to response
    parsedData.resume_text = resume_text

    // Increment usage count
    await supabaseClient
      .from('peebo_users')
      .update({ resume_parses_used: peeboUser.resume_parses_used + 1 })
      .eq('auth_user_id', user.id)

    return new Response(
      JSON.stringify(parsedData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in peebo-parse-resume:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
