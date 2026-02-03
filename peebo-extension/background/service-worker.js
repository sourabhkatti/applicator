// Peebo Background Service Worker
// Handles application tracking with browser-use Cloud automation
// and AgentMail email sync for automatic status updates

// Configuration
const BROWSER_USE_API_KEY = 'bu_fkMsZKn_HzIRkjT5gcGCPxhvrDvySfHgA402fEfNavc';
const BROWSER_USE_API_URL = 'https://api.browser-use.com/api/v2';
const POLL_INTERVAL = 3000; // 3 seconds

// AgentMail Configuration
const AGENTMAIL_API_URL = 'https://api.agentmail.to/v0';
const AGENTMAIL_SYNC_INTERVAL = 60; // seconds
const AGENTMAIL_ALARM_NAME = 'agentmail-sync';

// Default AgentMail credentials (auto-configured for all users)
const AGENTMAIL_DEFAULT_INBOX = 'applicator@agentmail.to';
const AGENTMAIL_DEFAULT_API_KEY = 'am_c036eda64cf94089f047014b8403136c22f12b143c69a6a1228e9b60021ec318';

// State
const activeTasks = new Map();

// ============================================
// Native Messaging Configuration
// ============================================
const NATIVE_HOST_NAME = 'com.peebo.extension';

// Native messaging state
let nativePort = null;
let controlledTabId = null;
let debuggerAttached = false;
let debuggerTabId = null;
let pendingRequests = new Map();

// Track tabs for cleanup
let visualTabIds = new Set();
let appOpenedTabIds = new Set();
let primaryTabId = null;

// ============================================
// Native Messaging Connection
// ============================================

function connectNativeHost() {
  if (nativePort) {
    console.log('[Peebo] Native host already connected');
    return;
  }

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    console.log('[Peebo] Connected to native host');

    nativePort.onMessage.addListener(handleNativeMessage);

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.log('[Peebo] Native host disconnected:', error?.message || 'No error');
      nativePort = null;
      debuggerAttached = false;
      debuggerTabId = null;
    });

  } catch (e) {
    console.error('[Peebo] Failed to connect to native host:', e);
  }
}

function sendToNative(message) {
  if (!nativePort) {
    console.warn('[Peebo] Cannot send - native host not connected');
    return false;
  }
  try {
    nativePort.postMessage(message);
    return true;
  } catch (e) {
    console.error('[Peebo] Failed to send to native host:', e);
    return false;
  }
}

// Handle messages from native host (Python client)
function handleNativeMessage(message) {
  console.log('[Peebo] Received from native:', message.type || message.id);

  // Check if this is a response to a pending request
  if (message.id && pendingRequests.has(message.id)) {
    const resolver = pendingRequests.get(message.id);
    pendingRequests.delete(message.id);
    resolver(message);
    return;
  }

  // Otherwise, it's a command from Python client
  handleNativeCommand(message);
}

// ============================================
// CDP Debugger Management
// ============================================

async function attachDebugger(tabId) {
  if (debuggerAttached && debuggerTabId === tabId) return true;

  // Detach from previous tab if needed
  if (debuggerAttached && debuggerTabId) {
    try {
      await chrome.debugger.detach({ tabId: debuggerTabId });
    } catch (e) {
      // Tab may be closed
    }
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerAttached = true;
    debuggerTabId = tabId;

    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId === tabId) {
        debuggerAttached = false;
        debuggerTabId = null;
      }
    });

    console.log('[Peebo] Debugger attached to tab:', tabId);
    return true;
  } catch (e) {
    console.error('[Peebo] Debugger attach failed:', e);
    return false;
  }
}

async function detachDebugger() {
  if (!debuggerAttached || !debuggerTabId) return;

  try {
    await chrome.debugger.detach({ tabId: debuggerTabId });
  } catch (e) {
    // Tab may be closed
  }
  debuggerAttached = false;
  debuggerTabId = null;
}

async function ensureDebuggerAttached(tabId) {
  return await attachDebugger(tabId);
}

// ============================================
// Native Command Handler
// ============================================

