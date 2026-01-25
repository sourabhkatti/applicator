-- Peebo tables and RLS policies
-- All tables prefixed with peebo_ to avoid conflicts

-- Peebo users (linked to Supabase Auth)
CREATE TABLE peebo_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
  monthly_app_limit INTEGER DEFAULT 5,
  apps_used_this_month INTEGER DEFAULT 0,
  current_period_start TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  -- User profile data from onboarding
  full_name TEXT,
  phone TEXT,
  location TEXT,
  linkedin_url TEXT,
  resume_text TEXT,
  target_roles TEXT[],
  salary_minimum INTEGER,
  location_preference TEXT CHECK (location_preference IN ('remote', 'hybrid', 'onsite', 'any')),
  industries TEXT[],
  authorized_to_work_us BOOLEAN DEFAULT true,
  requires_sponsorship BOOLEAN DEFAULT false,
  exclude_companies TEXT[],
  exclude_platforms TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Job applications tracked by Peebo
CREATE TABLE peebo_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES peebo_users(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  job_url TEXT,
  status TEXT DEFAULT 'applied' CHECK (status IN ('applied', 'interviewing', 'rejected', 'offer')),
  salary_range TEXT,
  applied_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  browser_use_task_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Usage logs for analytics
CREATE TABLE peebo_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES peebo_users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('application_started', 'application_completed', 'application_failed', 'resume_optimized')),
  job_url TEXT,
  browser_use_task_id TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX idx_peebo_users_auth_user_id ON peebo_users(auth_user_id);
CREATE INDEX idx_peebo_users_email ON peebo_users(email);
CREATE INDEX idx_peebo_applications_user_id ON peebo_applications(user_id);
CREATE INDEX idx_peebo_applications_status ON peebo_applications(status);
CREATE INDEX idx_peebo_applications_applied_at ON peebo_applications(applied_at DESC);
CREATE INDEX idx_peebo_usage_logs_user_id ON peebo_usage_logs(user_id);
CREATE INDEX idx_peebo_usage_logs_created_at ON peebo_usage_logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE peebo_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE peebo_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE peebo_usage_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for peebo_users
CREATE POLICY "Users can view own profile" ON peebo_users
  FOR SELECT USING (auth.uid() = auth_user_id);

CREATE POLICY "Users can update own profile" ON peebo_users
  FOR UPDATE USING (auth.uid() = auth_user_id);

CREATE POLICY "Users can insert own profile" ON peebo_users
  FOR INSERT WITH CHECK (auth.uid() = auth_user_id);

-- RLS Policies for peebo_applications
CREATE POLICY "Users can view own applications" ON peebo_applications
  FOR SELECT USING (user_id IN (SELECT id FROM peebo_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can insert own applications" ON peebo_applications
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM peebo_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can update own applications" ON peebo_applications
  FOR UPDATE USING (user_id IN (SELECT id FROM peebo_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can delete own applications" ON peebo_applications
  FOR DELETE USING (user_id IN (SELECT id FROM peebo_users WHERE auth_user_id = auth.uid()));

-- RLS Policies for peebo_usage_logs
CREATE POLICY "Users can view own logs" ON peebo_usage_logs
  FOR SELECT USING (user_id IN (SELECT id FROM peebo_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can insert own logs" ON peebo_usage_logs
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM peebo_users WHERE auth_user_id = auth.uid()));

-- Function to increment usage count
CREATE OR REPLACE FUNCTION increment_peebo_usage(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_period TIMESTAMPTZ;
BEGIN
  -- Get the start of current month
  v_current_period := date_trunc('month', now());

  -- Reset counter if new month
  UPDATE peebo_users
  SET
    apps_used_this_month = CASE
      WHEN current_period_start < v_current_period THEN 1
      ELSE apps_used_this_month + 1
    END,
    current_period_start = v_current_period,
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;

-- Function to check if user can apply (within limits)
CREATE OR REPLACE FUNCTION peebo_can_apply(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user peebo_users%ROWTYPE;
  v_current_period TIMESTAMPTZ;
BEGIN
  v_current_period := date_trunc('month', now());

  SELECT * INTO v_user FROM peebo_users WHERE id = p_user_id;

  IF v_user IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Premium users have unlimited applications
  IF v_user.tier = 'premium' THEN
    RETURN TRUE;
  END IF;

  -- Reset counter if new month
  IF v_user.current_period_start < v_current_period THEN
    RETURN TRUE;
  END IF;

  -- Check if under limit
  RETURN v_user.apps_used_this_month < v_user.monthly_app_limit;
END;
$$;

-- Function to get remaining applications for the month
CREATE OR REPLACE FUNCTION peebo_remaining_apps(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user peebo_users%ROWTYPE;
  v_current_period TIMESTAMPTZ;
BEGIN
  v_current_period := date_trunc('month', now());

  SELECT * INTO v_user FROM peebo_users WHERE id = p_user_id;

  IF v_user IS NULL THEN
    RETURN 0;
  END IF;

  -- Premium users have unlimited
  IF v_user.tier = 'premium' THEN
    RETURN -1; -- -1 indicates unlimited
  END IF;

  -- Reset counter if new month
  IF v_user.current_period_start < v_current_period THEN
    RETURN v_user.monthly_app_limit;
  END IF;

  RETURN GREATEST(0, v_user.monthly_app_limit - v_user.apps_used_this_month);
END;
$$;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_peebo_users_updated_at
  BEFORE UPDATE ON peebo_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_peebo_applications_updated_at
  BEFORE UPDATE ON peebo_applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
