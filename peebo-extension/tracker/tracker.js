// Peebo Tracker Logic

// Browser-use Cloud API configuration
const BROWSER_USE_API_KEY = 'bu_fkMsZKn_HzIRkjT5gcGCPxhvrDvySfHgA402fEfNavc';
const BROWSER_USE_API_URL = 'https://api.browser-use.com/api/v2';

// State
let applications = [];
let filteredApps = [];
let editingApp = null;
let deleteTargetId = null;
let draggedCard = null;
let activeTasks = new Map(); // Track active browser-use tasks
let pollInterval = null;

// DOM Elements
const searchInput = document.getElementById('search-input');
const addBtn = document.getElementById('add-btn');
const emptyAddBtn = document.getElementById('empty-add-btn');
const settingsBtn = document.getElementById('settings-btn');
const modalOverlay = document.getElementById('modal-overlay');
const applicationModal = document.getElementById('application-modal');
const modalTitle = document.getElementById('modal-title');
const applicationForm = document.getElementById('application-form');
const modalClose = document.getElementById('modal-close');
const modalCancel = document.getElementById('modal-cancel');
const deleteModalOverlay = document.getElementById('delete-modal-overlay');
const deleteConfirm = document.getElementById('delete-confirm');
const deleteCancel = document.getElementById('delete-cancel');
const emptyState = document.getElementById('empty-state');
const kanbanBoard = document.getElementById('kanban-board');

// Active applications elements
const activeApplications = document.getElementById('active-applications');
const activeJobs = document.getElementById('active-jobs');
const activeCount = document.getElementById('active-count');
const refreshActive = document.getElementById('refresh-active');

// Stats elements
const statTotal = document.getElementById('stat-total');
const statApplied = document.getElementById('stat-applied');
const statInterviewing = document.getElementById('stat-interviewing');
const statOffer = document.getElementById('stat-offer');

// Column elements
const columns = {
  applied: document.getElementById('cards-applied'),
  interviewing: document.getElementById('cards-interviewing'),
  rejected: document.getElementById('cards-rejected'),
  offer: document.getElementById('cards-offer')
};

const counts = {
  applied: document.getElementById('count-applied'),
  interviewing: document.getElementById('count-interviewing'),
  rejected: document.getElementById('count-rejected'),
  offer: document.getElementById('count-offer')
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadApplications();
  await loadActiveTasks();
  setupEventListeners();
  setupDragAndDrop();
  checkUrlParams();
  startPolling();
});

// Load applications from storage
async function loadApplications() {
  try {
    const result = await chrome.storage.local.get(['applications']);
    applications = result.applications || [];
    filteredApps = [...applications];
    renderApplications();
    updateStats();
  } catch (error) {
    console.error('Failed to load applications:', error);
    applications = [];
    filteredApps = [];
    renderApplications();
    updateStats();
  }
}

// Save applications to storage
async function saveApplications() {
  await chrome.storage.local.set({ applications });
}

// Render applications to kanban board
function renderApplications() {
  // Clear all columns
  Object.values(columns).forEach(col => col.innerHTML = '');

  // Show/hide empty state
  if (filteredApps.length === 0) {
    if (applications.length === 0) {
      emptyState.classList.remove('hidden');
      kanbanBoard.classList.add('hidden');
    } else {
      emptyState.classList.add('hidden');
      kanbanBoard.classList.remove('hidden');
    }
  } else {
    emptyState.classList.add('hidden');
    kanbanBoard.classList.remove('hidden');
  }

  // Render cards
  filteredApps.forEach(app => {
    const card = createAppCard(app);
    columns[app.status].appendChild(card);
  });

  // Update counts
  const statusCounts = {
    applied: 0,
    interviewing: 0,
    rejected: 0,
    offer: 0
  };

  filteredApps.forEach(app => {
    statusCounts[app.status]++;
  });

  Object.entries(counts).forEach(([status, el]) => {
    el.textContent = statusCounts[status];
  });
}