async function handleNativeCommand(command) {
  const { id, type, params } = command;

  try {
    let result;
    switch (type) {
      case 'ping':
        sendToNative({ id, type: 'pong', success: true });
        return;

      case 'attach_active_tab':
        result = await handleAttachActiveTab(params);
        break;

      case 'navigate':
        result = await handleNavigateNative(params);
        break;

      case 'click':
        await ensureDebuggerAttached(controlledTabId);
        result = await handleClickNative(params);
        break;

      case 'type':
        result = await handleTypeNative(params);
        break;

      case 'hover':
        await ensureDebuggerAttached(controlledTabId);
        result = await handleHoverNative(params);
        break;

      case 'extract_dom':
        result = await handleExtractDOM(params);
        break;

      case 'execute_script':
        result = await handleExecuteScript(params);
        break;

      case 'scroll':
        result = await handleScrollNative(params);
        break;

      case 'send_keys':
        await ensureDebuggerAttached(controlledTabId);
        result = await handleSendKeysNative(params);
        break;

      case 'go_back':
        await chrome.tabs.goBack(controlledTabId);
        result = { success: true };
        break;

      case 'go_forward':
        await chrome.tabs.goForward(controlledTabId);
        result = { success: true };
        break;

      case 'refresh':
        await chrome.tabs.reload(controlledTabId);
        result = { success: true };
        break;

      case 'get_url':
        const tab = await chrome.tabs.get(controlledTabId);
        result = { success: true, url: tab.url };
        break;

      case 'detach_tab':
        await detachDebugger();
        result = { success: true };
        break;

      case 'cleanup_all':
        result = await handleCleanupAll(params);
        break;

      case 'upload_file':
        result = await handleUploadFile(params);
        break;

      default:
        console.warn('[Peebo] Unknown native command:', type);
        result = { success: false, error: `Unknown command: ${type}` };
    }

    if (id) {
      sendToNative({ id, ...result });
    }

  } catch (e) {
    console.error('[Peebo] Command error:', e);
    if (id) {
      sendToNative({ id, success: false, error: e.message });
    }
  }
}

// ============================================
// Command Implementations
// ============================================

async function handleAttachActiveTab(params) {
  try {
    let tabToUse = null;

    // Check if we already have a controlled tab
    if (controlledTabId) {
      try {
        tabToUse = await chrome.tabs.get(controlledTabId);
        await chrome.tabs.update(controlledTabId, { active: true });
        console.log('[Peebo] Reusing existing tab:', controlledTabId);
      } catch (e) {
        controlledTabId = null;
      }
    }

    // Create new tab if needed
    if (!tabToUse) {
      tabToUse = await chrome.tabs.create({ url: 'about:blank', active: true });
      controlledTabId = tabToUse.id;
      console.log('[Peebo] Created new tab:', tabToUse.id);
    }

    primaryTabId = tabToUse.id;
    return { success: true, tabId: tabToUse.id, url: tabToUse.url };

  } catch (e) {
    console.error('[Peebo] attach_active_tab failed:', e);
    return { success: false, error: e.message };
  }
}

async function handleNavigateNative(params) {
  let url = params?.url;

  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  // Add https:// if missing
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('chrome')) {
    url = 'https://' + url;
  }

  console.log('[Peebo] Navigating to:', url);

  if (controlledTabId) {
    try {
      await chrome.tabs.update(controlledTabId, { url });
    } catch (e) {
      controlledTabId = null;
    }
  }

  if (!controlledTabId) {
    const tab = await chrome.tabs.create({ url, active: true });
    controlledTabId = tab.id;
  }

  // Wait for navigation to complete
  await new Promise(resolve => setTimeout(resolve, 1000));

  return { success: true, tabId: controlledTabId };
}

async function handleClickNative(params) {
  const { x, y, selector, index } = params || {};

  // Coordinate-based click using CDP
  if (x !== undefined && y !== undefined) {
    // Mouse move first (triggers hover effects)
    await chrome.debugger.sendCommand({ tabId: controlledTabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y
    });
    await new Promise(r => setTimeout(r, 100));

    // Mouse press
    await chrome.debugger.sendCommand({ tabId: controlledTabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    });

    // Mouse release
    await chrome.debugger.sendCommand({ tabId: controlledTabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    });

    await new Promise(r => setTimeout(r, 200));
    return { success: true };
  }

  // Selector/index based click via content script
  if (selector || index !== undefined) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: controlledTabId },
        files: ['content/form-filler.js']
      });
    } catch (e) {
      // Already injected
    }

    const response = await chrome.tabs.sendMessage(controlledTabId, {
      type: 'click_element',
      params: { selector, index }
    });

    return response || { success: false, error: 'No response from content script' };
  }

  return { success: false, error: 'No click target provided' };
}

