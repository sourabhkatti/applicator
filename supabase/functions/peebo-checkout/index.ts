// Peebo Checkout Edge Function
// Creates Stripe checkout session for premium upgrade

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
      .select('*')
      .eq('auth_user_id', user.id)
      .single()

    if (userError || !peeboUser) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Already premium
    if (peeboUser.tier === 'premium') {
      return new Response(
        JSON.stringify({ error: 'Already subscribed to premium' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Stripe
    const stripeSecretKey = Deno.env.get('PEEBO_STRIPE_SECRET_KEY')
    if (!stripeSecretKey) {
      throw new Error('Stripe secret key not configured')
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // Parse request body
    const { priceId } = await req.json()

    // Default to monthly if no price ID provided
    const selectedPriceId = priceId || Deno.env.get('PEEBO_STRIPE_PRICE_MONTHLY')

    // Get or create Stripe customer
    let customerId = peeboUser.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: peeboUser.email,
        metadata: {
          peebo_user_id: peeboUser.id,
          supabase_user_id: user.id
        }
      })
      customerId = customer.id

      // Save customer ID
      await supabase
        .from('peebo_users')
        .update({ stripe_customer_id: customerId })
        .eq('id', peeboUser.id)
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: selectedPriceId,
          quantity: 1,
        },
      ],
      success_url: `${req.headers.get('origin') || 'chrome-extension://peebo'}/tracker/tracker.html?upgrade=success`,
      cancel_url: `${req.headers.get('origin') || 'chrome-extension://peebo'}/popup/popup.html?upgrade=cancelled`,
      metadata: {
        peebo_user_id: peeboUser.id,
      },
      subscription_data: {
        metadata: {
          peebo_user_id: peeboUser.id,
        },
      },
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Checkout error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create checkout session' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
