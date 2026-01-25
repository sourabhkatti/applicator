// Peebo Background Service Worker
// Handles local application tracking
// No authentication required - works offline with local storage

// State
const activeTasks = new Map();

// Initialize
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Initialize empty applications array
    const result = await chrome.storage.local.get(['applications']);
    if (!result.applications) {
      await chrome.storage.local.set({ applications: [] });
    }
  }
});

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
      return await startApplication(message.jobUrl);

    case 'CHECK_PROGRESS':
      return await checkProgress(message.taskId);

    case 'CANCEL_APPLICATION':
      return await cancelApplication();

    case 'ADD_APPLICATION':
      return await addApplication(message.application);

    case 'UPDATE_APPLICATION':
      return await updateApplication(message.id, message.updates);

    case 'GET_APPLICATIONS':
      return await getApplications();

    case 'DELETE_APPLICATION':
      return await deleteApplication(message.id);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// Start a job application (simulated for now - adds to tracker)
async function startApplication(jobUrl) {
  const taskId = generateId();

  // Extract info from URL
  const company = extractCompanyFromUrl(jobUrl);

  // Track this task
  activeTasks.set(taskId, {
    jobUrl,
    company,
    startedAt: Date.now(),
    status: 'running',
    progress: 0
  });

  // Simulate application progress
  simulateProgress(taskId);

  return { success: true, taskId };
}

// Simulate progress (for demo purposes)
async function simulateProgress(taskId) {
  const task = activeTasks.get(taskId);
  if (!task) return;

  const stages = [20, 40, 60, 80, 100];
  let stageIndex = 0;

  const interval = setInterval(async () => {
    if (stageIndex >= stages.length) {
      clearInterval(interval);
      task.status = 'completed';
      task.progress = 100;

      // Add to applications
      await addApplicationFromTask(task);

      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/mascot/peebo-icon-128.png'),
        title: 'Application tracked!',
        message: `Added ${task.company} to your tracker`
      });
      return;
    }

    task.progress = stages[stageIndex];
    stageIndex++;
  }, 500);
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
  if (progress < 20) return 'Preparing...';
  if (progress < 40) return 'Processing job details...';
  if (progress < 60) return 'Adding to tracker...';
  if (progress < 80) return 'Saving application...';
  if (progress < 100) return 'Almost done...';
  return 'Complete!';
}

// Cancel current application
async function cancelApplication() {
  for (const [taskId, task] of activeTasks) {
    if (task.status === 'running') {
      task.status = 'cancelled';
      activeTasks.delete(taskId);
      return { success: true };
    }
  }

  return { success: false, error: 'No active application to cancel' };
}

// Add application from completed task
async function addApplicationFromTask(task) {
  const application = {
    company: task.company,
    role: 'Position', // Will be filled in by user
    job_url: task.jobUrl,
    status: 'applied',
    applied_at: new Date().toISOString()
  };

  await addApplication(application);
}

// Add application to local storage
async function addApplication(application) {
  const result = await chrome.storage.local.get(['applications']);
  const applications = result.applications || [];

  applications.unshift({
    ...application,
    id: application.id || generateId()
  });

  await chrome.storage.local.set({ applications });

  return { success: true };
}

// Get all applications
async function getApplications() {
  const result = await chrome.storage.local.get(['applications']);
  return { applications: result.applications || [] };
}

// Update application
async function updateApplication(id, updates) {
  const result = await chrome.storage.local.get(['applications']);
  const applications = result.applications || [];

  const index = applications.findIndex(app => app.id === id);
  if (index !== -1) {
    applications[index] = { ...applications[index], ...updates };
    await chrome.storage.local.set({ applications });
    return { success: true };
  }

  return { success: false, error: 'Application not found' };
}

// Delete application
async function deleteApplication(id) {
  const result = await chrome.storage.local.get(['applications']);
  const applications = result.applications || [];

  const filtered = applications.filter(app => app.id !== id);
  await chrome.storage.local.set({ applications: filtered });

  return { success: true };
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