async function handleTypeNative(params) {
  const { text, selector, index, x, y } = params || {};

  if (!text) {
    return { success: false, error: 'No text provided' };
  }

  // Use content script for typing (better React/Vue compatibility)
  if (selector || index !== undefined || (x !== undefined && y !== undefined)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: controlledTabId },
        files: ['content/form-filler.js']
      });
    } catch (e) {
      // Already injected
    }

    const response = await chrome.tabs.sendMessage(controlledTabId, {
      type: 'type_text_js',
      params: { selector, index, x, y, text }
    });

    return response || { success: false, error: 'No response from content script' };
  }

  // Fallback: CDP typing (for typing into already focused element)
  await ensureDebuggerAttached(controlledTabId);

  for (const char of text) {
    await chrome.debugger.sendCommand({ tabId: controlledTabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', text: char
    });
    await chrome.debugger.sendCommand({ tabId: controlledTabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', text: char
    });
    // Small delay between characters (human-like)
    await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
  }

  return { success: true };
}

async function handleHoverNative(params) {
  const { x, y } = params || {};

  if (x !== undefined && y !== undefined) {
    await chrome.debugger.sendCommand({ tabId: controlledTabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y
    });
    await new Promise(r => setTimeout(r, 300));
    return { success: true };
  }

  return { success: false, error: 'No coordinates provided' };
}

async function handleExtractDOM(params) {
  const includeScreenshot = params?.includeScreenshot ?? true;

  try {
    // Inject content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: controlledTabId },
        files: ['content/form-filler.js']
      });
    } catch (e) {
      // Already injected
    }

    // Get DOM from content script
    const domResult = await chrome.tabs.sendMessage(controlledTabId, {
      type: 'extract_dom_content',
      params: { includeInteractiveOnly: true }
    });

    let screenshot = null;
    if (includeScreenshot) {
      try {
        // IMPORTANT: Activate the controlled tab first to ensure captureVisibleTab captures it
        // This fixes the bug where screenshots captured the wrong tab
        await chrome.tabs.update(controlledTabId, { active: true });
        await new Promise(r => setTimeout(r, 150)); // Wait for tab to become visible

        screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      } catch (e) {
        console.warn('[Peebo] Screenshot failed:', e);
      }
    }

    return {
      success: true,
      data: {
        dom: domResult?.data || domResult,
        screenshot,
        url: (await chrome.tabs.get(controlledTabId)).url
      }
    };

  } catch (e) {
    console.error('[Peebo] extract_dom failed:', e);
    return { success: false, error: e.message };
  }
}

async function handleExecuteScript(params) {
  const { script } = params;

  if (!controlledTabId) {
    return { success: false, error: 'No tab attached' };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: controlledTabId },
      func: async (code) => {
        try {
          // Await the result in case the code returns a Promise (e.g., async IIFE)
          const result = eval(code);
          return result instanceof Promise ? await result : result;
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [script],
      world: 'MAIN'  // Execute in page context for full access
    });

    return {
      success: true,
      result: results[0]?.result
    };
  } catch (e) {
    console.error('[Peebo] execute_script failed:', e);
    return { success: false, error: e.message };
  }
}

async function handleScrollNative(params) {
  const { direction, amount } = params || {};
  const scrollAmount = amount || 500;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: controlledTabId },
      files: ['content/form-filler.js']
    });
  } catch (e) {
    // Already injected
  }

  const response = await chrome.tabs.sendMessage(controlledTabId, {
    type: 'scroll',
    params: { direction: direction || 'down', amount: scrollAmount }
  });

  return response || { success: true };
}

async function handleSendKeysNative(params) {
  const { keys } = params || {};

  if (!keys) {
    return { success: false, error: 'No keys provided' };
  }

  const keyMap = {
    'enter': { key: 'Enter', code: 'Enter' },
    'escape': { key: 'Escape', code: 'Escape' },
    'tab': { key: 'Tab', code: 'Tab' },
    'backspace': { key: 'Backspace', code: 'Backspace' },
    'delete': { key: 'Delete', code: 'Delete' },
    'arrowup': { key: 'ArrowUp', code: 'ArrowUp' },
    'arrowdown': { key: 'ArrowDown', code: 'ArrowDown' },
    'arrowleft': { key: 'ArrowLeft', code: 'ArrowLeft' },
    'arrowright': { key: 'ArrowRight', code: 'ArrowRight' },
    'space': { key: ' ', code: 'Space' }
  };

  const keyLower = keys.toLowerCase();
  const keyInfo = keyMap[keyLower] || { key: keys, code: keys };

  await chrome.debugger.sendCommand({ tabId: controlledTabId }, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: keyInfo.key,
    code: keyInfo.code
  });

  await chrome.debugger.sendCommand({ tabId: controlledTabId }, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: keyInfo.key,
    code: keyInfo.code
  });

  return { success: true };
}

