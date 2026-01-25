// Peebo Background Service Worker
// Handles API calls, state management, and browser-use Cloud integration

// Configuration
const SUPABASE_URL = 'https://diplqphbqlomcvlujcxd.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // Replace with actual key
const BROWSER_USE_POLL_INTERVAL = 2000; // 2 seconds

// State
const activeTasks = new Map();
let currentSession = null;

// Initialize
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Open onboarding on first install
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }

  // Check for existing session
  await loadSession();
});

// Load session from storage
async function loadSession() {
  const result = await chrome.storage.local.get(['session']);
  currentSession = result.session || null;
  return currentSession;
}

// Save session to storage
async function saveSession(session) {
  currentSession = session;
  await chrome.storage.local.set({ session });
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }));

  return true; // Keep the message channel open for async response
});

// Handle messages from popup and content scripts
async function handleMessage(message, sender) {
  switch (message.type) {
    case 'START_APPLICATION':
      return await startApplication(message.jobUrl, message.userId);

    case 'CHECK_PROGRESS':
      return await checkProgress(message.taskId);

    case 'CANCEL_APPLICATION':
      return await cancelApplication();

    case 'GET_SESSION':
      return { session: currentSession };

    case 'SET_SESSION':
      await saveSession(message.session);
      return { success: true };

    case 'SIGN_OUT':
      await chrome.storage.local.remove(['session', 'peeboUser']);
      currentSession = null;
      return { success: true };

    case 'SYNC_APPLICATIONS':
      return await syncApplications(message.applications);

    case 'PULL_APPLICATIONS':
      return await pullApplications();

    case 'ADD_APPLICATION':
      return await addApplication(message.application);

    case 'UPDATE_APPLICATION':
      return await updateApplication(message.id, message.updates);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// Start a job application
async function startApplication(jobUrl, userId) {
  if (!currentSession?.access_token) {
    throw new Error('Not authenticated');
  }

  // Get user profile for resume text
  const peeboUser = await getPeeboUser();
  if (!peeboUser) {
    throw new Error('User profile not found');
  }

  // Call the proxy edge function
  const response = await fetch(`${SUPABASE_URL}/functions/v1/peebo-proxy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${currentSession.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      task: 'apply',
      jobUrl: jobUrl,
      resumeText: peeboUser.resume_text,
      userInfo: {
        fullName: peeboUser.full_name,
        email: peeboUser.email,
        phone: peeboUser.phone,
        location: peeboUser.location,
        linkedinUrl: peeboUser.linkedin_url
      }
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Failed to start application');
  }

  // Track this task
  activeTasks.set(result.taskId, {
    jobUrl,
    userId,
    startedAt: Date.now(),
    status: 'running',
    progress: 0
  });

  // Start polling for progress
  pollTaskProgress(result.taskId);

  return { success: true, taskId: result.taskId };
}

// Poll for task progress
async function pollTaskProgress(taskId) {
  const task = activeTasks.get(taskId);
  if (!task || task.status !== 'running') return;

  try {
    // Call browser-use API to check task status
    const response = await fetch(`${SUPABASE_URL}/functions/v1/peebo-proxy/status/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${currentSession.access_token}`
      }
    });

    const result = await response.json();

    if (result.status === 'completed') {
      task.status = 'completed';
      task.progress = 100;

      // Add to local applications
      await addApplicationFromTask(task, result);

      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/mascot/peebo-success.svg'),
        title: 'Application submitted!',
        message: `Successfully applied to ${extractCompanyFromUrl(task.jobUrl)}`
      });
    } else if (result.status === 'failed') {
      task.status = 'failed';
      task.error = result.error;

      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/mascot/peebo-error.svg'),
        title: 'Application failed',
        message: result.error || 'Something went wrong'
      });
    } else {
      // Update progress estimate
      task.progress = estimateProgress(task.startedAt);

      // Continue polling
      setTimeout(() => pollTaskProgress(taskId), BROWSER_USE_POLL_INTERVAL);
    }
  } catch (error) {
    console.error('Progress poll error:', error);
    // Continue polling despite errors
    setTimeout(() => pollTaskProgress(taskId), BROWSER_USE_POLL_INTERVAL);
  }
}

// Estimate progress based on time elapsed
function estimateProgress(startedAt) {
  const elapsed = Date.now() - startedAt;
  const expectedDuration = 60000; // 60 seconds expected

  // Logarithmic curve that approaches but never reaches 100
  const progress = Math.min(95, Math.floor((1 - Math.exp(-elapsed / expectedDuration)) * 100));
  return progress;
}

// Check progress for a specific task
async function checkProgress(taskId) {
  const task = activeTasks.get(taskId);

  if (!task) {
    return { status: 'not_found' };
  }

  return {
    status: task.status,
    progress: task.progress,
    message: getProgressMessage(task.progress),
    error: task.error
  };
}

// Get progress message based on percentage
function getProgressMessage(progress) {
  if (progress < 20) return 'Optimizing resume for this role...';
  if (progress < 40) return 'Navigating to application page...';
  if (progress < 60) return 'Filling in your details...';
  if (progress < 80) return 'Uploading resume...';
  if (progress < 95) return 'Submitting application...';
  return 'Almost done...';
}

// Cancel current application
async function cancelApplication() {
  // Find running task
  for (const [taskId, task] of activeTasks) {
    if (task.status === 'running') {
      task.status = 'cancelled';
      activeTasks.delete(taskId);
      return { success: true };
    }
  }

  return { success: false, error: 'No active application to cancel' };
}

// Get Peebo user from storage or API
async function getPeeboUser() {
  const result = await chrome.storage.local.get(['peeboUser']);

  if (result.peeboUser) {
    return result.peeboUser;
  }

  // Fetch from API
  if (!currentSession?.access_token) return null;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/peebo_users?auth_user_id=eq.${currentSession.user.id}`,
    {
      headers: {
        'Authorization': `Bearer ${currentSession.access_token}`,
        'apikey': SUPABASE_ANON_KEY
      }
    }
  );

  const users = await response.json();
  if (users.length > 0) {
    await chrome.storage.local.set({ peeboUser: users[0] });
    return users[0];
  }

  return null;
}

// Add application from completed task
async function addApplicationFromTask(task, result) {
  const application = {
    company: extractCompanyFromUrl(task.jobUrl),
    role: result.role || 'Unknown Role',
    job_url: task.jobUrl,
    status: 'applied',
    applied_at: new Date().toISOString(),
    metadata: {
      browser_use_task_id: result.taskId,
      auto_applied: true
    }
  };

  await addApplication(application);
}

// Add application to local storage and sync
async function addApplication(application) {
  const result = await chrome.storage.local.get(['applications']);
  const applications = result.applications || [];

  applications.unshift({
    ...application,
    id: generateId(),
    synced: false
  });

  await chrome.storage.local.set({ applications });

  // Try to sync to Supabase
  try {
    await syncApplications([application]);
  } catch (error) {
    console.error('Failed to sync application:', error);
  }

  return { success: true };
}

// Update application
async function updateApplication(id, updates) {
  const result = await chrome.storage.local.get(['applications']);
  const applications = result.applications || [];

  const index = applications.findIndex(app => app.id === id);
  if (index !== -1) {
    applications[index] = { ...applications[index], ...updates, synced: false };
    await chrome.storage.local.set({ applications });

    // Try to sync
    try {
      await syncApplications([applications[index]]);
    } catch (error) {
      console.error('Failed to sync update:', error);
    }

    return { success: true };
  }

  return { success: false, error: 'Application not found' };
}

// Sync applications to Supabase
async function syncApplications(applications) {
  if (!currentSession?.access_token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/peebo-sync-apps`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${currentSession.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      applications,
      action: 'sync'
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Sync failed');
  }

  // Mark synced applications
  const stored = await chrome.storage.local.get(['applications']);
  const localApps = stored.applications || [];

  for (const app of localApps) {
    if (applications.some(a => a.job_url === app.job_url)) {
      app.synced = true;
    }
  }

  await chrome.storage.local.set({ applications: localApps });

  return result;
}

// Pull applications from Supabase
async function pullApplications() {
  if (!currentSession?.access_token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/peebo-sync-apps`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${currentSession.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'pull' })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Pull failed');
  }

  // Merge with local applications
  const stored = await chrome.storage.local.get(['applications']);
  const localApps = stored.applications || [];

  const merged = mergeApplications(localApps, result.applications);
  await chrome.storage.local.set({ applications: merged });

  return { applications: merged };
}

// Merge local and remote applications
function mergeApplications(local, remote) {
  const urlMap = new Map();

  // Add remote applications first (they're the source of truth)
  for (const app of remote) {
    urlMap.set(app.job_url, { ...app, synced: true });
  }

  // Add local applications that don't exist remotely
  for (const app of local) {
    if (!urlMap.has(app.job_url)) {
      urlMap.set(app.job_url, { ...app, synced: false });
    }
  }

  return Array.from(urlMap.values()).sort((a, b) =>
    new Date(b.applied_at) - new Date(a.applied_at)
  );
}

// Extract company name from job URL
function extractCompanyFromUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Common ATS patterns
    if (hostname.includes('greenhouse.io')) {
      const match = parsed.pathname.match(/\/(\w+)\//);
      return match ? formatCompanyName(match[1]) : 'Unknown';
    }
    if (hostname.includes('lever.co')) {
      const match = parsed.pathname.match(/\/(\w+)\//);
      return match ? formatCompanyName(match[1]) : 'Unknown';
    }
    if (hostname.includes('ashbyhq.com')) {
      const match = parsed.pathname.match(/\/(\w+)\//);
      return match ? formatCompanyName(match[1]) : 'Unknown';
    }
    if (hostname.includes('myworkdayjobs.com')) {
      const match = hostname.match(/(\w+)\.myworkdayjobs\.com/);
      return match ? formatCompanyName(match[1]) : 'Unknown';
    }

    // Fallback: use subdomain or first path segment
    const parts = hostname.split('.');
    if (parts.length > 2) {
      return formatCompanyName(parts[0]);
    }

    return formatCompanyName(parts[0]);
  } catch {
    return 'Unknown';
  }
}

// Format company name
function formatCompanyName(name) {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Generate unique ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Listen for extension icon click when popup is disabled
chrome.action.onClicked.addListener(async (tab) => {
  // This only fires if default_popup is not set
  // Currently we have popup set, so this won't fire
});

// Handle alarm for periodic sync
chrome.alarms.create('syncApplications', { periodInMinutes: 15 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'syncApplications') {
    try {
      await loadSession();
      if (currentSession?.access_token) {
        const stored = await chrome.storage.local.get(['applications']);
        const unsynced = (stored.applications || []).filter(app => !app.synced);
        if (unsynced.length > 0) {
          await syncApplications(unsynced);
        }
      }
    } catch (error) {
      console.error('Periodic sync failed:', error);
    }
  }
});
