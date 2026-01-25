// Peebo Background Service Worker
// Handles application tracking with browser-use Cloud automation

// Configuration
const BROWSER_USE_API_KEY = 'bu_fkMsZKn_HzIRkjT5gcGCPxhvrDvySfHgA402fEfNavc';
const BROWSER_USE_API_URL = 'https://api.browser-use.com/v1';
const POLL_INTERVAL = 3000; // 3 seconds

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

// Start a job application via browser-use Cloud
async function startApplication(jobUrl) {
  try {
    const company = extractCompanyFromUrl(jobUrl);

    // Get applicant info from storage
    const applicantData = await getApplicantInfo();

    // Create browser-use task
    const taskPayload = {
      url: jobUrl,
      task: `Apply to this job posting. Fill out the application form with my information and submit it.

My Information:
- Name: ${applicantData.name || 'Not provided'}
- Email: ${applicantData.email || 'Not provided'}
- Phone: ${applicantData.phone || 'Not provided'}
- Location: ${applicantData.location || 'Not provided'}
- LinkedIn: ${applicantData.linkedinUrl || 'Not provided'}

Resume:
${applicantData.resumeText || 'Not provided - please fill in manually if required'}

Instructions:
1. Navigate to the job application page
2. Fill out all required fields with the information above
3. Upload resume if file upload is available (use resume text otherwise)
4. Submit the application
5. Confirm the application was submitted successfully`,
      max_steps: 50,
      use_vision: true
    };

    // Call browser-use API
    const response = await fetch(`${BROWSER_USE_API_URL}/agent/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BROWSER_USE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(taskPayload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`browser-use API error: ${error}`);
    }

    const result = await response.json();
    const taskId = result.id || result.task_id || generateId();

    // Track this task
    activeTasks.set(taskId, {
      jobUrl,
      company,
      startedAt: Date.now(),
      status: 'running',
      progress: 10,
      browserUseTaskId: result.id
    });

    // Start polling for progress
    pollBrowserUseTask(taskId);

    return { success: true, taskId };

  } catch (error) {
    console.error('Failed to start application:', error);
    return { success: false, error: error.message };
  }
}

// Poll browser-use task for progress
async function pollBrowserUseTask(taskId) {
  const task = activeTasks.get(taskId);
  if (!task || task.status !== 'running') return;

  try {
    // Check task status from browser-use API
    const response = await fetch(`${BROWSER_USE_API_URL}/agent/status/${task.browserUseTaskId}`, {
      headers: {
        'Authorization': `Bearer ${BROWSER_USE_API_KEY}`
      }
    });

    if (!response.ok) {
      console.error('Failed to get task status');
      setTimeout(() => pollBrowserUseTask(taskId), POLL_INTERVAL);
      return;
    }

    const status = await response.json();

    // Update progress based on status
    if (status.state === 'completed' || status.state === 'success') {
      task.status = 'completed';
      task.progress = 100;

      // Add to applications
      await addApplicationFromTask(task, status);

      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/mascot/peebo-icon-128.png'),
        title: 'Application submitted!',
        message: `Successfully applied to ${task.company}`
      });

    } else if (status.state === 'failed' || status.state === 'error') {
      task.status = 'failed';
      task.error = status.error || 'Application failed';
      task.progress = 0;

      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/mascot/peebo-icon-128.png'),
        title: 'Application failed',
        message: `Failed to apply to ${task.company}`
      });

    } else {
      // Still running - update progress estimate
      task.progress = Math.min(90, task.progress + 5);

      // Continue polling
      setTimeout(() => pollBrowserUseTask(taskId), POLL_INTERVAL);
    }

  } catch (error) {
    console.error('Progress poll error:', error);
    // Continue polling despite errors
    setTimeout(() => pollBrowserUseTask(taskId), POLL_INTERVAL);
  }
}

// Get applicant info from storage or return defaults
async function getApplicantInfo() {
  const result = await chrome.storage.local.get(['peeboUser']);
  const user = result.peeboUser;

  if (!user) {
    return {
      name: 'Your Name',
      email: 'your.email@example.com',
      phone: '(555) 123-4567',
      location: 'San Francisco, CA',
      linkedinUrl: '',
      resumeText: ''
    };
  }

  return {
    name: user.full_name || 'Your Name',
    email: user.email || 'your.email@example.com',
    phone: user.phone || '(555) 123-4567',
    location: user.location || 'San Francisco, CA',
    linkedinUrl: user.linkedin_url || '',
    resumeText: user.resume_text || ''
  };
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
  if (progress < 20) return 'Preparing application...';
  if (progress < 40) return 'Navigating to job page...';
  if (progress < 60) return 'Filling out application...';
  if (progress < 80) return 'Uploading resume...';
  if (progress < 95) return 'Submitting application...';
  return 'Almost done...';
}

// Cancel current application
async function cancelApplication() {
  for (const [taskId, task] of activeTasks) {
    if (task.status === 'running') {
      task.status = 'cancelled';

      // Try to cancel on browser-use side (best effort)
      try {
        await fetch(`${BROWSER_USE_API_URL}/agent/cancel/${task.browserUseTaskId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${BROWSER_USE_API_KEY}`
          }
        });
      } catch (e) {
        console.error('Failed to cancel browser-use task:', e);
      }

      activeTasks.delete(taskId);
      return { success: true };
    }
  }

  return { success: false, error: 'No active application to cancel' };
}

// Add application from completed task
async function addApplicationFromTask(task, result) {
  const application = {
    company: task.company,
    role: 'Position', // Extract from result if available
    job_url: task.jobUrl,
    status: 'applied',
    applied_at: new Date().toISOString(),
    metadata: {
      browser_use_task_id: task.browserUseTaskId,
      auto_applied: true
    }
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
