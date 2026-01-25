// Peebo Popup Logic

// Supabase configuration
const SUPABASE_URL = 'https://diplqphbqlomcvlujcxd.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // Replace with actual key

// State
let currentUser = null;
let peeboUser = null;
let isApplying = false;

// DOM Elements
const authSection = document.getElementById('auth-section');
const onboardingSection = document.getElementById('onboarding-section');
const applySection = document.getElementById('apply-section');
const signInBtn = document.getElementById('sign-in-btn');
const completeSetupBtn = document.getElementById('complete-setup-btn');
const jobUrlInput = document.getElementById('job-url');
const applyBtn = document.getElementById('apply-btn');
const applyDetectedBtn = document.getElementById('apply-detected-btn');
const detectedJob = document.getElementById('detected-job');
const detectedCompanyRole = document.getElementById('detected-company-role');
const progressSection = document.getElementById('progress-section');
const progressStatus = document.getElementById('progress-status');
const progressFill = document.getElementById('progress-fill');
const progressDetail = document.getElementById('progress-detail');
const cancelBtn = document.getElementById('cancel-btn');
const trackerBtn = document.getElementById('tracker-btn');
const historyBtn = document.getElementById('history-btn');
const settingsBtn = document.getElementById('settings-btn');
const upgradeBtn = document.getElementById('upgrade-btn');
const usageText = document.getElementById('usage-text');
const usageFill = document.getElementById('usage-fill');
const mascot = document.getElementById('mascot');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastIcon = document.getElementById('toast-icon');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthState();
  setupEventListeners();
  checkCurrentTab();
});

// Check authentication state
async function checkAuthState() {
  try {
    const result = await chrome.storage.local.get(['session', 'peeboUser']);

    if (result.session && result.peeboUser) {
      currentUser = result.session.user;
      peeboUser = result.peeboUser;

      if (isOnboardingComplete(peeboUser)) {
        showSection('apply');
        updateUsageMeter();
      } else {
        showSection('onboarding');
      }
    } else if (result.session) {
      currentUser = result.session.user;
      await fetchPeeboUser();
    } else {
      showSection('auth');
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    showSection('auth');
  }
}

// Fetch Peebo user from Supabase
async function fetchPeeboUser() {
  try {
    const session = await chrome.storage.local.get('session');
    if (!session.session?.access_token) {
      showSection('auth');
      return;
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/peebo_users?auth_user_id=eq.${currentUser.id}`, {
      headers: {
        'Authorization': `Bearer ${session.session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      }
    });

    const users = await response.json();

    if (users.length > 0) {
      peeboUser = users[0];
      await chrome.storage.local.set({ peeboUser });

      if (isOnboardingComplete(peeboUser)) {
        showSection('apply');
        updateUsageMeter();
      } else {
        showSection('onboarding');
      }
    } else {
      // Create new Peebo user
      await createPeeboUser();
    }
  } catch (error) {
    console.error('Failed to fetch Peebo user:', error);
    showToast('Failed to load profile', 'error');
  }
}

// Create new Peebo user
async function createPeeboUser() {
  try {
    const session = await chrome.storage.local.get('session');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/peebo_users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        auth_user_id: currentUser.id,
        email: currentUser.email,
      })
    });

    const users = await response.json();
    peeboUser = users[0];
    await chrome.storage.local.set({ peeboUser });
    showSection('onboarding');
  } catch (error) {
    console.error('Failed to create Peebo user:', error);
    showToast('Failed to create profile', 'error');
  }
}

// Check if onboarding is complete
function isOnboardingComplete(user) {
  return user && user.full_name && user.resume_text;
}

// Show specific section
function showSection(section) {
  authSection.classList.add('hidden');
  onboardingSection.classList.add('hidden');
  applySection.classList.add('hidden');

  switch (section) {
    case 'auth':
      authSection.classList.remove('hidden');
      break;
    case 'onboarding':
      onboardingSection.classList.remove('hidden');
      break;
    case 'apply':
      applySection.classList.remove('hidden');
      break;
  }
}