// Create application card element
function createAppCard(app) {
  const card = document.createElement('div');
  card.className = 'app-card';
  card.dataset.id = app.id;
  card.draggable = true;

  // Support both field name formats (applied_at/dateApplied, role/position, job_url/jobUrl)
  const appliedDate = app.applied_at || app.dateApplied;
  const role = app.role || app.position || '';
  const jobUrl = app.job_url || app.jobUrl;

  const formattedDate = formatDate(appliedDate);

  card.innerHTML = `
    <div class="app-card-header">
      <div>
        <h3 class="app-company">${escapeHtml(app.company)}</h3>
        <p class="app-role">${escapeHtml(role)}</p>
      </div>
      <div class="app-card-actions">
        ${jobUrl ? `
          <a href="${escapeHtml(jobUrl)}" target="_blank" class="btn btn-icon btn-ghost" title="Open job posting">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M6 3H4a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-2"/>
              <path d="M9 2h5v5"/>
              <path d="M14 2L7 9"/>
            </svg>
          </a>
        ` : ''}
        <button class="btn btn-icon btn-ghost edit-btn" title="Edit" data-id="${app.id}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M11 2l3 3-9 9H2v-3l9-9z"/>
          </svg>
        </button>
        <button class="btn btn-icon btn-ghost delete-btn" title="Delete" data-id="${app.id}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1m2 0v9a1 1 0 01-1 1H5a1 1 0 01-1-1V4"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="app-card-meta">
      <span class="app-date">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="6" cy="6" r="4.5"/>
          <path d="M6 3.5V6l1.5 1"/>
        </svg>
        ${formattedDate}
      </span>
      ${app.salary_range ? `
        <span class="app-salary">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M6 1v10M9 3.5C9 2.67 7.66 2 6 2S3 2.67 3 3.5 4.34 5 6 5s3 .67 3 1.5S7.66 8 6 8s-3-.67-3-1.5"/>
          </svg>
          ${escapeHtml(app.salary_range)}
        </span>
      ` : ''}
    </div>
    ${app.notes ? `<p class="app-notes">${escapeHtml(app.notes)}</p>` : ''}
  `;

  // Add event listeners
  const editBtn = card.querySelector('.edit-btn');
  const deleteBtn = card.querySelector('.delete-btn');

  // Click on card to open edit modal
  card.addEventListener('click', (e) => {
    // Don't trigger if clicking on buttons or links
    if (e.target.closest('button') || e.target.closest('a')) return;
    openEditModal(app);
  });

  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(app);
  });

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteModal(app.id);
  });

  return card;
}

// Update stats
function updateStats() {
  const statusCounts = {
    applied: 0,
    interviewing: 0,
    rejected: 0,
    offer: 0
  };

  applications.forEach(app => {
    statusCounts[app.status]++;
  });

  statTotal.textContent = applications.length;
  statApplied.textContent = statusCounts.applied;
  statInterviewing.textContent = statusCounts.interviewing;
  statOffer.textContent = statusCounts.offer;
}

// Setup event listeners
function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', handleSearch);

  // Add buttons
  addBtn.addEventListener('click', openAddModal);
  emptyAddBtn?.addEventListener('click', openAddModal);

  // Settings
  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html?tab=settings') });
  });

  // Modal
  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  applicationForm.addEventListener('submit', handleFormSubmit);

  // Delete modal
  deleteCancel.addEventListener('click', closeDeleteModal);
  deleteConfirm.addEventListener('click', handleDelete);
  deleteModalOverlay.addEventListener('click', (e) => {
    if (e.target === deleteModalOverlay) closeDeleteModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeDeleteModal();
    }
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openAddModal();
    }
  });
}

// Setup drag and drop
function setupDragAndDrop() {
  Object.values(columns).forEach(column => {
    column.addEventListener('dragover', handleDragOver);
    column.addEventListener('dragenter', handleDragEnter);
    column.addEventListener('dragleave', handleDragLeave);
    column.addEventListener('drop', handleDrop);
  });
}

// Drag handlers
function handleDragStart(e) {
  draggedCard = e.target.closest('.app-card');
  draggedCard.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedCard.dataset.id);
}

