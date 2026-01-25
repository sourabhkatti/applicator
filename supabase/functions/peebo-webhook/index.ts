// Peebo Webhook Edge Function
// Handles Stripe webhook events for subscription management

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get Stripe signature
    const signature = req.headers.get('stripe-signature')
    if (!signature) {
      return new Response(
        JSON.stringify({ error: 'Missing Stripe signature' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Stripe
    const stripeSecretKey = Deno.env.get('PEEBO_STRIPE_SECRET_KEY')
    const webhookSecret = Deno.env.get('PEEBO_STRIPE_WEBHOOK_SECRET')

    if (!stripeSecretKey || !webhookSecret) {
      throw new Error('Stripe configuration missing')
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // Get raw body for signature verification
    const body = await req.text()

    // Verify webhook signature
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client with service role (for admin operations)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        if (session.mode === 'subscription' && session.subscription) {
          const peeboUserId = session.metadata?.peebo_user_id

          if (peeboUserId) {
            // Upgrade user to premium
            const { error } = await supabase
              .from('peebo_users')
              .update({
                tier: 'premium',
                stripe_subscription_id: session.subscription as string,
                monthly_app_limit: -1, // Unlimited
                updated_at: new Date().toISOString()
              })
              .eq('id', peeboUserId)

            if (error) {
              console.error('Failed to upgrade user:', error)
              throw error
            }

            console.log(`User ${peeboUserId} upgraded to premium`)
          }
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const peeboUserId = subscription.metadata?.peebo_user_id

        if (peeboUserId) {
          // Downgrade user to free
          const { error } = await supabase
            .from('peebo_users')
            .update({
              tier: 'free',
              stripe_subscription_id: null,
              monthly_app_limit: 5,
              updated_at: new Date().toISOString()
            })
            .eq('id', peeboUserId)

          if (error) {
            console.error('Failed to downgrade user:', error)
            throw error
          }

          console.log(`User ${peeboUserId} downgraded to free`)
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const peeboUserId = subscription.metadata?.peebo_user_id

        if (peeboUserId) {
          // Check if subscription is still active
          const isActive = ['active', 'trialing'].includes(subscription.status)

          const { error } = await supabase
            .from('peebo_users')
            .update({
              tier: isActive ? 'premium' : 'free',
              monthly_app_limit: isActive ? -1 : 5,
              updated_at: new Date().toISOString()
            })
            .eq('id', peeboUserId)

          if (error) {
            console.error('Failed to update user subscription status:', error)
            throw error
          }

          console.log(`User ${peeboUserId} subscription updated: ${subscription.status}`)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        // Get user by Stripe customer ID
        const { data: peeboUser } = await supabase
          .from('peebo_users')
          .select('id, email')
          .eq('stripe_customer_id', customerId)
          .single()

        if (peeboUser) {
          // Log the payment failure for analytics/notifications
          await supabase.from('peebo_usage_logs').insert({
            user_id: peeboUser.id,
            action: 'application_failed', // Reusing existing action type
            metadata: {
              type: 'payment_failed',
              invoice_id: invoice.id,
              amount: invoice.amount_due
            }
          })

          console.log(`Payment failed for user ${peeboUser.id}`)
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Webhook processing failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