async function handleUploadFile(params) {
  const { selector, filePath } = params || {};

  if (!selector || !filePath) {
    return { success: false, error: 'Missing selector or filePath' };
  }

  // File uploads require special handling via CDP
  await ensureDebuggerAttached(controlledTabId);

  try {
    // Get the file input element's node ID
    const { root } = await chrome.debugger.sendCommand(
      { tabId: controlledTabId },
      'DOM.getDocument'
    );

    const { nodeId } = await chrome.debugger.sendCommand(
      { tabId: controlledTabId },
      'DOM.querySelector',
      { nodeId: root.nodeId, selector }
    );

    if (!nodeId) {
      return { success: false, error: 'File input element not found' };
    }

    // Set files on the input
    await chrome.debugger.sendCommand(
      { tabId: controlledTabId },
      'DOM.setFileInputFiles',
      { nodeId, files: [filePath] }
    );

    return { success: true };
  } catch (e) {
    console.error('[Peebo] File upload failed:', e);
    return { success: false, error: e.message };
  }
}

async function handleCleanupAll(params) {
  console.log('[Peebo] Starting cleanup...');
  const result = {
    debuggerDetached: false,
    tabsClosed: 0,
    errors: []
  };

  // Detach debugger
  if (debuggerAttached && debuggerTabId) {
    try {
      await chrome.debugger.detach({ tabId: debuggerTabId });
      result.debuggerDetached = true;
    } catch (e) {
      result.errors.push(`Debugger detach: ${e.message}`);
    }
    debuggerAttached = false;
    debuggerTabId = null;
  }

  // Close app-opened tabs (except primary)
  for (const tabId of appOpenedTabIds) {
    if (tabId === primaryTabId || tabId === controlledTabId) continue;
    try {
      await chrome.tabs.remove(tabId);
      result.tabsClosed++;
    } catch (e) {
      // Tab may already be closed
    }
  }
  appOpenedTabIds.clear();

  // Reset tab to about:blank
  if (controlledTabId) {
    try {
      await chrome.tabs.update(controlledTabId, { url: 'about:blank' });
    } catch (e) {
      result.errors.push(`Tab reset: ${e.message}`);
    }
  }

  console.log('[Peebo] Cleanup complete:', result);
  return { success: true, ...result };
}

// ============================================
// Auto-connect to native host on startup
// ============================================