function handleDragEnd(e) {
  if (draggedCard) {
    draggedCard.classList.remove('dragging');
    draggedCard = null;
  }
  Object.values(columns).forEach(col => col.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  const column = e.currentTarget;
  column.classList.remove('drag-over');

  const id = e.dataTransfer.getData('text/plain');
  const newStatus = column.dataset.status;

  // Find and update application
  const appIndex = applications.findIndex(app => app.id === id);
  if (appIndex !== -1) {
    applications[appIndex].status = newStatus;
    applications[appIndex].synced = false;

    filteredApps = filterApps(applications, searchInput.value);
    renderApplications();
    updateStats();
    await saveApplications();
  }
}

// Add drag listeners to cards after render
document.addEventListener('dragstart', (e) => {
  if (e.target.classList.contains('app-card')) {
    handleDragStart(e);
  }
});

document.addEventListener('dragend', handleDragEnd);

// Search handler
function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  filteredApps = filterApps(applications, query);
  renderApplications();
}

// Filter applications
function filterApps(apps, query) {
  if (!query) return [...apps];

  return apps.filter(app => {
    const role = app.role || app.position || '';
    return app.company.toLowerCase().includes(query) ||
      role.toLowerCase().includes(query) ||
      (app.notes && app.notes.toLowerCase().includes(query));
  });
}

// Open add modal
function openAddModal() {
  editingApp = null;
  modalTitle.textContent = 'Add application';
  applicationForm.reset();
  document.getElementById('app-id').value = '';
  modalOverlay.classList.remove('hidden');
}

// Open edit modal
function openEditModal(app) {
  editingApp = app;
  modalTitle.textContent = 'Edit application';

  document.getElementById('app-id').value = app.id;
  document.getElementById('app-company').value = app.company;
  document.getElementById('app-role').value = app.role || app.position || '';
  document.getElementById('app-url').value = app.job_url || app.jobUrl || '';
  document.getElementById('app-status').value = app.status;
  document.getElementById('app-salary').value = app.salary_range || '';
  document.getElementById('app-notes').value = app.notes || '';

  modalOverlay.classList.remove('hidden');
}

// Close modal
function closeModal() {
  modalOverlay.classList.add('hidden');
  editingApp = null;
}

// Validate job URL - must be a specific job posting, not generic careers page
function isValidJobUrl(url) {
  if (!url) return false;

  const lowerUrl = url.toLowerCase();

  // Must have a path beyond just /careers or /jobs
  const genericPatterns = [
    /^https?:\/\/[^\/]+\/careers\/?$/,
    /^https?:\/\/[^\/]+\/jobs\/?$/,
    /^https?:\/\/[^\/]+\/?$/
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(lowerUrl)) return false;
  }

  // Valid ATS URLs (these are always specific job postings)
  const validAtsPatterns = [
    'jobs.ashbyhq.com',
    'job-boards.greenhouse.io',
    'boards.greenhouse.io',
    'jobs.lever.co',
    'myworkdayjobs.com'
  ];

  for (const pattern of validAtsPatterns) {
    if (lowerUrl.includes(pattern)) return true;
  }

  // For other URLs, check if they have a job ID or specific path
  const hasJobId = /\/\d+|\/[a-f0-9-]{20,}|\/job\/|\/position\//i.test(url);
  return hasJobId;
}

// Handle form submit
async function handleFormSubmit(e) {
  e.preventDefault();

  const jobUrl = document.getElementById('app-url').value.trim();

  // Validate job URL
  if (!jobUrl) {
    alert('Job URL is required. Please enter the exact URL of the job posting.');
    document.getElementById('app-url').focus();
    return;
  }

  if (!isValidJobUrl(jobUrl)) {
    alert('Please enter a specific job posting URL, not a generic careers page.\n\nValid examples:\n• https://jobs.ashbyhq.com/company/job-id\n• https://job-boards.greenhouse.io/company/jobs/123\n• https://jobs.lever.co/company/job-id');
    document.getElementById('app-url').focus();
    return;
  }

  const formData = {
    company: document.getElementById('app-company').value.trim(),
    role: document.getElementById('app-role').value.trim(),
    job_url: jobUrl,
    status: document.getElementById('app-status').value,
    salary_range: document.getElementById('app-salary').value.trim() || null,
    notes: document.getElementById('app-notes').value.trim() || null,
    synced: false
  };

  const id = document.getElementById('app-id').value;

  if (id) {
    // Update existing
    const index = applications.findIndex(app => app.id === id);
    if (index !== -1) {
      applications[index] = { ...applications[index], ...formData };
    }
  } else {
    // Add new
    const newApp = {
      ...formData,
      id: generateId(),
      applied_at: new Date().toISOString()
    };
    applications.unshift(newApp);
  }

  filteredApps = filterApps(applications, searchInput.value);
  renderApplications();
  updateStats();
  await saveApplications();
  closeModal();
}