// Update usage meter
function updateUsageMeter() {
  if (!peeboUser) return;

  const { apps_used_this_month, monthly_app_limit, tier } = peeboUser;

  if (tier === 'premium') {
    usageText.textContent = 'Unlimited applications';
    usageFill.style.width = '100%';
    usageFill.classList.add('success');
    upgradeBtn.classList.add('hidden');
  } else {
    const remaining = monthly_app_limit - apps_used_this_month;
    usageText.textContent = `${apps_used_this_month} of ${monthly_app_limit} applications this month`;
    usageFill.style.width = `${(apps_used_this_month / monthly_app_limit) * 100}%`;

    if (remaining <= 1) {
      upgradeBtn.classList.remove('hidden');
    }
  }
}

// Setup event listeners
function setupEventListeners() {
  // Sign in
  signInBtn.addEventListener('click', handleSignIn);

  // Complete setup
  completeSetupBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
    window.close();
  });

  // URL input
  jobUrlInput.addEventListener('input', (e) => {
    applyBtn.disabled = !isValidJobUrl(e.target.value);
  });

  jobUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !applyBtn.disabled) {
      handleApply();
    }
  });

  // Apply buttons
  applyBtn.addEventListener('click', handleApply);
  applyDetectedBtn.addEventListener('click', handleApplyDetected);

  // Cancel
  cancelBtn.addEventListener('click', handleCancel);

  // Navigation
  trackerBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('tracker/tracker.html') });
  });

  historyBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('tracker/tracker.html?view=history') });
  });

  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html?tab=settings') });
  });

  // Upgrade
  upgradeBtn.addEventListener('click', handleUpgrade);
}