// Try to connect when a message requests it
function ensureNativeConnection() {
  if (!nativePort) {
    connectNativeHost();
  }
  return !!nativePort;
}

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

    case 'GET_ACTIVE_TASKS':
      return { tasks: Object.fromEntries(activeTasks) };

    case 'SYNC_AGENTMAIL':
      return await pollAgentMail();

    case 'GET_SYNC_STATUS':
      return await getSyncStatus();

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
      task: `CRITICAL: You are applying to a job at this EXACT URL: ${jobUrl}

You MUST stay on this URL. Do NOT search for other jobs. Do NOT navigate away. If this URL is not a job application, FAIL immediately.

Fill out the application form with my information and submit it.

My Information:
- Name: ${applicantData.name || 'Not provided'}
- Email: ${applicantData.email || 'Not provided'}
- Phone: ${applicantData.phone || 'Not provided'}
- Location: ${applicantData.location || 'Not provided'}
- LinkedIn: ${applicantData.linkedinUrl || 'Not provided'}

Resume:
${applicantData.resumeText || 'Not provided - please fill in manually if required'}

Instructions:
1. You are ALREADY at the job application page: ${jobUrl}
2. Fill out all required fields with the information above
3. Upload resume if file upload is available (use resume text otherwise)
4. Submit the application
5. Confirm the application was submitted successfully

CRITICAL: Do NOT search DuckDuckGo. Do NOT navigate to other jobs. Stay on ${jobUrl} only.`,
      max_steps: 50,
      use_vision: true
    };

    // Call browser-use API
    const response = await fetch(`${BROWSER_USE_API_URL}/tasks`, {
      method: 'POST',
      headers: {
        'X-Browser-Use-API-Key': BROWSER_USE_API_KEY,
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
    const taskData = {
      jobUrl,
      company,
      startedAt: Date.now(),
      status: 'running',
      progress: 10,
      browserUseTaskId: result.id
    };
    activeTasks.set(taskId, taskData);

    // Broadcast task started
    broadcastToTrackers({ type: 'TASK_STARTED', taskId, task: taskData });

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
    const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${task.browserUseTaskId}`, {
      headers: {
        'X-Browser-Use-API-Key': BROWSER_USE_API_KEY
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

      // Broadcast completion
      broadcastToTrackers({ type: 'TASK_COMPLETED', taskId });

      // Remove from active tasks
      activeTasks.delete(taskId);

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

      // Broadcast failure
      broadcastToTrackers({ type: 'TASK_FAILED', taskId, error: task.error });

      // Remove from active tasks
      activeTasks.delete(taskId);

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
        await fetch(`${BROWSER_USE_API_URL}/tasks/${task.browserUseTaskId}/cancel`, {
          method: 'POST',
          headers: {
            'X-Browser-Use-API-Key': BROWSER_USE_API_KEY
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

// Broadcast message to all tracker tabs
async function broadcastToTrackers(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && tab.url.includes('localhost:8080')) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Ignore errors for closed tabs
        });
      }
    }
  } catch (error) {
    console.error('Failed to broadcast to trackers:', error);
  }
}

// ============================================
// AgentMail Sync Module
// Polls AgentMail for emails and updates application statuses
// ============================================

// Start AgentMail sync on extension startup
async function startAgentMailSync() {
  const config = await getAgentMailConfig();
  if (!config.agentmail_inbox_id) {
    console.log('AgentMail sync: No inbox configured, skipping');
    return;
  }

  console.log('AgentMail sync: Starting with inbox', config.agentmail_inbox_id);

  // Set up periodic alarm
  chrome.alarms.create(AGENTMAIL_ALARM_NAME, {
    periodInMinutes: AGENTMAIL_SYNC_INTERVAL / 60
  });

  // Do an initial poll
  await pollAgentMail();
}

// Get AgentMail configuration - uses defaults if not configured by user
async function getAgentMailConfig() {
  const result = await chrome.storage.local.get(['peeboUser']);
  const user = result.peeboUser || {};

  // Use user config if provided, otherwise fall back to defaults
  return {
    agentmail_inbox_id: user.agentmail_inbox_id || AGENTMAIL_DEFAULT_INBOX,
    agentmail_api_key: user.agentmail_api_key || AGENTMAIL_DEFAULT_API_KEY
  };
}

// Poll AgentMail for new messages
async function pollAgentMail() {
  try {
    const config = await getAgentMailConfig();
    if (!config.agentmail_inbox_id || !config.agentmail_api_key) {
      return { success: false, error: 'AgentMail not configured' };
    }

    // Load sync state
    const stateResult = await chrome.storage.local.get(['agentmailSyncState']);
    const syncState = stateResult.agentmailSyncState || {
      last_sync_at: null,
      processed_message_ids: []
    };

    console.log('AgentMail sync: Polling for new messages...');

    // Fetch messages from AgentMail
    const response = await fetch(
      `${AGENTMAIL_API_URL}/inboxes/${config.agentmail_inbox_id}/threads`,
      {
        headers: {
          'Authorization': `Bearer ${config.agentmail_api_key}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('AgentMail API error:', error);
      return { success: false, error };
    }

    const data = await response.json();
    const threads = data.threads || data.data || [];

    let updatedCount = 0;

    for (const thread of threads) {
      // API returns thread_id, not id
      const threadId = thread.thread_id || thread.id;
      // Also get inbox_id for constructing console URL (it's a UUID, not the email)
      const inboxId = thread.inbox_id;

      // Skip already processed threads
      if (syncState.processed_message_ids.includes(threadId)) {
        continue;
      }

      // Get email content - API uses different field names
      const subject = thread.subject || '';
      const preview = thread.preview || thread.snippet || '';
      // API returns senders as array, not from
      const senders = thread.senders || [];
      const fromAddress = senders[0] || thread.from || '';

      console.log(`AgentMail sync: Processing thread from "${fromAddress}" - "${subject}"`);
      console.log(`AgentMail sync: Thread ID: ${threadId}, Inbox ID: ${inboxId}`);

      // Classify the email
      const classification = classifyEmail(subject, preview);
      console.log(`AgentMail sync: Classified as ${classification.type} (${classification.confidence})`);

      if (classification.type !== 'unknown') {
        // Extract company from sender
        const company = extractCompanyFromSender(fromAddress);
        console.log(`AgentMail sync: Extracted company: "${company}"`);

        // Try to match to an existing application (pass threadId and inboxId for email link)
        const matched = await matchAndUpdateApplication(company, classification, subject, preview, threadId, inboxId);

        if (matched) {
          updatedCount++;
        }
      }

      // Mark as processed
      syncState.processed_message_ids.push(threadId);
    }

    // Trim processed IDs to last 500 to prevent bloat
    if (syncState.processed_message_ids.length > 500) {
      syncState.processed_message_ids = syncState.processed_message_ids.slice(-500);
    }

    // Update sync state
    syncState.last_sync_at = new Date().toISOString();
    await chrome.storage.local.set({ agentmailSyncState: syncState });

    if (updatedCount > 0) {
      console.log(`AgentMail sync: Updated ${updatedCount} application(s)`);
      // Broadcast to refresh tracker UI
      broadcastToTrackers({ type: 'APPLICATIONS_UPDATED' });
    }

    return { success: true, updatedCount };

  } catch (error) {
    console.error('AgentMail sync error:', error);
    return { success: false, error: error.message };
  }
}