// Open delete modal
function openDeleteModal(id) {
  deleteTargetId = id;
  // Close edit modal if open
  closeModal();
  deleteModalOverlay.classList.remove('hidden');
}

// Close delete modal
function closeDeleteModal() {
  deleteModalOverlay.classList.add('hidden');
  deleteTargetId = null;
}

// Handle delete
async function handleDelete() {
  if (!deleteTargetId) return;

  applications = applications.filter(app => app.id !== deleteTargetId);
  filteredApps = filterApps(applications, searchInput.value);
  renderApplications();
  updateStats();
  await saveApplications();
  closeDeleteModal();
}

// Check URL params for actions
function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('upgrade') === 'success') {
    showToast('Welcome to Peebo Premium!', 'success');
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// Utility functions
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;

  // Today
  if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
    return 'Today';
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getDate() === yesterday.getDate()) {
    return 'Yesterday';
  }

  // This week
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }

  // This year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Other years
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function showToast(message, type = 'info') {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
  `;

  document.body.appendChild(toast);

  // Remove after 3 seconds
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ========== Active Tasks (Browser-use Cloud) ==========

// Load active tasks from background service worker
async function loadActiveTasks() {
  try {
    // Get active tasks from background service worker's state
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TASKS' });

    if (response && response.tasks) {
      activeTasks = new Map(Object.entries(response.tasks));
      await refreshActiveTasks();
    }
  } catch (error) {
    console.error('Failed to load active tasks:', error);
  }
}

// Refresh active tasks by fetching latest status from browser-use API
async function refreshActiveTasks() {
  if (activeTasks.size === 0) {
    activeApplications.classList.add('hidden');
    return;
  }

  // Show the active applications section
  activeApplications.classList.remove('hidden');

  // Update count
  activeCount.textContent = activeTasks.size;

  // Fetch latest status for each task
  const taskPromises = Array.from(activeTasks.entries()).map(async ([taskId, task]) => {
    try {
      const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${task.browserUseTaskId}`, {
        headers: {
          'X-Browser-Use-API-Key': BROWSER_USE_API_KEY
        }
      });

      if (response.ok) {
        const taskData = await response.json();
        return { taskId, task, taskData };
      }
    } catch (error) {
      console.error(`Failed to fetch task ${taskId}:`, error);
    }
    return { taskId, task, taskData: null };
  });

  const results = await Promise.all(taskPromises);
  renderActiveTasks(results);
}

// Render active task cards
function renderActiveTasks(taskResults) {
  activeJobs.innerHTML = '';

  if (taskResults.length === 0) {
    activeJobs.innerHTML = '<div class="active-empty">No active applications right now</div>';
    return;
  }

  taskResults.forEach(({ taskId, task, taskData }) => {
    const card = createActiveJobCard(taskId, task, taskData);
    activeJobs.appendChild(card);
  });
}

