// Peebo Popup Logic - No Auth Required

// State
let isApplying = false;

// DOM Elements
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
const mascot = document.getElementById('mascot');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastIcon = document.getElementById('toast-icon');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkCurrentTab();
});

// Setup event listeners
function setupEventListeners() {
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

  // Navigation - open extension's tracker page (has access to chrome.storage)
  trackerBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('tracker/index.html') });
  });

  historyBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('tracker/index.html?view=history') });
  });

  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  });
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

  isApplying = true;
  setMascotState('working');
  showProgress();

  try {
    // Send application request to service worker
    const response = await chrome.runtime.sendMessage({
      type: 'START_APPLICATION',
      jobUrl: jobUrl
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
function onApplicationComplete(result) {
  isApplying = false;
  setMascotState('success');
  hideProgress();
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