// Get sync status for UI display
async function getSyncStatus() {
  const stateResult = await chrome.storage.local.get(['agentmailSyncState']);
  const syncState = stateResult.agentmailSyncState || {
    last_sync_at: null,
    processed_message_ids: []
  };

  const config = await getAgentMailConfig();
  // Always configured since we have defaults
  const isConfigured = !!(config.agentmail_inbox_id && config.agentmail_api_key);

  return {
    isConfigured,
    lastSyncAt: syncState.last_sync_at,
    processedCount: syncState.processed_message_ids.length
  };
}

// Extract company name from email sender address
// e.g., "Sierra Recruiting <noreply@ashbyhq.com>" → "Sierra"
// e.g., "HackerOne Hiring Team <noreply@ashbyhq.com>" → "HackerOne"
// e.g., "Plaid <no-reply@hire.lever.co>" → "Plaid"
function extractCompanyFromSender(fromAddress) {
  if (!fromAddress) return null;

  // Try to extract display name before email angle brackets
  const displayNameMatch = fromAddress.match(/^(.+?)\s*<[^>]+>$/);
  if (displayNameMatch) {
    let displayName = displayNameMatch[1].trim();
    // Remove quotes if present
    displayName = displayName.replace(/^["']|["']$/g, '').trim();
    // Remove common suffixes like "Hiring Team", "Careers", "Jobs", "Recruiting"
    displayName = displayName
      .replace(/\s*(Hiring|Careers|Jobs|Recruiting|Talent|HR)\s*(Team)?$/i, '')
      .trim();
    if (displayName && displayName.length > 1) {
      console.log(`extractCompanyFromSender: "${fromAddress}" → "${displayName}" (from display name)`);
      return displayName;
    }
  }

  // Fallback: extract domain from email (only if not an ATS domain)
  const emailMatch = fromAddress.match(/<([^>]+)>/) || fromAddress.match(/([^\s@]+@[^\s@]+)/);
  if (emailMatch) {
    const email = emailMatch[1];
    const domain = email.split('@')[1];
    if (domain) {
      // ATS domains don't tell us the company name
      const atsDomains = ['ashbyhq.com', 'greenhouse.io', 'lever.co', 'workday.com',
                         'hire.lever.co', 'myworkdayjobs.com', 'icims.com', 'jobvite.com'];
      if (atsDomains.some(ats => domain.includes(ats))) {
        console.log(`extractCompanyFromSender: "${fromAddress}" → null (ATS domain)`);
        return null;
      }
      // Extract company from domain (e.g., acme.com → Acme)
      const company = domain.split('.')[0];
      const result = formatCompanyName(company);
      console.log(`extractCompanyFromSender: "${fromAddress}" → "${result}" (from domain)`);
      return result;
    }
  }

  console.log(`extractCompanyFromSender: "${fromAddress}" → null (no match)`);
  return null;
}

// Classify email based on subject and preview content
// Returns: { type: 'confirmation'|'rejection'|'interview'|'unknown', confidence: 'high'|'medium'|'low' }
function classifyEmail(subject, preview) {
  const content = `${subject} ${preview}`.toLowerCase();

  // Rejection patterns (more flexible matching)
  const rejectionPatterns = [
    'decided not to move forward',
    'decided to move forward with',  // Usually means other candidates
    'move forward with other',
    'we have filled this position',
    'position has been filled',
    'filled this position',
    'no longer available',
    'no longer considering',
    'not a match',
    'pursuing other candidates',
    'will not be moving forward',
    'not be moving forward',
    'unable to offer you',
    'unfortunately',
    'regret to inform',
    'not selected',
    'chosen not to proceed',
    'decided not to proceed',
    'will not be proceeding'
  ];

  // Interview patterns
  const interviewPatterns = [
    'schedule an interview',
    'like to speak with you',
    'next steps',
    'invite you to',
    'scheduling link',
    'book a time',
    'phone screen',
    'interview request',
    'would love to chat',
    'excited to meet',
    'discuss the role'
  ];

  // Confirmation patterns
  const confirmationPatterns = [
    'thank you for applying',
    'thanks for applying',
    'received your application',
    'we\'ve received your application',
    'application received',
    'thank you for your application',
    'application has been received',
    'appreciate your interest',
    'application was submitted'
  ];

  // Check rejection first (highest priority - don't want to miss these)
  for (const pattern of rejectionPatterns) {
    if (content.includes(pattern)) {
      return { type: 'rejection', confidence: 'high' };
    }
  }

  // Check interview patterns
  for (const pattern of interviewPatterns) {
    if (content.includes(pattern)) {
      return { type: 'interview', confidence: 'high' };
    }
  }

  // Check confirmation patterns
  for (const pattern of confirmationPatterns) {
    if (content.includes(pattern)) {
      return { type: 'confirmation', confidence: 'high' };
    }
  }

  return { type: 'unknown', confidence: 'low' };
}

// Extract a concise rejection reason from email content
function extractRejectionReason(preview) {
  if (!preview) return 'Application not selected';

  const lowerPreview = preview.toLowerCase();

  // Common rejection reasons with friendly summaries
  if (lowerPreview.includes('decided to move forward with') ||
      lowerPreview.includes('move forward with other')) {
    return 'Selected other candidates';
  }
  if (lowerPreview.includes('position has been filled') ||
      lowerPreview.includes('filled this position') ||
      lowerPreview.includes('we have filled')) {
    return 'Position filled';
  }
  if (lowerPreview.includes('no longer available') ||
      lowerPreview.includes('no longer considering')) {
    return 'Position no longer available';
  }
  if (lowerPreview.includes('not a match') ||
      lowerPreview.includes('not the right fit')) {
    return 'Not a match for this role';
  }
  if (lowerPreview.includes('pursuing other candidates')) {
    return 'Pursuing other candidates';
  }
  if (lowerPreview.includes('decided not to proceed') ||
      lowerPreview.includes('will not be proceeding')) {
    return 'Not moving forward';
  }

  return 'Application not selected';
}

// Match email to application and update status
// threadId and inboxId are stored to create a direct link to the email that caused the status change
async function matchAndUpdateApplication(company, classification, emailSubject = '', emailPreview = '', threadId = null, inboxId = null) {
  if (!company) {
    console.log('AgentMail sync: Cannot match - no company extracted');
    return false;
  }

  const result = await chrome.storage.local.get(['applications']);
  const applications = result.applications || [];

  // Normalize company name for matching
  const normalizedCompany = company.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Find matching application - check company name
  let matchIndex = applications.findIndex(app => {
    const appCompany = (app.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return appCompany.includes(normalizedCompany) || normalizedCompany.includes(appCompany);
  });

  // If no match by company name, log all companies for debugging
  if (matchIndex === -1) {
    const allCompanies = applications.map(a => a.company).join(', ');
    console.log(`AgentMail sync: No match for "${company}" (normalized: "${normalizedCompany}")`);
    console.log(`AgentMail sync: Available companies: ${allCompanies}`);
    return false;
  }

  const app = applications[matchIndex];
  const timestamp = new Date().toISOString().split('T')[0];
  let updated = false;
  let notificationTitle = '';
  let notificationMessage = '';

  switch (classification.type) {
    case 'confirmation':
      if (!app.email_verified) {
        app.email_verified = true;
        app.notes = (app.notes || '') + `\n✅ [${timestamp}] Email confirmation received`;
        app.updated_at = new Date().toISOString();
        if (threadId) app.confirmation_email_thread_id = threadId;
        if (inboxId) app.email_inbox_id = inboxId;
        notificationTitle = 'Application Confirmed';
        notificationMessage = `✅ ${app.company} confirmed your application`;
        updated = true;
      } else if (threadId && !app.confirmation_email_thread_id) {
        // Backfill thread ID if missing (for reprocessing)
        app.confirmation_email_thread_id = threadId;
        if (inboxId) app.email_inbox_id = inboxId;
        updated = true;
        console.log(`AgentMail sync: Backfilled confirmation thread ID for ${app.company}`);
      }
      break;

    case 'rejection':
      if (app.status !== 'rejected') {
        app.status = 'rejected';
        // Include the email preview as the rejection reason
        const reason = extractRejectionReason(emailPreview);
        app.rejection_reason = reason;
        app.notes = (app.notes || '') + `\n❌ [${timestamp}] Rejection: ${reason}`;
        app.updated_at = new Date().toISOString();
        // Store thread ID and inbox ID for direct email link
        if (threadId) app.status_email_thread_id = threadId;
        if (inboxId) app.email_inbox_id = inboxId;
        notificationTitle = 'Application Update';
        notificationMessage = `📧 ${app.company} - Application not moving forward`;
        updated = true;
        console.log(`AgentMail sync: Moving ${app.company} to rejected - "${reason}"`);
      } else if (threadId && !app.status_email_thread_id) {
        // Backfill thread ID if missing (for reprocessing)
        app.status_email_thread_id = threadId;
        if (inboxId) app.email_inbox_id = inboxId;
        // Also backfill rejection reason if missing
        if (!app.rejection_reason) {
          app.rejection_reason = extractRejectionReason(emailPreview);
        }
        updated = true;
        console.log(`AgentMail sync: Backfilled rejection thread ID for ${app.company}`);
      }
      break;

    case 'interview':
      if (app.status !== 'interviewing') {
        app.status = 'interviewing';
        app.interview_stage = 'recruiter_screen';
        // Add placeholder interview
        app.interviews = app.interviews || [];
        app.interviews.push({
          date: null, // TBD
          type: 'Interview',
          notes: `Detected from email on ${timestamp}`
        });
        app.notes = (app.notes || '') + `\n🎉 [${timestamp}] Interview request received!`;
        app.updated_at = new Date().toISOString();
        // Store thread ID and inbox ID for direct email link
        if (threadId) app.status_email_thread_id = threadId;
        if (inboxId) app.email_inbox_id = inboxId;
        notificationTitle = 'Interview Request!';
        notificationMessage = `🎉 ${app.company} wants to schedule an interview!`;
        updated = true;
        console.log(`AgentMail sync: Moving ${app.company} to interviewing`);
      } else if (threadId && !app.status_email_thread_id) {
        // Backfill thread ID if missing (for reprocessing)
        app.status_email_thread_id = threadId;
        if (inboxId) app.email_inbox_id = inboxId;
        updated = true;
        console.log(`AgentMail sync: Backfilled interview thread ID for ${app.company}`);
      }
      break;
  }

  if (updated) {
    applications[matchIndex] = app;
    await chrome.storage.local.set({ applications });

    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/mascot/peebo-icon-128.png'),
      title: notificationTitle,
      message: notificationMessage
    });

    console.log(`AgentMail sync: Successfully updated ${app.company} → ${classification.type}`);
  }

  return updated;
}

// Handle alarm events
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AGENTMAIL_ALARM_NAME) {
    await pollAgentMail();
  }
});

// Initialize AgentMail sync when extension starts
chrome.runtime.onStartup.addListener(() => {
  startAgentMailSync();
  connectNativeHost();
});

// Also start on install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    startAgentMailSync();
    connectNativeHost();
  }
});

// Connect native host immediately when service worker loads
connectNativeHost();