// Create an active job card with audit trail
function createActiveJobCard(taskId, task, taskData) {
  const card = document.createElement('div');
  card.className = 'active-job-card';

  // Calculate progress
  let progress = task.progress || 0;
  let status = task.status || 'running';
  let currentStep = 'Initializing...';

  if (taskData) {
    // Use actual data from browser-use API
    if (taskData.state === 'completed' || taskData.state === 'success') {
      progress = 100;
      status = 'completed';
      currentStep = 'Application submitted!';
    } else if (taskData.state === 'failed' || taskData.state === 'error') {
      status = 'failed';
      currentStep = 'Application failed';
    } else if (taskData.steps && taskData.steps.length > 0) {
      const lastStep = taskData.steps[taskData.steps.length - 1];
      progress = Math.min(95, (taskData.steps.length / 20) * 100);
      currentStep = lastStep.description || lastStep.action || 'Working...';
    }
  }

  // Calculate elapsed time
  const elapsed = Math.floor((Date.now() - task.startedAt) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const elapsedStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  // Calculate total cost
  let totalCost = 0;
  if (taskData && taskData.steps) {
    totalCost = taskData.steps.reduce((sum, step) => sum + (parseFloat(step.cost) || 0), 0);
  }

  card.innerHTML = `
    <div class="active-job-header">
      <div class="active-job-info">
        <h3>${escapeHtml(task.company)}</h3>
        <p>${escapeHtml(task.jobUrl)}</p>
      </div>
      <div class="active-job-meta">
        <div class="meta-badge">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="6" cy="6" r="5"/>
            <path d="M6 3v3l2 2"/>
          </svg>
          ${elapsedStr}
        </div>
        ${totalCost > 0 ? `<div class="meta-badge" style="color: var(--color-success);">$${totalCost.toFixed(3)}</div>` : ''}
      </div>
    </div>

    <div class="active-progress">
      <div class="progress-info">
        <span class="progress-label">${escapeHtml(currentStep)}</span>
        <span class="progress-percent">${Math.round(progress)}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
    </div>

    ${taskData && taskData.steps && taskData.steps.length > 0 ? `
      <div class="audit-trail">
        <div class="audit-header">
          <h4>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 7h10M2 3h10M2 11h7"/>
            </svg>
            Execution timeline
          </h4>
          <button class="audit-toggle" data-task-id="${taskId}">
            <span>Show ${taskData.steps.length} steps</span>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 5l3 3 3-3"/>
            </svg>
          </button>
        </div>
        <div class="audit-steps" data-task-id="${taskId}">
          ${taskData.steps.map((step, index) => createAuditStep(step, index + 1)).join('')}
        </div>
      </div>
    ` : ''}
  `;

  // Add event listener for audit toggle
  const toggle = card.querySelector('.audit-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const steps = card.querySelector(`.audit-steps[data-task-id="${taskId}"]`);
      const isExpanded = steps.classList.contains('expanded');

      if (isExpanded) {
        steps.classList.remove('expanded');
        toggle.classList.remove('expanded');
        toggle.querySelector('span').textContent = `Show ${taskData.steps.length} steps`;
      } else {
        steps.classList.add('expanded');
        toggle.classList.add('expanded');
        toggle.querySelector('span').textContent = `Hide steps`;
      }
    });
  }

  return card;
}

// Create an audit step element
function createAuditStep(step, stepNumber) {
  const duration = step.duration ? `${step.duration}s` : '-';
  const cost = step.cost ? `$${parseFloat(step.cost).toFixed(3)}` : '';
  const actions = step.action || (step.actions ? step.actions.join(', ') : 'action');
  const description = step.description || '';

  return `
    <div class="audit-step">
      <div class="step-number">${stepNumber}</div>
      <div class="step-content">
        <div class="step-actions">${escapeHtml(actions)}</div>
        ${description ? `<div class="step-description">${escapeHtml(description)}</div>` : ''}
        ${step.screenshot_url ? `
          <div class="step-screenshot" onclick="openScreenshot('${step.screenshot_url}')">
            <img src="${step.screenshot_url}" alt="Step ${stepNumber} screenshot" loading="lazy">
          </div>
        ` : ''}
      </div>
      <div class="step-meta">
        <div class="step-duration">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
            <circle cx="5" cy="5" r="4"/>
            <path d="M5 2v3l1.5 1.5"/>
          </svg>
          ${duration}
        </div>
        ${cost ? `<div class="step-cost">${cost}</div>` : ''}
      </div>
    </div>
  `;
}

