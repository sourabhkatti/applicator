// Peebo AgentMail Webhook Handler
// Receives webhook events from AgentMail and extracts verification codes from emails

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agentmail-signature',
}

interface AgentMailWebhookEvent {
  event: string
  data: {
    message_id: string
    inbox_id: string
    from_address: string
    to_address: string
    subject: string
    body_text?: string
    body_html?: string
    received_at: string
  }
}

// Verify HMAC-SHA256 signature from AgentMail
async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Constant-time comparison
    if (expectedSignature.length !== signature.length) return false
    let result = 0
    for (let i = 0; i < expectedSignature.length; i++) {
      result |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i)
    }
    return result === 0
  } catch (error) {
    console.error('[webhook] Signature verification error:', error)
    return false
  }
}

// Extract company name from email subject
// Pattern: "Security code for your application to {Company}"
function extractCompanyFromSubject(subject: string): string | null {
  // Greenhouse pattern
  const greenhouseMatch = subject.match(/Security code for your application to (.+)/i)
  if (greenhouseMatch) {
    return greenhouseMatch[1].trim()
  }

  // Lever pattern
  const leverMatch = subject.match(/Verify your email for (.+)/i)
  if (leverMatch) {
    return leverMatch[1].trim()
  }

  // Ashby pattern
  const ashbyMatch = subject.match(/Your verification code for (.+)/i)
  if (ashbyMatch) {
    return ashbyMatch[1].trim()
  }

  // Generic pattern - look for company name after common phrases
  const genericMatch = subject.match(/(?:code|verify|verification|confirm).*?(?:for|to|at)\s+(.+?)(?:\s*-|\s*$)/i)
  if (genericMatch) {
    return genericMatch[1].trim()
  }

  return null
}

// Extract verification code from email body
// Typically 6-8 character alphanumeric code, often on its own line or highlighted
function extractCodeFromBody(body: string): string | null {
  if (!body) return null

  // Clean HTML if present
  let text = body
    .replace(/<[^>]+>/g, ' ')  // Remove HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Pattern 1: Code on its own line or surrounded by whitespace (most common)
  // Look for 6-8 char alphanumeric codes
  const standaloneMatch = text.match(/(?:^|\s)([A-Z0-9]{6,8})(?:\s|$)/i)
  if (standaloneMatch) {
    return standaloneMatch[1].toUpperCase()
  }

  // Pattern 2: Code after "code:" or "code is" etc.
  const codeAfterLabel = text.match(/(?:code|verification|security)[\s:]+([A-Z0-9]{6,8})/i)
  if (codeAfterLabel) {
    return codeAfterLabel[1].toUpperCase()
  }

  // Pattern 3: Bold or emphasized code (in HTML body)
  const emphMatch = body.match(/<(?:strong|b|em)>([A-Z0-9]{6,8})<\/(?:strong|b|em)>/i)
  if (emphMatch) {
    return emphMatch[1].toUpperCase()
  }

  // Pattern 4: Code in a large font or styled div
  const styledMatch = body.match(/(?:font-size|style)[^>]*>([A-Z0-9]{6,8})</i)
  if (styledMatch) {
    return styledMatch[1].toUpperCase()
  }

  return null
}

// Main handler
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const webhookSecret = Deno.env.get('AGENTMAIL_WEBHOOK_SECRET')
    const rawBody = await req.text()

    // Verify signature if secret is configured
    if (webhookSecret) {
      const signature = req.headers.get('x-agentmail-signature') || ''
      // AgentMail may send signature in format "sha256=<hex>" or just "<hex>"
      const signatureHex = signature.replace(/^sha256=/, '')

      if (!signatureHex) {
        console.error('[webhook] Missing signature header')
        return new Response(JSON.stringify({ error: 'Missing signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const isValid = await verifySignature(rawBody, signatureHex, webhookSecret)
      if (!isValid) {
        console.error('[webhook] Invalid signature')
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    } else {
      console.warn('[webhook] AGENTMAIL_WEBHOOK_SECRET not configured - skipping signature verification')
    }

    // Parse the webhook event
    const event: AgentMailWebhookEvent = JSON.parse(rawBody)
    console.log('[webhook] Received event:', event.event, 'message_id:', event.data?.message_id)

    // Only process message.received events
    if (event.event !== 'message.received') {
      console.log('[webhook] Ignoring non-message event:', event.event)
      return new Response(JSON.stringify({ status: 'ignored', reason: 'not a message event' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { message_id, from_address, subject, body_text, body_html } = event.data

    // Check if this is a verification code email
    const company = extractCompanyFromSubject(subject)
    if (!company) {
      console.log('[webhook] Not a verification code email:', subject)
      return new Response(JSON.stringify({ status: 'ignored', reason: 'not a verification email' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Extract the code from body (prefer text, fall back to HTML)
    const code = extractCodeFromBody(body_text || '') || extractCodeFromBody(body_html || '')
    if (!code) {
      console.error('[webhook] Could not extract code from email body')
      console.error('[webhook] Subject:', subject)
      console.error('[webhook] Body preview:', (body_text || body_html || '').substring(0, 500))
      return new Response(JSON.stringify({ status: 'failed', reason: 'could not extract code' }), {
        status: 200,  // Return 200 to prevent webhook retry
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[webhook] Extracted verification code:', code, 'for company:', company)

    // Store in database
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { error: insertError } = await supabase
      .from('peebo_verification_codes')
      .insert({
        company,
        code,
        email_subject: subject,
        email_from: from_address,
        agentmail_message_id: message_id,
        status: 'pending',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      })

    if (insertError) {
      // Check for duplicate message_id (already processed)
      if (insertError.code === '23505') {  // unique_violation
        console.log('[webhook] Duplicate message, already processed:', message_id)
        return new Response(JSON.stringify({ status: 'duplicate' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      console.error('[webhook] Database insert error:', insertError)
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[webhook] Successfully stored verification code for', company)
    return new Response(JSON.stringify({
      status: 'success',
      company,
      code_stored: true
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[webhook] Error processing webhook:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