// Handle sign in
async function handleSignIn() {
  try {
    signInBtn.disabled = true;
    signInBtn.innerHTML = '<div class="loading-spinner"></div> Signing in...';

    // Use Chrome identity API for Google sign-in
    const redirectUrl = chrome.identity.getRedirectURL();
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    });

    // Parse the response URL for tokens
    const url = new URL(responseUrl);
    const hashParams = new URLSearchParams(url.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (accessToken) {
      // Get user info
      const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': SUPABASE_ANON_KEY,
        }
      });

      const user = await userResponse.json();

      // Store session
      const session = {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: user
      };

      await chrome.storage.local.set({ session });
      currentUser = user;

      await fetchPeeboUser();
    }
  } catch (error) {
    console.error('Sign in failed:', error);
    showToast('Sign in failed', 'error');
  } finally {
    signInBtn.disabled = false;
    signInBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="10" cy="6" r="4"/>
        <path d="M2 18c0-4 3.5-7 8-7s8 3 8 7"/>
      </svg>
      Sign in with Google
    `;
  }
}

// Handle apply
async function handleApply() {
  const url = jobUrlInput.value.trim();
  if (!isValidJobUrl(url)) return;

  await startApplication(url);
}

// Handle apply from detected job
async function handleApplyDetected() {
  const url = detectedJob.dataset.url;
  if (!url) return;

  await startApplication(url);
}

// Start application process
async function startApplication(jobUrl) {
  if (isApplying) return;

  // Check usage limits
  if (peeboUser.tier !== 'premium' &&
      peeboUser.apps_used_this_month >= peeboUser.monthly_app_limit) {
    showToast('Monthly limit reached. Upgrade for unlimited!', 'error');
    upgradeBtn.classList.remove('hidden');
    return;
  }

  isApplying = true;
  setMascotState('working');
  showProgress();

  try {
    // Send application request to service worker
    const response = await chrome.runtime.sendMessage({
      type: 'START_APPLICATION',
      jobUrl: jobUrl,
      userId: peeboUser.id
    });

    if (response.success) {
      // Poll for progress updates
      pollProgress(response.taskId);
    } else {
      throw new Error(response.error || 'Failed to start application');
    }
  } catch (error) {
    console.error('Application failed:', error);
    showToast(error.message || 'Application failed', 'error');
    hideProgress();
    setMascotState('error');
    isApplying = false;
  }
}

// Poll for progress updates
async function pollProgress(taskId) {
  const pollInterval = setInterval(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_PROGRESS',
        taskId: taskId
      });

      if (response.status === 'completed') {
        clearInterval(pollInterval);
        onApplicationComplete(response);
      } else if (response.status === 'failed') {
        clearInterval(pollInterval);
        onApplicationFailed(response.error);
      } else {
        updateProgress(response.progress, response.message);
      }
    } catch (error) {
      console.error('Progress check failed:', error);
    }
  }, 1000);

  // Store interval ID for cleanup
  window.currentPollInterval = pollInterval;
}

// Update progress UI
function updateProgress(percent, message) {
  progressFill.style.width = `${percent}%`;
  progressStatus.textContent = message || 'Applying...';
  progressDetail.textContent = getProgressDetail(percent);
}

// Get progress detail message
function getProgressDetail(percent) {
  if (percent < 20) return 'Optimizing resume for this role...';
  if (percent < 40) return 'Navigating to application page...';
  if (percent < 60) return 'Filling in your details...';
  if (percent < 80) return 'Uploading resume...';
  if (percent < 95) return 'Submitting application...';
  return 'Almost done...';
}

// Show progress section
function showProgress() {
  progressSection.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressStatus.textContent = 'Preparing application...';
  progressDetail.textContent = '';
  applyBtn.disabled = true;
  jobUrlInput.disabled = true;
}

// Hide progress section
function hideProgress() {
  progressSection.classList.add('hidden');
  applyBtn.disabled = false;
  jobUrlInput.disabled = false;
  jobUrlInput.value = '';
}

// Application complete
async function onApplicationComplete(result) {
  isApplying = false;
  setMascotState('success');
  hideProgress();

  // Update usage locally
  peeboUser.apps_used_this_month++;
  await chrome.storage.local.set({ peeboUser });
  updateUsageMeter();

  showToast('Application submitted!', 'success');

  // Reset mascot after delay
  setTimeout(() => setMascotState('idle'), 3000);
}

// Application failed
function onApplicationFailed(error) {
  isApplying = false;
  setMascotState('error');
  hideProgress();
  showToast(error || 'Application failed', 'error');

  // Reset mascot after delay
  setTimeout(() => setMascotState('idle'), 3000);
}

// Handle cancel
function handleCancel() {
  if (window.currentPollInterval) {
    clearInterval(window.currentPollInterval);
  }

  chrome.runtime.sendMessage({ type: 'CANCEL_APPLICATION' });

  isApplying = false;
  hideProgress();
  setMascotState('idle');
  showToast('Application cancelled', 'error');
}

// Handle upgrade
async function handleUpgrade() {
  try {
    const session = await chrome.storage.local.get('session');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/peebo-checkout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        priceId: 'price_peebo_premium_monthly' // Replace with actual Stripe price ID
      })
    });

    const { url } = await response.json();

    if (url) {
      chrome.tabs.create({ url });
    }
  } catch (error) {
    console.error('Upgrade failed:', error);
    showToast('Failed to start upgrade', 'error');
  }
}

// Check current tab for job posting
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB_INFO' });

      if (response && response.isJobPage) {
        detectedJob.classList.remove('hidden');
        detectedJob.dataset.url = tab.url;
        detectedCompanyRole.textContent = `${response.company || 'Unknown'} - ${response.role || 'Unknown'}`;
      }
    }
  } catch (error) {
    // Content script not loaded on this page
    console.log('Job detection not available on this page');
  }
}

// Validate job URL
function isValidJobUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const validDomains = [
      'greenhouse.io',
      'lever.co',
      'ashbyhq.com',
      'workday.com',
      'myworkdayjobs.com',
      'icims.com',
      'jobvite.com',
      'smartrecruiters.com',
      'linkedin.com'
    ];

    return validDomains.some(domain => parsed.hostname.includes(domain));
  } catch {
    return false;
  }
}

// Set mascot state
function setMascotState(state) {
  const states = {
    idle: '../assets/mascot/peebo-idle.svg',
    working: '../assets/mascot/peebo-working.svg',
    success: '../assets/mascot/peebo-success.svg',
    error: '../assets/mascot/peebo-error.svg'
  };

  mascot.src = states[state] || states.idle;
  mascot.classList.toggle('working', state === 'working');

  if (state === 'success') {
    mascot.classList.add('success-animation');
    setTimeout(() => mascot.classList.remove('success-animation'), 300);
  }
}

// Show toast notification
function showToast(message, type = 'info') {
  toast.classList.remove('hidden', 'success', 'error');
  toast.classList.add(type);
  toastMessage.textContent = message;

  // Set icon
  if (type === 'success') {
    toastIcon.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="4 10 8 14 16 6"/>
      </svg>
    `;
  } else if (type === 'error') {
    toastIcon.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="10" cy="10" r="8"/>
        <path d="M10 6v5M10 14h.01"/>
      </svg>
    `;
  }

  // Auto-hide after 3 seconds
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