// Open screenshot in modal
window.openScreenshot = function(url) {
  const modal = document.createElement('div');
  modal.className = 'screenshot-modal';
  modal.innerHTML = `<img src="${url}" alt="Screenshot">`;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
};

// Start polling for active task updates
function startPolling() {
  // Poll every 3 seconds
  pollInterval = setInterval(async () => {
    if (activeTasks.size > 0) {
      await refreshActiveTasks();
    }
  }, 3000);
}

// Stop polling
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TASK_STARTED') {
    activeTasks.set(message.taskId, message.task);
    refreshActiveTasks();
  } else if (message.type === 'TASK_COMPLETED') {
    activeTasks.delete(message.taskId);
    refreshActiveTasks();
    loadApplications(); // Reload applications to show new one
  } else if (message.type === 'TASK_FAILED') {
    activeTasks.delete(message.taskId);
    refreshActiveTasks();
  }
});

// Add refresh button listener
if (refreshActive) {
  refreshActive.addEventListener('click', async () => {
    refreshActive.disabled = true;
    await refreshActiveTasks();
    setTimeout(() => {
      refreshActive.disabled = false;
    }, 1000);
  });
}

// ========== AgentMail Sync Status ==========

// Sync status elements
const syncIndicator = document.getElementById('sync-indicator');
const syncText = document.getElementById('sync-text');
const syncNowBtn = document.getElementById('sync-now-btn');

// Update sync status display
async function updateSyncStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });

    if (!response) {
      syncIndicator.className = 'sync-indicator not-configured';
      syncText.textContent = 'Email sync';
      return;
    }

    if (!response.isConfigured) {
      syncIndicator.className = 'sync-indicator not-configured';
      syncText.textContent = 'Not configured';
      return;
    }

    if (response.lastSyncAt) {
      const lastSync = new Date(response.lastSyncAt);
      const now = new Date();
      const diffMs = now - lastSync;
      const diffMins = Math.floor(diffMs / 60000);

      syncIndicator.className = 'sync-indicator synced';

      if (diffMins < 1) {
        syncText.textContent = 'Synced just now';
      } else if (diffMins === 1) {
        syncText.textContent = 'Synced 1m ago';
      } else if (diffMins < 60) {
        syncText.textContent = `Synced ${diffMins}m ago`;
      } else {
        const hours = Math.floor(diffMins / 60);
        syncText.textContent = `Synced ${hours}h ago`;
      }
    } else {
      syncIndicator.className = 'sync-indicator not-configured';
      syncText.textContent = 'Not synced yet';
    }
  } catch (error) {
    console.error('Failed to get sync status:', error);
    syncIndicator.className = 'sync-indicator error';
    syncText.textContent = 'Sync error';
  }
}

// Manual sync trigger
async function triggerManualSync() {
  syncNowBtn.classList.add('syncing');
  syncIndicator.className = 'sync-indicator syncing';
  syncText.textContent = 'Checking emails...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'SYNC_AGENTMAIL' });

    if (response && response.success) {
      if (response.updatedCount > 0) {
        showToast(`Updated ${response.updatedCount} application(s) from email`, 'success');
        await loadApplications();
      } else {
        showToast('No new updates from email', 'info');
      }
    } else if (response && response.error) {
      showToast(`Sync error: ${response.error}`, 'error');
    }

    await updateSyncStatus();
  } catch (error) {
    console.error('Manual sync failed:', error);
    showToast('Sync failed', 'error');
  } finally {
    syncNowBtn.classList.remove('syncing');
  }
}

// Setup sync button listener
if (syncNowBtn) {
  syncNowBtn.addEventListener('click', triggerManualSync);
}

// Initial sync status update
updateSyncStatus();

// Periodically update sync status (every 30 seconds)
setInterval(updateSyncStatus, 30000);

// Extend message listener to handle APPLICATIONS_UPDATED
const originalMessageListener = chrome.runtime.onMessage.hasListener;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'APPLICATIONS_UPDATED') {
    // Refresh applications when AgentMail sync updates them
    loadApplications();
    updateSyncStatus();
    showToast('Applications updated from email', 'info');
  }
});
