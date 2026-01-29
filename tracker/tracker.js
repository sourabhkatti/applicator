/**
 * Unified Job Application Tracker
 * Combines Peebo design with local tracker features
 */

// ============================================
// GLOBAL STATE
// ============================================

let trackerData = null;
let settings = null;
let activeTaskPollInterval = null;
let currentDetailJobId = null;

// Side panel state
let currentPanel = null; // 'activity' | 'job'
let currentJob = null;
let activeTab = 'details';
let navigationStack = []; // For back button
let hasUnreadActivity = false;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Tracker] Initializing...');
  await init();
});

async function init() {
  try {
    // Load data
    trackerData = await storage.load();
    settings = trackerData.settings;
    
    console.log(`[Tracker] Loaded ${trackerData.jobs?.length || 0} jobs`);
    
    // Render UI
    renderUI();
    
    // Start active task polling (3s interval)
    startActiveTaskPolling();
    
    // Setup event listeners
    setupEventListeners();
    
  } catch (error) {
    console.error('[Tracker] Initialization failed:', error);
    showError('Failed to load tracker data. Please refresh the page.');
  }
}

async function refreshUI() {
  trackerData = await storage.load();
  settings = trackerData.settings;
  renderUI();
}

// ============================================
// ACTIVE TASK POLLING
// ============================================

function startActiveTaskPolling() {
  // Clear any existing interval
  if (activeTaskPollInterval) {
    clearInterval(activeTaskPollInterval);
  }
  
  // Poll every 3 seconds
  activeTaskPollInterval = setInterval(async () => {
    try {
      const data = await storage.load();
      const activeTasks = data.settings?.active_tasks || {};
      updateActiveTasksSection(activeTasks);
    } catch (error) {
      console.error('[Tracker] Polling error:', error);
    }
  }, 3000);
  
  console.log('[Tracker] Active task polling started');
}

function updateActiveTasksSection(activeTasks) {
  const activeSection = document.getElementById('active-applications');
  const activeCount = document.getElementById('active-count');
  const activeJobs = document.getElementById('active-jobs');
  
  const taskArray = Object.values(activeTasks);
  
  if (taskArray.length === 0) {
    activeSection.classList.add('hidden');
    return;
  }
  
  activeSection.classList.remove('hidden');
  activeCount.textContent = taskArray.length;
  
  activeJobs.innerHTML = taskArray.map(task => createActiveJobCard(task)).join('');
}

function createActiveJobCard(task) {
  const elapsed = task.started_at ?
    Math.floor((Date.now() - new Date(task.started_at).getTime()) / 1000) : 0;
  const elapsedMin = Math.floor(elapsed / 60);
  const elapsedSec = elapsed % 60;

  // Determine status display
  let statusDisplay = '';
  if (task.status === 'running') {
    statusDisplay = '⚡ In progress';
  } else if (task.status === 'error') {
    statusDisplay = '❌ Error';
  } else if (task.status === 'cancelled') {
    statusDisplay = '⏹ Cancelled';
  } else {
    statusDisplay = '✅ Done';
  }

  // Error message section (only shown on error)
  const errorSection = task.status === 'error' && task.error_message ? `
    <div class="active-job-error">
      <div class="error-message">${escapeHtml(task.error_message)}</div>
    </div>
  ` : '';

  // Cost display
  const costDisplay = task.cost > 0 ? `$${task.cost.toFixed(4)}` : '';

  // Show stop button only for running tasks
  const showStopButton = task.status === 'running';

  // Show dismiss button for cancelled/error tasks
  const showDismissButton = task.status === 'cancelled' || task.status === 'error';

  return `
    <div class="active-job-card ${task.status === 'error' ? 'has-error' : ''} ${task.status === 'cancelled' ? 'has-cancelled' : ''}">
      <div class="active-job-header">
        <div class="active-job-info">
          <h3>${escapeHtml(task.company || 'Unknown Company')}</h3>
          <p>${escapeHtml(task.role || 'Unknown Role')}</p>
        </div>
        <div class="active-job-meta">
          ${costDisplay ? `<span class="meta-badge cost-badge">💰 ${costDisplay}</span>` : ''}
          <span class="active-job-status">${statusDisplay}</span>
        </div>
      </div>
      ${errorSection}
      <div class="active-job-progress">
        <div class="progress-text">${escapeHtml(task.current_step || 'Processing...')} • ${elapsedMin}m ${elapsedSec}s</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${task.progress || 0}%"></div>
        </div>
      </div>
      <div class="active-job-actions">
        ${showStopButton ? `<button class="btn-cancel" onclick="cancelTask('${task.task_id}')">⏹ Stop</button>` : ''}
        ${showDismissButton ? `<button class="btn-dismiss" onclick="dismissTask('${task.task_id}')">✕ Dismiss</button>` : ''}
      </div>
    </div>
  `;
}

// ============================================
// TASK ACTIONS
// ============================================

async function cancelTask(taskId) {
  try {
    const response = await fetch('/api/cancel_task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId })
    });

    const result = await response.json();

    if (response.ok) {
      console.log(`[Tracker] Task ${taskId} cancelled`);
      // Refresh immediately to show cancelled status
      await refreshUI();
    } else {
      console.error('[Tracker] Cancel failed:', result.error);
      showError(`Failed to cancel task: ${result.error}`);
    }
  } catch (error) {
    console.error('[Tracker] Cancel error:', error);
    showError('Failed to cancel task. Please try again.');
  }
}

async function dismissTask(taskId) {
  try {
    const response = await fetch('/api/remove_task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId })
    });

    const result = await response.json();

    if (response.ok) {
      console.log(`[Tracker] Task ${taskId} dismissed`);
      // Refresh to remove from UI
      await refreshUI();
    } else {
      console.error('[Tracker] Dismiss failed:', result.error);
      showError(`Failed to dismiss task: ${result.error}`);
    }
  } catch (error) {
    console.error('[Tracker] Dismiss error:', error);
    showError('Failed to dismiss task. Please try again.');
  }
}

// ============================================
// UI RENDERING
// ============================================

function renderUI() {
  renderStats();
  renderKanbanBoard();
  updateColumnCounts();
}

function renderStats() {
  const jobs = trackerData.jobs || [];
  const total = jobs.length;
  const applied = jobs.filter(j => j.status === 'applied').length;
  const interviewing = jobs.filter(j => j.status === 'interviewing').length;
  const offer = jobs.filter(j => j.status === 'offer').length;
  
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-applied').textContent = applied;
  document.getElementById('stat-interviewing').textContent = interviewing;
  document.getElementById('stat-offer').textContent = offer;
}

function renderKanbanBoard() {
  const jobs = trackerData.jobs || [];
  const searchQuery = document.getElementById('search-input').value.toLowerCase();
  
  // Filter jobs by search
  const filteredJobs = jobs.filter(job => {
    if (!searchQuery) return true;
    return (
      job.company.toLowerCase().includes(searchQuery) ||
      job.role.toLowerCase().includes(searchQuery) ||
      (job.notes && job.notes.toLowerCase().includes(searchQuery))
    );
  });
  
  // Clear all columns
  ['applied', 'interviewing', 'rejected', 'offer'].forEach(status => {
    document.getElementById(`cards-${status}`).innerHTML = '';
  });
  
  // Render jobs
  filteredJobs.forEach(job => {
    const card = createJobCard(job);
    const container = document.getElementById(`cards-${job.status}`);
    if (container) {
      container.innerHTML += card;
    }
  });
  
  // Setup drag and drop
  setupDragAndDrop();
}

function createJobCard(job) {
  const badges = [];
  
  // Follow-up badge
  if (needsFollowUp(job)) {
    badges.push('<span class="badge badge-followup">🔴 Follow up</span>');
  }
  
  // Interview badge
  const upcomingInterview = getUpcomingInterview(job);
  if (upcomingInterview) {
    const date = new Date(upcomingInterview.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    badges.push(`<span class="badge badge-interview">🟢 Interview: ${date}</span>`);
  }
  
  // Referral badge
  if (job.referralStatus === 'received') {
    badges.push('<span class="badge badge-referral">🟡 Referral</span>');
  }
  
  // Email verified badge
  if (job.email_verified) {
    badges.push('<span class="badge badge-email-verified">✅ Verified</span>');
  }
  
  // Interview stage pill
  let stagePill = '';
  if (job.status === 'interviewing' && job.interview_stage) {
    const stageLabels = {
      recruiter_screen: '🔵 Recruiter',
      hiring_manager: '🟡 HM',
      panel_onsite: '🟢 Onsite'
    };
    const stageClass = job.interview_stage.replace('_', '-');
    stagePill = `<span class="stage-pill ${stageClass}" data-job-id="${job.id}">${stageLabels[job.interview_stage]}</span>`;
  }
  
  // Determine action banner
  let actionBanner = '';
  let actionClass = '';
  if (needsFollowUp(job)) {
    actionBanner = '⚠️ FOLLOW UP NEEDED';
    actionClass = 'urgent';
  } else {
    const upcomingInterview = getUpcomingInterview(job);
    if (upcomingInterview) {
      const date = new Date(upcomingInterview.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      actionBanner = `📅 INTERVIEW: ${date} - ${upcomingInterview.type}`;
      actionClass = 'interview';
    } else if (job.nextAction) {
      actionBanner = job.nextAction.toUpperCase();
      actionClass = 'waiting';
    } else {
      actionBanner = 'WAITING FOR RESPONSE';
      actionClass = 'waiting';
    }
  }

  // Salary display
  let salaryText = '';
  if (job.salaryMin || job.salaryMax) {
    if (job.salaryMin && job.salaryMax) {
      salaryText = `$${Math.round(job.salaryMin/1000)}k-$${Math.round(job.salaryMax/1000)}k`;
    } else if (job.salaryMin) {
      salaryText = `$${Math.round(job.salaryMin/1000)}k+`;
    } else {
      salaryText = `Up to $${Math.round(job.salaryMax/1000)}k`;
    }
  }

  // Days since applied
  const daysSince = Math.floor((new Date() - new Date(job.dateApplied)) / (1000 * 60 * 60 * 24));
  const daysText = daysSince === 0 ? 'Today' : daysSince === 1 ? '1 day ago' : `${daysSince} days ago`;

  return `
    <div class="job-card"
         data-job-id="${job.id}"
         draggable="true"
         onclick="openJobPanel('${job.id}')"
         oncontextmenu="showCardContextMenu(event, '${job.id}')">
      <div class="job-card-action ${actionClass}">
        ${actionBanner}
      </div>
      <div class="job-card-body">
        <div class="job-card-header">
          <h3>${escapeHtml(job.company)}</h3>
          ${job.jobUrl ? `<a href="${escapeHtml(job.jobUrl)}" target="_blank" onclick="event.stopPropagation()" title="Open job posting">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 10l8-8M14 6V2h-4M14 2L8 8"/>
            </svg>
          </a>` : ''}
        </div>
        <p class="job-role">${escapeHtml(job.role)}</p>
        ${stagePill}

        <div class="job-details-grid">
          ${salaryText ? `<div class="detail-item"><span class="detail-label">Salary</span><span class="detail-value salary">${salaryText}</span></div>` : ''}
          <div class="detail-item">
            <span class="detail-label">Applied</span>
            <span class="detail-value date">${daysText}</span>
          </div>
          ${job.application_cost ? `<div class="detail-item"><span class="detail-label">Cost</span><span class="detail-value cost">$${job.application_cost.toFixed(4)}</span></div>` : ''}
          ${job.recruiterName ? `<div class="detail-item"><span class="detail-label">Recruiter</span><span class="detail-value">${escapeHtml(job.recruiterName)}</span></div>` : ''}
          ${job.referralStatus === 'received' ? `<div class="detail-item"><span class="detail-label">Referral</span><span class="detail-value referral">✓ ${escapeHtml(job.referralContact || 'Yes')}</span></div>` : ''}
        </div>

        ${badges.length > 0 ? `<div class="card-badges">${badges.join('')}</div>` : ''}
      </div>
    </div>
  `;
}

function updateColumnCounts() {
  const jobs = trackerData.jobs || [];
  ['applied', 'interviewing', 'rejected', 'offer'].forEach(status => {
    const count = jobs.filter(j => j.status === status).length;
    document.getElementById(`count-${status}`).textContent = count;
  });
}

// ============================================
// FOLLOW-UP LOGIC
// ============================================

function needsFollowUp(job) {
  if (job.status === 'rejected' || job.status === 'offer') return false;
  
  // Check explicit followUpBy date
  if (job.followUpBy) {
    return new Date(job.followUpBy) <= new Date();
  }
  
  // Calculate working days since last activity
  const workingDays = calculateWorkingDaysSince(job.lastActivityDate);
  return workingDays >= settings.followUpDays;
}

function calculateWorkingDaysSince(dateStr) {
  let count = 0;
  let checkDate = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  while (checkDate < today) {
    checkDate.setDate(checkDate.getDate() + 1);
    const day = checkDate.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (day !== 0 && day !== 6) {
      count++;
    }
  }
  
  return count;
}

function getUpcomingInterview(job) {
  if (!job.interviews || job.interviews.length === 0) return null;
  
  const now = new Date();
  const upcoming = job.interviews
    .filter(int => new Date(int.date) > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  
  return upcoming[0] || null;
}

// ============================================
// EVENT LISTENERS (Part 1)
// ============================================

function setupEventListeners() {
  // Search
  document.getElementById('search-input').addEventListener('input', () => {
    renderKanbanBoard();
  });
  
  // Add button
  document.getElementById('add-btn').addEventListener('click', openAddModal);
  
  // Settings button
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
  
  // Refresh active tasks
  document.getElementById('refresh-active').addEventListener('click', async () => {
    await refreshUI();
  });
  
  // Modal close handlers
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });
  
  // Click outside modal to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeAllModals();
      }
    });
  });
  
  // Add form submit
  document.getElementById('add-form').addEventListener('submit', handleAddJob);
  
  // Detail form submit
  document.getElementById('detail-form').addEventListener('submit', handleSaveDetail);
  
  // Settings form submit
  document.getElementById('settings-form').addEventListener('submit', handleSaveSettings);
  
  // Detail modal tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
  
  // Add interview button
  document.getElementById('add-interview-btn').addEventListener('click', handleAddInterview);

  // Interview form submit
  document.getElementById('interview-form').addEventListener('submit', handleInterviewFormSubmit);

  // Interview type change (show/hide custom field)
  document.getElementById('interview-type').addEventListener('change', (e) => {
    const customGroup = document.getElementById('interview-type-custom-group');
    if (e.target.value === 'Other') {
      customGroup.style.display = 'block';
      document.getElementById('interview-type-custom').focus();
    } else {
      customGroup.style.display = 'none';
    }
  });

  // Stage pill click handler (event delegation)
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('stage-pill')) {
      e.stopPropagation();
      handleStagePillClick(e.target.dataset.jobId);
    }
  });
  
  // Context menu close on click outside
  document.addEventListener('click', () => {
    const menu = document.getElementById('context-menu');
    if (!menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
    }
  });

  // Batch apply button
  document.getElementById('batch-apply-btn').addEventListener('click', openBatchApplyModal);

  // Batch apply form submit
  document.getElementById('batch-apply-form').addEventListener('submit', handleBatchApplySubmit);

  // Email sync button
  document.getElementById('sync-now-btn').addEventListener('click', triggerEmailSync);

  // Update sync status display on load
  updateEmailSyncStatus();

  // Activity button
  document.getElementById('activity-btn').addEventListener('click', () => {
    openSidePanel('activity');
  });

  // Panel close button
  document.getElementById('panel-close').addEventListener('click', closeSidePanel);

  // Panel back button
  document.getElementById('panel-back').addEventListener('click', navigateBack);

  // Panel backdrop click to close
  document.getElementById('panel-backdrop').addEventListener('click', closeSidePanel);

  // Panel tab clicks
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchPanelTab(tabName);
    });
  });

  // Escape key to close panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentPanel) {
      closeSidePanel();
    }
  });
}

// ============================================
// EMAIL SYNC FUNCTIONS
// ============================================

function updateEmailSyncStatus() {
  const container = document.getElementById('email-sync-status');
  const indicator = document.getElementById('sync-indicator');
  const text = document.getElementById('sync-text');

  const lastSync = settings?.last_email_sync;
  const syncStatus = settings?.email_sync_status;

  if (syncStatus === 'syncing') {
    container.classList.add('syncing');
    container.classList.remove('error');
    indicator.textContent = '🔄';
    text.textContent = 'Syncing...';
    return;
  }

  container.classList.remove('syncing');

  if (syncStatus === 'error') {
    container.classList.add('error');
    indicator.textContent = '⚠️';
    text.textContent = 'Error';
    return;
  }

  container.classList.remove('error');
  indicator.textContent = '📧';

  if (!lastSync) {
    text.textContent = '--';
    return;
  }

  // Calculate time ago
  const syncDate = new Date(lastSync);
  const now = new Date();
  const diffMs = now - syncDate;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) {
    text.textContent = 'Just now';
  } else if (diffMins < 60) {
    text.textContent = `${diffMins}m ago`;
  } else {
    const diffHours = Math.floor(diffMins / 60);
    text.textContent = `${diffHours}h ago`;
  }
}

async function triggerEmailSync() {
  const container = document.getElementById('email-sync-status');
  const indicator = document.getElementById('sync-indicator');
  const text = document.getElementById('sync-text');

  // Show syncing state
  container.classList.add('syncing');
  container.classList.remove('error');
  indicator.textContent = '🔄';
  text.textContent = 'Syncing...';

  try {
    const response = await fetch('/api/trigger_email_sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (response.ok) {
      console.log('[Tracker] Email sync complete:', result.message);
      // Refresh to get updated jobs
      await refreshUI();
    } else {
      console.error('[Tracker] Email sync failed:', result.error);
      container.classList.add('error');
      indicator.textContent = '⚠️';
      text.textContent = 'Error';
    }
  } catch (error) {
    console.error('[Tracker] Email sync error:', error);
    container.classList.add('error');
    indicator.textContent = '⚠️';
    text.textContent = 'Error';
  } finally {
    container.classList.remove('syncing');
    // Update status display after a short delay
    setTimeout(updateEmailSyncStatus, 1000);
  }
}

// ============================================
// BATCH APPLY FUNCTIONS
// ============================================

function openBatchApplyModal() {
  const overlay = document.getElementById('batch-apply-modal-overlay');
  const form = document.getElementById('batch-apply-form');
  form.reset();
  document.getElementById('batch-target').value = '10';
  overlay.classList.remove('hidden');
}

function closeBatchApplyModal() {
  document.getElementById('batch-apply-modal-overlay').classList.add('hidden');
}

async function handleBatchApplySubmit(e) {
  e.preventDefault();

  const target = parseInt(document.getElementById('batch-target').value) || 10;
  const urlsText = document.getElementById('batch-urls').value.trim();

  // Parse URLs if provided
  const urls = urlsText
    ? urlsText.split('\n').map(u => u.trim()).filter(u => u && u.startsWith('http'))
    : [];

  // Validate
  if (target < 1 || target > 50) {
    showError('Please enter a number between 1 and 50');
    return;
  }

  // Close modal
  closeBatchApplyModal();

  // Show loading state
  console.log('[Tracker] Starting batch apply:', { target, urlCount: urls.length });

  try {
    const response = await fetch('/api/batch_apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, urls })
    });

    const result = await response.json();

    if (response.ok) {
      console.log('[Tracker] Batch started:', result);
      // Refresh to show active tasks
      await refreshUI();
    } else {
      showError(`Failed to start batch: ${result.error}`);
    }
  } catch (error) {
    console.error('[Tracker] Batch apply error:', error);
    showError('Failed to start batch application. Please try again.');
  }
}

// ============================================
// MODAL FUNCTIONS (Part 1)
// ============================================

function openAddModal() {
  document.getElementById('add-modal-overlay').classList.remove('hidden');
  document.getElementById('add-form').reset();
}

function openDetailModal(jobId) {
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;
  
  currentDetailJobId = jobId;
  
  // Populate form
  document.getElementById('detail-id').value = job.id;
  document.getElementById('detail-title').textContent = `${job.company} - ${job.role}`;
  
  // Basic tab
  document.getElementById('detail-company').value = job.company || '';
  document.getElementById('detail-role').value = job.role || '';
  document.getElementById('detail-status').value = job.status || 'applied';
  document.getElementById('detail-interview-stage').value = job.interview_stage || '';
  document.getElementById('detail-url').value = job.jobUrl || '';
  document.getElementById('detail-date-applied').value = job.dateApplied || '';
  document.getElementById('detail-last-activity').value = job.lastActivityDate || '';
  document.getElementById('detail-follow-up-by').value = job.followUpBy || '';
  document.getElementById('detail-salary-min').value = job.salaryMin || '';
  document.getElementById('detail-salary-max').value = job.salaryMax || '';
  document.getElementById('detail-next-action').value = job.nextAction || '';
  document.getElementById('detail-referral-status').value = job.referralStatus || 'none';
  
  // Contacts tab
  document.getElementById('detail-recruiter-name').value = job.recruiterName || '';
  document.getElementById('detail-recruiter-email').value = job.recruiterEmail || '';
  document.getElementById('detail-hm-name').value = job.hiringManagerName || '';
  document.getElementById('detail-hm-email').value = job.hiringManagerEmail || '';
  document.getElementById('detail-referral-contact').value = job.referralContact || '';
  
  // Interviews tab
  renderInterviewsList(job.interviews || []);
  
  // Prep tab
  const prep = job.prepChecklist || {};
  document.getElementById('prep-company-research').checked = prep.companyResearch || false;
  document.getElementById('prep-star-stories').checked = prep.starStories || false;
  document.getElementById('prep-questions-ready').checked = prep.questionsReady || false;
  document.getElementById('prep-technical-prep').checked = prep.technicalPrep || false;
  
  // Offer tab
  const offer = job.offer || {};
  document.getElementById('detail-offer-initial').value = offer.initial || '';
  document.getElementById('detail-offer-counter').value = offer.counter || '';
  document.getElementById('detail-offer-final').value = offer.final || '';
  document.getElementById('detail-offer-bonus').value = offer.bonus || '';
  document.getElementById('detail-offer-equity').value = offer.equity || '';
  
  // Notes tab
  document.getElementById('detail-notes').value = job.notes || '';
  document.getElementById('detail-company-research').value = job.companyResearch || '';
  
  // Show modal
  document.getElementById('detail-modal-overlay').classList.remove('hidden');
  switchTab('basic');
}

function openSettingsModal() {
  document.getElementById('settings-follow-up-days').value = settings.followUpDays || 2;
  document.getElementById('settings-modal-overlay').classList.remove('hidden');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.classList.add('hidden');
  });
  currentDetailJobId = null;
}

function switchTab(tabName) {
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  // Update content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.dataset.tab === tabName);
  });
}

// ============================================
// FORM HANDLERS
// ============================================

async function handleAddJob(e) {
  e.preventDefault();
  
  const newJob = {
    id: generateUUID(),
    company: document.getElementById('add-company').value.trim(),
    role: document.getElementById('add-role').value.trim(),
    status: document.getElementById('add-status').value,
    interview_stage: null,
    dateApplied: new Date().toISOString().split('T')[0],
    applied_at: new Date().toISOString(),
    lastActivityDate: new Date().toISOString().split('T')[0],
    followUpBy: null,
    jobUrl: document.getElementById('add-url').value.trim() || null,
    salaryMin: parseInt(document.getElementById('add-salary-min').value) || null,
    salaryMax: parseInt(document.getElementById('add-salary-max').value) || null,
    recruiterName: null,
    recruiterEmail: null,
    hiringManagerName: null,
    hiringManagerEmail: null,
    referralContact: null,
    referralStatus: 'none',
    interviews: [],
    notes: document.getElementById('add-notes').value.trim() || '',
    companyResearch: null,
    prepChecklist: {
      companyResearch: false,
      starStories: false,
      questionsReady: false,
      technicalPrep: false
    },
    offer: null,
    nextAction: 'Wait for response',
    email_verified: false,
    browser_use_task_id: null,
    audit_trail: [],
    synced: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  trackerData.jobs.unshift(newJob);
  await storage.save(trackerData);

  // Log activity
  await logActivity('new_application', newJob.id, newJob.company, newJob.role, {
    source: 'manual'
  }, newJob.status);

  closeAllModals();
  await refreshUI();
}

async function handleSaveDetail(e) {
  e.preventDefault();

  const jobId = document.getElementById('detail-id').value;
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;

  // Track old values for activity logging
  const oldStatus = job.status;
  const oldNotes = job.notes || '';

  // Update job
  job.company = document.getElementById('detail-company').value.trim();
  job.role = document.getElementById('detail-role').value.trim();
  job.status = document.getElementById('detail-status').value;
  job.interview_stage = document.getElementById('detail-interview-stage').value || null;
  job.jobUrl = document.getElementById('detail-url').value.trim() || null;
  job.dateApplied = document.getElementById('detail-date-applied').value;
  job.lastActivityDate = document.getElementById('detail-last-activity').value;
  job.followUpBy = document.getElementById('detail-follow-up-by').value || null;
  job.salaryMin = parseInt(document.getElementById('detail-salary-min').value) || null;
  job.salaryMax = parseInt(document.getElementById('detail-salary-max').value) || null;
  job.nextAction = document.getElementById('detail-next-action').value.trim();
  job.referralStatus = document.getElementById('detail-referral-status').value;
  
  job.recruiterName = document.getElementById('detail-recruiter-name').value.trim() || null;
  job.recruiterEmail = document.getElementById('detail-recruiter-email').value.trim() || null;
  job.hiringManagerName = document.getElementById('detail-hm-name').value.trim() || null;
  job.hiringManagerEmail = document.getElementById('detail-hm-email').value.trim() || null;
  job.referralContact = document.getElementById('detail-referral-contact').value.trim() || null;
  
  job.prepChecklist = {
    companyResearch: document.getElementById('prep-company-research').checked,
    starStories: document.getElementById('prep-star-stories').checked,
    questionsReady: document.getElementById('prep-questions-ready').checked,
    technicalPrep: document.getElementById('prep-technical-prep').checked
  };
  
  // Offer
  const offerInitial = document.getElementById('detail-offer-initial').value;
  const offerCounter = document.getElementById('detail-offer-counter').value;
  const offerFinal = document.getElementById('detail-offer-final').value;
  const offerBonus = document.getElementById('detail-offer-bonus').value;
  const offerEquity = document.getElementById('detail-offer-equity').value.trim();
  
  if (offerInitial || offerCounter || offerFinal || offerBonus || offerEquity) {
    job.offer = {
      initial: parseInt(offerInitial) || null,
      counter: parseInt(offerCounter) || null,
      final: parseInt(offerFinal) || null,
      bonus: parseInt(offerBonus) || null,
      equity: offerEquity || null
    };
  } else {
    job.offer = null;
  }
  
  const newNotes = document.getElementById('detail-notes').value.trim();
  job.notes = newNotes;
  job.companyResearch = document.getElementById('detail-company-research').value.trim() || null;

  job.updated_at = new Date().toISOString();

  await storage.save(trackerData);

  // Log activity for status change
  if (oldStatus !== job.status) {
    await logActivity('status_change', job.id, job.company, job.role, {
      from: oldStatus,
      to: job.status
    }, job.status);
  }

  // Log activity for notes change (if significant)
  if (newNotes !== oldNotes && Math.abs(newNotes.length - oldNotes.length) > 10) {
    await logActivity('note_updated', job.id, job.company, job.role, {
      preview: newNotes.substring(0, 50) + (newNotes.length > 50 ? '...' : '')
    }, job.status);
  }

  closeAllModals();
  await refreshUI();
}

async function handleSaveSettings(e) {
  e.preventDefault();
  
  settings.followUpDays = parseInt(document.getElementById('settings-follow-up-days').value) || 2;
  trackerData.settings = settings;
  
  await storage.save(trackerData);
  
  closeAllModals();
  await refreshUI();
}

// ============================================
// INTERVIEW FUNCTIONS
// ============================================

function renderInterviewsList(interviews) {
  const container = document.getElementById('interviews-list');
  
  if (interviews.length === 0) {
    container.innerHTML = '<p style="color: var(--text-tertiary); font-size: var(--text-sm);">No interviews scheduled</p>';
    return;
  }
  
  container.innerHTML = interviews.map((interview, index) => {
    const date = new Date(interview.date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    
    return `
      <div class="interview-item">
        <div class="interview-info">
          <div class="interview-date">${date}</div>
          <div class="interview-type">${escapeHtml(interview.type)}</div>
          ${interview.notes ? `<div class="interview-notes">${escapeHtml(interview.notes)}</div>` : ''}
        </div>
        <button type="button" class="btn btn-sm btn-ghost" onclick="removeInterview(${index})">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4l8 8M12 4l-8 8"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

function handleAddInterview() {
  const job = trackerData.jobs.find(j => j.id === currentDetailJobId);
  if (!job) return;

  // Open interview modal
  openInterviewModal();
}

function openInterviewModal() {
  const overlay = document.getElementById('interview-modal-overlay');
  const form = document.getElementById('interview-form');

  // Reset form
  form.reset();
  document.getElementById('interview-type-custom-group').style.display = 'none';

  // Set default date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('interview-date').value = tomorrow.toISOString().split('T')[0];

  // Set default time to 10:00 AM
  document.getElementById('interview-time').value = '10:00';

  overlay.classList.remove('hidden');
}

function closeInterviewModal() {
  const overlay = document.getElementById('interview-modal-overlay');
  overlay.classList.add('hidden');
}

function handleInterviewFormSubmit(e) {
  e.preventDefault();

  const job = trackerData.jobs.find(j => j.id === currentDetailJobId);
  if (!job) return;

  // Get form values
  const dateStr = document.getElementById('interview-date').value;
  const timeStr = document.getElementById('interview-time').value;
  let type = document.getElementById('interview-type').value;
  const notes = document.getElementById('interview-notes').value;

  // Handle custom type
  if (type === 'Other') {
    const customType = document.getElementById('interview-type-custom').value.trim();
    if (customType) {
      type = customType;
    }
  }

  // Validate
  if (!dateStr || !timeStr || !type) {
    showError('Please fill in all required fields');
    return;
  }

  // Create date from date and time
  const dateTime = new Date(`${dateStr}T${timeStr}:00`);
  if (isNaN(dateTime.getTime())) {
    showError('Invalid date or time');
    return;
  }

  // Add interview
  if (!job.interviews) job.interviews = [];
  job.interviews.push({
    date: dateTime.toISOString(),
    type: type,
    notes: notes
  });

  // Sort by date
  job.interviews.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Re-render
  renderInterviewsList(job.interviews);

  // Close modal
  closeInterviewModal();

  console.log('[Tracker] Interview added:', { date: dateTime.toISOString(), type, notes });
}

function removeInterview(index) {
  const job = trackerData.jobs.find(j => j.id === currentDetailJobId);
  if (!job) return;
  
  if (confirm('Delete this interview?')) {
    job.interviews.splice(index, 1);
    renderInterviewsList(job.interviews);
  }
}

// ============================================
// STAGE PILL CLICK HANDLER
// ============================================

async function handleStagePillClick(jobId) {
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;
  
  const stages = ['recruiter_screen', 'hiring_manager', 'panel_onsite'];
  const currentIndex = stages.indexOf(job.interview_stage);
  const nextIndex = (currentIndex + 1) % stages.length;
  
  job.interview_stage = stages[nextIndex];
  job.updated_at = new Date().toISOString();
  
  await storage.save(trackerData);
  await refreshUI();
}

// ============================================
// CONTEXT MENU
// ============================================

function showCardContextMenu(event, jobId) {
  event.preventDefault();
  event.stopPropagation();
  
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;
  
  const menu = document.getElementById('context-menu');
  menu.innerHTML = '';
  
  // Mark as followed up
  if (needsFollowUp(job)) {
    const followUpBtn = document.createElement('button');
    followUpBtn.textContent = '✓ Mark as followed up';
    followUpBtn.onclick = async () => {
      job.lastActivityDate = new Date().toISOString().split('T')[0];
      job.updated_at = new Date().toISOString();
      job.notes = (job.notes || '') + `\n[${job.lastActivityDate}] Followed up`;
      await storage.save(trackerData);
      // Log activity
      await logActivity('field_updated', job.id, job.company, job.role, {
        field: 'followed_up',
        new_value: job.lastActivityDate
      }, job.status);
      await refreshUI();
      menu.classList.add('hidden');
    };
    menu.appendChild(followUpBtn);
  }

  // Delete
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'danger';
  deleteBtn.textContent = '🗑️ Delete';
  deleteBtn.onclick = async () => {
    if (confirm(`Delete application to ${job.company}?`)) {
      // Log before deleting
      await logActivity('deleted', job.id, job.company, job.role, {}, job.status);
      trackerData.jobs = trackerData.jobs.filter(j => j.id !== jobId);
      await storage.save(trackerData);
      await refreshUI();
    }
    menu.classList.add('hidden');
  };
  menu.appendChild(deleteBtn);
  
  // Position menu
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.classList.remove('hidden');
}

// ============================================
// DRAG AND DROP
// ============================================

function setupDragAndDrop() {
  const cards = document.querySelectorAll('.job-card');
  const columns = document.querySelectorAll('.column-cards');
  
  cards.forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });
  
  columns.forEach(column => {
    column.addEventListener('dragover', handleDragOver);
    column.addEventListener('drop', handleDrop);
    column.addEventListener('dragleave', handleDragLeave);
  });
}

function handleDragStart(e) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.target.dataset.jobId);
  e.target.classList.add('dragging');
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.column-cards').forEach(col => {
    col.classList.remove('drag-over');
  });
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
  return false;
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  const jobId = e.dataTransfer.getData('text/html');
  const newStatus = e.currentTarget.dataset.status;

  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return false;

  const oldStatus = job.status;

  // Skip if no change
  if (oldStatus === newStatus) {
    e.currentTarget.classList.remove('drag-over');
    return false;
  }

  job.status = newStatus;
  job.lastActivityDate = new Date().toISOString().split('T')[0];
  job.updated_at = new Date().toISOString();

  // Clear interview_stage if moving out of interviewing
  if (newStatus !== 'interviewing') {
    job.interview_stage = null;
  }

  await storage.save(trackerData);

  // Log activity
  await logActivity('status_change', job.id, job.company, job.role, {
    from: oldStatus,
    to: newStatus
  }, newStatus);
  await refreshUI();
  
  return false;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }).toUpperCase();
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffTime = now - date;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function showError(message) {
  alert(message);
}

// ============================================
// ACTIVITY LOGGING
// ============================================

/**
 * Log an activity event
 * @param {string} type - Event type: new_application, status_change, email_received, note_updated, field_updated, deleted
 * @param {string} appId - Application/job ID
 * @param {string} company - Company name (denormalized for display)
 * @param {string} role - Role name (denormalized for display)
 * @param {Object} data - Event-specific data
 * @param {string} [status] - Current status of the job (for coloring)
 */
async function logActivity(type, appId, company, role, data, status = 'applied') {
  const activity = {
    id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: new Date().toISOString(),
    type,
    app_id: appId,
    company,
    role,
    status,
    data
  };

  // Load current activities
  if (!trackerData.activities) {
    trackerData.activities = [];
  }

  // Add to beginning (newest first)
  trackerData.activities.unshift(activity);

  // Keep only last 500 activities to prevent unbounded growth
  if (trackerData.activities.length > 500) {
    trackerData.activities = trackerData.activities.slice(0, 500);
  }

  // Mark as unread
  hasUnreadActivity = true;
  updateActivityButtonIndicator();

  // Save
  await storage.save(trackerData);

  console.log('[Activity] Logged:', type, company, data);

  return activity;
}

/**
 * Get activities, optionally filtered by job ID
 * @param {string} [appId] - Optional job ID to filter by
 * @returns {Array} Activities sorted by timestamp (newest first)
 */
function getActivities(appId = null) {
  const activities = trackerData.activities || [];

  if (appId) {
    return activities.filter(a => a.app_id === appId);
  }

  return activities;
}

/**
 * Clear all activities
 */
async function clearAllActivities() {
  trackerData.activities = [];
  await storage.save(trackerData);
  console.log('[Activity] Cleared all activities');
}

/**
 * Group activities by date for display
 * @param {Array} activities
 * @returns {Object} Activities grouped by date label
 */
function groupActivitiesByDate(activities) {
  const groups = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());

  activities.forEach(activity => {
    const activityDate = new Date(activity.timestamp);
    const activityDay = new Date(activityDate.getFullYear(), activityDate.getMonth(), activityDate.getDate());

    let label;
    if (activityDay.getTime() === today.getTime()) {
      label = 'Today';
    } else if (activityDay.getTime() === yesterday.getTime()) {
      label = 'Yesterday';
    } else if (activityDay >= thisWeekStart) {
      label = 'This week';
    } else {
      label = activityDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(activity);
  });

  return groups;
}

/**
 * Format relative time
 * @param {string} timestamp
 * @returns {string}
 */
function formatRelativeTime(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Update the activity button indicator
 */
function updateActivityButtonIndicator() {
  const btn = document.getElementById('activity-btn');
  if (!btn) return;

  const indicator = btn.querySelector('.activity-unread-dot');
  if (hasUnreadActivity) {
    if (!indicator) {
      const dot = document.createElement('span');
      dot.className = 'activity-unread-dot';
      btn.appendChild(dot);
    }
  } else {
    if (indicator) {
      indicator.remove();
    }
  }
}

// ============================================
// SIDE PANEL
// ============================================

/**
 * Open the side panel
 * @param {string} type - 'activity' or 'job'
 * @param {Object} data - Job data (for job panel)
 * @param {string} [tab] - Tab to open to (for job panel)
 */
function openSidePanel(type, data = null, tab = 'details') {
  // If clicking same job card again, close panel (toggle behavior)
  if (type === 'job' && currentPanel === 'job' && currentJob && data && currentJob.id === data.id) {
    closeSidePanel();
    return;
  }

  // Save navigation history if switching from one panel to another
  if (currentPanel && (currentPanel !== type || (type === 'job' && currentJob?.id !== data?.id))) {
    navigationStack.push({ type: currentPanel, data: currentJob, tab: activeTab });
  }

  currentPanel = type;
  if (type === 'job') {
    currentJob = data;
    activeTab = tab;
  } else {
    currentJob = null;
    activeTab = 'details';
  }

  renderPanel();

  document.getElementById('panel-backdrop').classList.remove('hidden');
  document.getElementById('side-panel').classList.remove('hidden');
  document.getElementById('panel-back').classList.toggle('hidden', navigationStack.length === 0);

  // Mark activity as read when opening activity panel
  if (type === 'activity') {
    hasUnreadActivity = false;
    updateActivityButtonIndicator();
  }
}

/**
 * Close the side panel
 */
function closeSidePanel() {
  document.getElementById('panel-backdrop').classList.add('hidden');
  document.getElementById('side-panel').classList.add('hidden');
  currentPanel = null;
  currentJob = null;
  navigationStack = [];
}

/**
 * Navigate back in panel history
 */
function navigateBack() {
  if (navigationStack.length === 0) {
    closeSidePanel();
    return;
  }

  const prev = navigationStack.pop();
  currentPanel = prev.type;
  currentJob = prev.data;
  activeTab = prev.tab || 'details';

  renderPanel();
  document.getElementById('panel-back').classList.toggle('hidden', navigationStack.length === 0);
}

/**
 * Render the current panel
 */
function renderPanel() {
  if (currentPanel === 'activity') {
    renderActivityPanel();
  } else if (currentPanel === 'job') {
    renderJobPanel(currentJob, activeTab);
  }
}

/**
 * Render the global activity panel
 */
function renderActivityPanel() {
  const title = document.getElementById('panel-title');
  const subtitle = document.getElementById('panel-subtitle');
  const jobHeader = document.getElementById('panel-job-header');
  const tabs = document.getElementById('panel-tabs');
  const content = document.getElementById('panel-content');
  const footer = document.getElementById('panel-footer');

  // Setup header
  title.textContent = 'Activity';
  subtitle.textContent = 'Your job search timeline';

  // Hide job-specific elements
  jobHeader.classList.add('hidden');
  tabs.classList.add('hidden');

  // Get activities
  const activities = getActivities();

  if (activities.length === 0) {
    content.innerHTML = `
      <div class="panel-empty">
        <div class="panel-empty-icon">📭</div>
        <h3 class="panel-empty-title">No activity yet</h3>
        <p class="panel-empty-text">Your job search events will appear here</p>
      </div>
    `;
    footer.classList.add('hidden');
    return;
  }

  // Group by date
  const grouped = groupActivitiesByDate(activities);

  let html = '';
  for (const [label, items] of Object.entries(grouped)) {
    html += `
      <div class="activity-date-group">
        <div class="activity-date-label">${escapeHtml(label)}</div>
        ${items.map(activity => renderActivityItem(activity)).join('')}
      </div>
    `;
  }

  content.innerHTML = html;

  // Show footer with clear button
  footer.classList.remove('hidden');
  footer.innerHTML = `
    <button class="clear-activity-btn" onclick="handleClearAllActivity()">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"/>
      </svg>
      Clear all activity
    </button>
  `;
}

/**
 * Render a single activity item
 */
function renderActivityItem(activity) {
  const { icon, label, badgeClass } = getActivityEventDisplay(activity);

  return `
    <div class="activity-item status-${activity.status || 'applied'}" onclick="handleActivityClick('${activity.app_id}', '${activity.type}')">
      <div class="activity-item-header">
        <span class="activity-company">${escapeHtml(activity.company)}</span>
        <span class="activity-time">${formatRelativeTime(activity.timestamp)}</span>
      </div>
      <div class="activity-role">${escapeHtml(activity.role)}</div>
      <div class="activity-event">
        <span class="activity-event-badge ${badgeClass}">${icon} ${label}</span>
      </div>
      ${activity.data?.reason || activity.data?.preview ? `<div class="activity-detail">${escapeHtml(activity.data.reason || activity.data.preview || '')}</div>` : ''}
    </div>
  `;
}

/**
 * Get display info for an activity event
 */
function getActivityEventDisplay(activity) {
  const displays = {
    new_application: { icon: '✚', label: 'Applied', badgeClass: '' },
    status_change: { icon: '', label: '', badgeClass: '' },
    email_received: { icon: '📧', label: 'Email received', badgeClass: '' },
    note_updated: { icon: '📝', label: 'Note updated', badgeClass: '' },
    field_updated: { icon: '✏️', label: 'Updated', badgeClass: '' },
    deleted: { icon: '🗑️', label: 'Deleted', badgeClass: '' }
  };

  let display = displays[activity.type] || { icon: '•', label: activity.type, badgeClass: '' };

  // Special handling for status changes
  if (activity.type === 'status_change') {
    const toStatus = activity.data?.to || 'unknown';
    const statusDisplay = {
      applied: { icon: '🔵', label: 'Applied', badgeClass: '' },
      interviewing: { icon: '🟡', label: 'Interviewing', badgeClass: 'status-interviewing' },
      rejected: { icon: '🔴', label: 'Rejected', badgeClass: 'status-rejected' },
      offer: { icon: '🟢', label: 'Offer', badgeClass: 'status-offer' }
    };
    display = statusDisplay[toStatus] || { icon: '•', label: toStatus, badgeClass: '' };
  }

  return display;
}

/**
 * Handle click on activity item
 */
function handleActivityClick(appId, eventType) {
  const job = trackerData.jobs.find(j => j.id === appId);
  if (!job) {
    // Job was deleted
    return;
  }

  // Smart tab routing based on event type
  let tab = 'details';
  if (eventType === 'note_updated') {
    tab = 'notes';
  } else if (eventType === 'status_change' || eventType === 'email_received' || eventType === 'field_updated') {
    tab = 'details';
  }

  openSidePanel('job', job, tab);
}

/**
 * Handle clear all activity
 */
async function handleClearAllActivity() {
  if (!confirm('Clear all activity? This cannot be undone.')) {
    return;
  }

  await clearAllActivities();
  renderPanel();
}

/**
 * Render the job details panel
 */
function renderJobPanel(job, tab = 'details') {
  if (!job) return;

  const title = document.getElementById('panel-title');
  const subtitle = document.getElementById('panel-subtitle');
  const jobHeader = document.getElementById('panel-job-header');
  const tabs = document.getElementById('panel-tabs');
  const content = document.getElementById('panel-content');
  const footer = document.getElementById('panel-footer');

  // Setup header (hide main title, show job header)
  title.textContent = '';
  subtitle.textContent = '';

  // Show job header
  jobHeader.classList.remove('hidden');
  document.getElementById('panel-status-dot').className = `status-dot-large ${job.status}`;
  document.getElementById('panel-company').textContent = job.company;
  document.getElementById('panel-role').textContent = job.role;

  // Format date
  const daysSince = Math.floor((new Date() - new Date(job.dateApplied)) / (1000 * 60 * 60 * 24));
  const dateText = daysSince === 0 ? 'Applied today' : daysSince === 1 ? 'Applied yesterday' : `Applied ${daysSince} days ago`;
  document.getElementById('panel-date').textContent = dateText;

  // Show tabs
  tabs.classList.remove('hidden');

  // Update active tab
  document.querySelectorAll('.panel-tab').forEach(tabBtn => {
    tabBtn.classList.toggle('active', tabBtn.dataset.tab === tab);
  });

  // Render tab content
  if (tab === 'details') {
    renderJobDetailsTab(job, content);
    renderJobDetailsFooter(job, footer);
  } else if (tab === 'activity') {
    renderJobActivityTab(job, content);
    footer.classList.add('hidden');
  } else if (tab === 'notes') {
    renderJobNotesTab(job, content);
    footer.classList.add('hidden');
  }

  activeTab = tab;
}

/**
 * Render the Details tab content
 */
function renderJobDetailsTab(job, content) {
  const salaryText = formatSalaryRange(job.salaryMin, job.salaryMax);

  content.innerHTML = `
    <div class="detail-section">
      <div class="detail-field">
        <label class="detail-field-label">Status</label>
        <select class="input" id="panel-status" onchange="handlePanelStatusChange('${job.id}', this.value)">
          <option value="applied" ${job.status === 'applied' ? 'selected' : ''}>Applied</option>
          <option value="interviewing" ${job.status === 'interviewing' ? 'selected' : ''}>Interviewing</option>
          <option value="rejected" ${job.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          <option value="offer" ${job.status === 'offer' ? 'selected' : ''}>Offer</option>
        </select>
      </div>

      ${job.jobUrl ? `
      <div class="detail-field">
        <label class="detail-field-label">Job posting</label>
        <a href="${escapeHtml(job.jobUrl)}" target="_blank" class="detail-field-link">
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(truncateUrl(job.jobUrl))}</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 10l8-8M14 6V2h-4M14 2L8 8"/>
          </svg>
        </a>
      </div>
      ` : ''}

      <div class="detail-field">
        <label class="detail-field-label">Salary range</label>
        <input type="text" class="input" id="panel-salary" value="${salaryText}" placeholder="e.g., $150k - $180k" onblur="handlePanelSalaryChange('${job.id}', this.value)">
      </div>
    </div>

    ${(job.confirmation_email_url || job.rejection_email_url) ? `
    <div class="detail-divider"></div>
    <div class="detail-section">
      <div class="detail-section-title">📧 Related emails</div>
      <div class="email-links">
        ${job.confirmation_email_url ? `
        <a href="${escapeHtml(job.confirmation_email_url)}" target="_blank" class="email-link">
          <span>Confirmation email</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 10l8-8M14 6V2h-4M14 2L8 8"/>
          </svg>
        </a>
        ` : ''}
        ${job.rejection_email_url ? `
        <a href="${escapeHtml(job.rejection_email_url)}" target="_blank" class="email-link">
          <span>Rejection email</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 10l8-8M14 6V2h-4M14 2L8 8"/>
          </svg>
        </a>
        ` : ''}
      </div>
    </div>
    ` : ''}
  `;
}

/**
 * Render the Details tab footer
 */
function renderJobDetailsFooter(job, footer) {
  footer.classList.remove('hidden');
  footer.innerHTML = `
    <button class="btn btn-secondary" onclick="handlePanelDelete('${job.id}')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"/>
      </svg>
      Delete
    </button>
    <button class="btn btn-primary" onclick="openDetailModal('${job.id}'); closeSidePanel();">
      Edit all fields
    </button>
  `;
}

/**
 * Render the Activity tab content (job-specific)
 */
function renderJobActivityTab(job, content) {
  const activities = getActivities(job.id);

  if (activities.length === 0) {
    content.innerHTML = `
      <div class="panel-empty">
        <div class="panel-empty-icon">📋</div>
        <h3 class="panel-empty-title">No activity</h3>
        <p class="panel-empty-text">Events for this job will appear here</p>
      </div>
    `;
    return;
  }

  let html = activities.map(activity => {
    const { icon, label } = getActivityEventDisplay(activity);
    return `
      <div class="job-activity-item">
        <div class="job-activity-event">${icon} ${label}</div>
        ${activity.data?.reason || activity.data?.preview || activity.data?.from ? `
          <div class="job-activity-detail">${escapeHtml(activity.data.reason || activity.data.preview || (activity.data.from ? `from ${activity.data.from}` : ''))}</div>
        ` : ''}
        <div class="job-activity-time">${formatRelativeTime(activity.timestamp)}</div>
      </div>
    `;
  }).join('');

  html += `<div class="activity-timeline-end">End of history</div>`;

  content.innerHTML = html;
}

/**
 * Render the Notes tab content
 */
function renderJobNotesTab(job, content) {
  content.innerHTML = `
    <textarea class="notes-textarea" id="panel-notes" placeholder="Add notes about this application..."
      onblur="handlePanelNotesChange('${job.id}')"
      oninput="debouncedNotesAutoSave('${job.id}')">${escapeHtml(job.notes || '')}</textarea>
    <div class="notes-footer">
      <span class="notes-saved" id="notes-saved-indicator">✓ Saved</span>
      <span id="notes-char-count">${(job.notes || '').length} chars</span>
    </div>
  `;
}

// Debounced notes auto-save
let notesAutoSaveTimeout = null;
function debouncedNotesAutoSave(jobId) {
  const textarea = document.getElementById('panel-notes');
  const charCount = document.getElementById('notes-char-count');

  if (charCount && textarea) {
    charCount.textContent = `${textarea.value.length} chars`;
  }

  if (notesAutoSaveTimeout) {
    clearTimeout(notesAutoSaveTimeout);
  }

  notesAutoSaveTimeout = setTimeout(() => {
    handlePanelNotesChange(jobId, true);
  }, 1000);
}

/**
 * Handle status change in panel
 */
async function handlePanelStatusChange(jobId, newStatus) {
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;

  const oldStatus = job.status;
  if (oldStatus === newStatus) return;

  job.status = newStatus;
  job.lastActivityDate = new Date().toISOString().split('T')[0];
  job.updated_at = new Date().toISOString();

  // Clear interview_stage if moving out of interviewing
  if (newStatus !== 'interviewing') {
    job.interview_stage = null;
  }

  await storage.save(trackerData);

  // Log activity
  await logActivity('status_change', job.id, job.company, job.role, {
    from: oldStatus,
    to: newStatus
  }, newStatus);

  // Update panel header
  document.getElementById('panel-status-dot').className = `status-dot-large ${newStatus}`;

  // Refresh kanban
  await refreshUI();
}

/**
 * Handle salary change in panel
 */
async function handlePanelSalaryChange(jobId, salaryText) {
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;

  // Parse salary text (e.g., "$150k - $180k" or "150000 - 180000")
  const { min, max } = parseSalaryRange(salaryText);

  if (job.salaryMin === min && job.salaryMax === max) return;

  const oldSalary = formatSalaryRange(job.salaryMin, job.salaryMax);
  job.salaryMin = min;
  job.salaryMax = max;
  job.updated_at = new Date().toISOString();

  await storage.save(trackerData);

  // Log activity
  await logActivity('field_updated', job.id, job.company, job.role, {
    field: 'salary',
    old_value: oldSalary,
    new_value: formatSalaryRange(min, max)
  }, job.status);

  await refreshUI();
}

/**
 * Handle notes change in panel
 */
async function handlePanelNotesChange(jobId, isAutoSave = false) {
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;

  const textarea = document.getElementById('panel-notes');
  if (!textarea) return;

  const newNotes = textarea.value;
  if (job.notes === newNotes) return;

  const oldNotes = job.notes || '';
  job.notes = newNotes;
  job.updated_at = new Date().toISOString();

  await storage.save(trackerData);

  // Show saved indicator
  const savedIndicator = document.getElementById('notes-saved-indicator');
  if (savedIndicator) {
    savedIndicator.classList.add('visible');
    setTimeout(() => savedIndicator.classList.remove('visible'), 2000);
  }

  // Only log activity if significantly changed and not auto-save
  if (!isAutoSave && Math.abs(newNotes.length - oldNotes.length) > 10) {
    await logActivity('note_updated', job.id, job.company, job.role, {
      preview: newNotes.substring(0, 50) + (newNotes.length > 50 ? '...' : '')
    }, job.status);
  }
}

/**
 * Handle delete from panel
 */
async function handlePanelDelete(jobId) {
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;

  if (!confirm(`Delete application to ${job.company}?`)) return;

  // Log before deleting
  await logActivity('deleted', job.id, job.company, job.role, {}, job.status);

  trackerData.jobs = trackerData.jobs.filter(j => j.id !== jobId);
  await storage.save(trackerData);

  closeSidePanel();
  await refreshUI();
}

/**
 * Switch tab in job panel
 */
function switchPanelTab(tab) {
  if (!currentJob) return;
  activeTab = tab;
  renderJobPanel(currentJob, tab);
}

// ============================================
// UTILITY FUNCTIONS (Panel)
// ============================================

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.substring(0, 30) + '...' : u.pathname;
    return u.hostname + path;
  } catch {
    return url.substring(0, 50) + '...';
  }
}

function formatSalaryRange(min, max) {
  if (!min && !max) return '';
  if (min && max) {
    return `$${Math.round(min/1000)}k - $${Math.round(max/1000)}k`;
  } else if (min) {
    return `$${Math.round(min/1000)}k+`;
  } else {
    return `Up to $${Math.round(max/1000)}k`;
  }
}

function parseSalaryRange(text) {
  if (!text || !text.trim()) return { min: null, max: null };

  // Remove $ and k, convert to numbers
  const cleaned = text.replace(/[$,k]/gi, '').trim();
  const parts = cleaned.split(/[-–—]/);

  const parseNum = (s) => {
    const n = parseInt(s.trim(), 10);
    if (isNaN(n)) return null;
    // If less than 1000, assume it's in thousands
    return n < 1000 ? n * 1000 : n;
  };

  if (parts.length >= 2) {
    return {
      min: parseNum(parts[0]),
      max: parseNum(parts[1])
    };
  } else if (parts.length === 1) {
    const num = parseNum(parts[0]);
    // If single number, put in both
    return { min: num, max: num };
  }

  return { min: null, max: null };
}

/**
 * Open job panel from card click
 */
function openJobPanel(jobId) {
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;
  openSidePanel('job', job, 'details');
}

// ============================================
// BATCH APPLY PANEL
// ============================================

// Batch panel state
let batchPanelState = 'closed'; // 'closed' | 'setup' | 'scraping' | 'active' | 'complete' | 'stopped'
let batchSession = null;
let batchPollInterval = null;
let batchConfig = {
  targetCount: 5,
  criteria: {},
  resumeName: 'resume_optimized.txt'
};

/**
 * Initialize batch panel
 */
function initBatchPanel() {
  // Batch apply button opens panel
  const batchBtn = document.getElementById('batch-apply-btn');
  if (batchBtn) {
    batchBtn.removeEventListener('click', openBatchApplyModal);
    batchBtn.addEventListener('click', openBatchPanel);
  }

  // Header bar click to resume
  const headerBar = document.getElementById('batch-header-bar');
  if (headerBar) {
    headerBar.addEventListener('click', () => {
      openBatchPanel('active');
    });
  }

  // Check for existing session on load
  if (trackerData.settings?.batch_session) {
    batchSession = trackerData.settings.batch_session;
    if (batchSession.status === 'active' || batchSession.status === 'scraping') {
      // Show header bar if panel is closed
      updateBatchHeaderBar();
      startBatchPolling();
    }
  }
}

/**
 * Open the batch panel
 */
function openBatchPanel(state = 'setup') {
  batchPanelState = state;

  // Hide main panel content
  document.getElementById('panel-content').classList.add('hidden');
  document.getElementById('panel-job-header').classList.add('hidden');
  document.getElementById('panel-tabs').classList.add('hidden');
  document.getElementById('panel-footer').classList.add('hidden');

  // Show batch panel content
  document.getElementById('batch-panel-content').classList.remove('hidden');

  // Set panel header
  const title = document.getElementById('panel-title');
  const subtitle = document.getElementById('panel-subtitle');
  title.textContent = 'Apply to jobs';
  subtitle.textContent = '';

  // Hide back button for batch
  document.getElementById('panel-back').classList.add('hidden');

  // Show panel
  document.getElementById('panel-backdrop').classList.remove('hidden');
  document.getElementById('side-panel').classList.remove('hidden');

  // Hide header bar when panel is open
  document.getElementById('batch-header-bar').classList.add('hidden');

  // Render current state
  renderBatchPanel();

  // Clear navigation stack
  navigationStack = [];
  currentPanel = 'batch';
}

/**
 * Close batch panel
 */
function closeBatchPanel() {
  // Close the side panel
  closeSidePanel();

  // Reset to show main content
  document.getElementById('panel-content').classList.remove('hidden');
  document.getElementById('batch-panel-content').classList.add('hidden');

  // If batch is active, show header bar
  if (batchSession && (batchSession.status === 'active' || batchSession.status === 'scraping')) {
    updateBatchHeaderBar();
    document.getElementById('batch-header-bar').classList.remove('hidden');
  }

  currentPanel = null;
}

/**
 * Render the batch panel based on current state
 */
function renderBatchPanel() {
  const container = document.getElementById('batch-panel-content');

  // Determine state from session
  if (batchSession) {
    batchPanelState = batchSession.status;
  }

  switch (batchPanelState) {
    case 'setup':
      renderBatchSetup(container);
      break;
    case 'scraping':
      renderBatchScraping(container);
      break;
    case 'active':
      renderBatchActive(container);
      break;
    case 'complete':
    case 'stopped':
      renderBatchComplete(container);
      break;
    default:
      renderBatchSetup(container);
  }
}

/**
 * Render SETUP state
 */
function renderBatchSetup(container) {
  // Load criteria from settings or applicant config
  const criteria = trackerData.settings?.applicant || {};
  const savedCriteria = trackerData.settings?.batchCriteria || {};

  // Use saved criteria or defaults
  const roles = savedCriteria.roles || (criteria.target_roles || ['Product Manager']).join(', ');
  const location = savedCriteria.location || criteria.location_preference || 'Remote';
  const workType = savedCriteria.workType || 'remote';
  const salary = savedCriteria.salary || Math.round((criteria.salary_minimum || 150000) / 1000);
  const industries = savedCriteria.industries || (criteria.industries || ['Tech']).join(', ');

  container.innerHTML = `
    <div class="batch-setup">
      <div class="batch-section">
        <div class="batch-section-header">
          <span class="batch-section-icon">🔍</span>
          <span class="batch-section-title">Job discovery</span>
        </div>
        <div class="batch-info-card">
          <p style="color: var(--text-secondary); font-size: var(--text-sm); margin: 0;">
            Peebo will search for jobs matching your criteria on LinkedIn, Indeed, and company career pages.
          </p>
        </div>
      </div>

      <div class="batch-section">
        <div class="batch-section-header">
          <span class="batch-section-icon">📋</span>
          <span class="batch-section-title">Your criteria</span>
        </div>
        <div class="batch-criteria-form">
          <div class="batch-criteria-row">
            <label class="batch-criteria-label">Roles</label>
            <input type="text" class="batch-criteria-input" id="batch-roles"
              value="${escapeHtml(roles)}" placeholder="e.g., Product Manager, Sr PM">
          </div>
          <div class="batch-criteria-row">
            <label class="batch-criteria-label">Location</label>
            <input type="text" class="batch-criteria-input" id="batch-location"
              value="${escapeHtml(location)}" placeholder="e.g., San Francisco, NYC, Remote">
          </div>
          <div class="batch-criteria-row">
            <label class="batch-criteria-label">Work type</label>
            <select class="batch-criteria-input" id="batch-work-type">
              <option value="remote" ${workType === 'remote' ? 'selected' : ''}>Remote</option>
              <option value="hybrid" ${workType === 'hybrid' ? 'selected' : ''}>Hybrid</option>
              <option value="onsite" ${workType === 'onsite' ? 'selected' : ''}>On-site</option>
              <option value="any" ${workType === 'any' ? 'selected' : ''}>Any</option>
            </select>
          </div>
          <div class="batch-criteria-row">
            <label class="batch-criteria-label">Min salary</label>
            <div class="batch-salary-input">
              <span class="batch-salary-prefix">$</span>
              <input type="number" class="batch-criteria-input" id="batch-salary"
                value="${salary}" placeholder="150" min="0" step="10">
              <span class="batch-salary-suffix">k+</span>
            </div>
          </div>
          <div class="batch-criteria-row">
            <label class="batch-criteria-label">Industries</label>
            <input type="text" class="batch-criteria-input" id="batch-industries"
              value="${escapeHtml(industries)}" placeholder="e.g., Tech, Software, Fintech">
          </div>
        </div>
      </div>

      <div class="batch-section">
        <div class="batch-section-header">
          <span class="batch-section-icon">📄</span>
          <span class="batch-section-title">Resume</span>
        </div>
        <div class="batch-info-card">
          <div class="batch-info-row">
            <span class="batch-info-value">${batchConfig.resumeName}</span>
            <span class="batch-info-label">Last updated: Today</span>
          </div>
        </div>
      </div>

      <div class="batch-section">
        <div class="batch-section-header">
          <span class="batch-section-icon">🎯</span>
          <span class="batch-section-title">Number of applications</span>
        </div>
        <div class="batch-count-selector">
          <input type="number" class="batch-count-input" id="batch-count-input"
            min="1" max="20" value="${batchConfig.targetCount}">
          <span class="batch-estimate" id="batch-estimate">
            ~${estimateBatchTime(batchConfig.targetCount)} minutes total
          </span>
        </div>
      </div>
    </div>

    <div class="batch-setup-footer">
      <button class="batch-start-btn" id="batch-start-btn">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 3l10 6-10 6V3z"/>
        </svg>
        Start applying
      </button>
    </div>
  `;

  // Add event listeners
  document.getElementById('batch-count-input').addEventListener('input', (e) => {
    let value = parseInt(e.target.value) || 5;
    value = Math.max(1, Math.min(20, value));
    batchConfig.targetCount = value;
    document.getElementById('batch-estimate').textContent =
      `~${estimateBatchTime(value)} minutes total`;
  });

  // Save criteria on change
  const saveCriteria = async () => {
    const criteria = {
      roles: document.getElementById('batch-roles').value.trim(),
      location: document.getElementById('batch-location').value.trim(),
      workType: document.getElementById('batch-work-type').value,
      salary: parseInt(document.getElementById('batch-salary').value) || 150,
      industries: document.getElementById('batch-industries').value.trim()
    };
    trackerData.settings.batchCriteria = criteria;
    await storage.save(trackerData);
  };

  ['batch-roles', 'batch-location', 'batch-work-type', 'batch-salary', 'batch-industries'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveCriteria);
  });

  document.getElementById('batch-start-btn').addEventListener('click', startBatch);
}

/**
 * Render SCRAPING state
 */
function renderBatchScraping(container) {
  container.innerHTML = `
    <div class="batch-scraping">
      <img src="/assets/mascot/peebo-idle.svg" alt="Peebo" class="batch-scraping-mascot">
      <h3 class="batch-scraping-title">Finding jobs for you...</h3>
      <p class="batch-scraping-subtitle">Searching LinkedIn, Indeed, and career pages</p>
      <div class="batch-scraping-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
}

/**
 * Render ACTIVE state
 */
function renderBatchActive(container) {
  if (!batchSession) {
    renderBatchSetup(container);
    return;
  }

  const jobs = batchSession.jobs || [];
  const summary = {
    total: jobs.length,
    completed: jobs.filter(j => j.status === 'success').length,
    failed: jobs.filter(j => j.status === 'failed').length,
    running: jobs.filter(j => j.status === 'running').length,
    queued: jobs.filter(j => j.status === 'queued').length
  };

  const progress = summary.total > 0
    ? Math.round(((summary.completed + summary.failed) / summary.total) * 100)
    : 0;

  const remaining = summary.queued + summary.running;
  const timeLeft = estimateBatchTime(remaining);

  container.innerHTML = `
    <div class="batch-active">
      <div class="batch-job-list">
        ${jobs.map(job => renderBatchJobCard(job)).join('')}
      </div>

      <div class="batch-progress-footer">
        <div class="batch-progress-bar-container">
          <div class="batch-progress-bar">
            <div class="batch-progress-fill" style="width: ${progress}%"></div>
          </div>
          <span class="batch-progress-stats">${progress}% • ~${timeLeft} min left</span>
        </div>

        <div class="batch-summary-row">
          <span>✓ ${summary.completed} applied${summary.failed > 0 ? ` • ✗ ${summary.failed} failed` : ''}</span>
          <span class="batch-cost">$${(batchSession.total_cost || 0).toFixed(2)}</span>
        </div>

        <button class="batch-stop-all-btn" id="batch-stop-all-btn">
          Stop all
        </button>
      </div>
    </div>
  `;

  // Add event listeners
  document.getElementById('batch-stop-all-btn')?.addEventListener('click', stopAllJobs);

  // Add job action listeners
  jobs.forEach(job => {
    const viewBtn = document.getElementById(`batch-view-${job.id}`);
    const stopBtn = document.getElementById(`batch-stop-${job.id}`);
    const retryBtn = document.getElementById(`batch-retry-${job.id}`);

    if (viewBtn && job.live_url) {
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(job.live_url, '_blank');
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        stopBatchJob(job.id);
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        retryBatchJob(job.id);
      });
    }
  });
}

/**
 * Render a single batch job card
 */
function renderBatchJobCard(job) {
  let statusIcon = '';
  let statusClass = job.status;

  switch (job.status) {
    case 'running':
      statusIcon = '<span class="batch-job-status-icon spinner"></span>';
      break;
    case 'success':
      statusIcon = job.email_verified ? '✓✓' : '✓';
      if (job.email_verified) statusClass += ' verified';
      break;
    case 'failed':
      statusIcon = '✗';
      break;
    case 'stopped':
      statusIcon = '⏹';
      break;
    case 'queued':
    default:
      statusIcon = '○';
  }

  const actions = [];
  if (job.status === 'running' && job.live_url) {
    actions.push(`<button class="batch-job-btn" id="batch-view-${job.id}">View</button>`);
  }
  if (job.status === 'running' || job.status === 'queued') {
    actions.push(`<button class="batch-job-btn danger" id="batch-stop-${job.id}">Stop</button>`);
  }
  if (job.status === 'failed') {
    actions.push(`<button class="batch-job-btn" id="batch-retry-${job.id}">Retry</button>`);
  }

  return `
    <div class="batch-job-card ${statusClass}">
      <div class="batch-job-header">
        <div class="batch-job-info">
          <h4 class="batch-job-company">
            ${statusIcon}
            ${escapeHtml(job.company)}
          </h4>
          <p class="batch-job-role">${escapeHtml(job.role)}</p>
          ${job.status === 'running' && job.current_step ? `
            <p class="batch-job-step">${escapeHtml(job.current_step)}</p>
          ` : ''}
        </div>
        ${actions.length > 0 ? `
          <div class="batch-job-actions">
            ${actions.join('')}
          </div>
        ` : ''}
      </div>
      ${job.status === 'failed' && job.error_message ? `
        <div class="batch-job-error">${escapeHtml(job.error_message)}</div>
      ` : ''}
    </div>
  `;
}

/**
 * Render COMPLETE state
 */
function renderBatchComplete(container) {
  if (!batchSession) {
    renderBatchSetup(container);
    return;
  }

  const jobs = batchSession.jobs || [];
  const completed = jobs.filter(j => j.status === 'success').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  const cost = (batchSession.total_cost || 0).toFixed(2);

  const isStopped = batchSession.status === 'stopped';
  const title = isStopped ? 'Batch stopped' : 'All done!';
  const subtitle = isStopped
    ? `Applied to ${completed} job${completed !== 1 ? 's' : ''} before stopping`
    : `Applied to ${completed} job${completed !== 1 ? 's' : ''} successfully`;

  container.innerHTML = `
    <div class="batch-complete">
      <img src="/assets/mascot/peebo-idle.svg" alt="Peebo" class="batch-complete-mascot">
      <h2 class="batch-complete-title">${title}</h2>
      <p class="batch-complete-subtitle">${subtitle}</p>

      <div class="batch-complete-stats">
        <div class="batch-stat">
          <div class="batch-stat-value success">${completed}</div>
          <div class="batch-stat-label">Applied</div>
        </div>
        <div class="batch-stat">
          <div class="batch-stat-value failed">${failed}</div>
          <div class="batch-stat-label">Failed</div>
        </div>
        <div class="batch-stat">
          <div class="batch-stat-value cost">$${cost}</div>
          <div class="batch-stat-label">Cost</div>
        </div>
      </div>

      <div class="batch-complete-actions">
        <button class="batch-view-jobs-btn" id="batch-view-jobs-btn">
          View in tracker
        </button>
        <button class="batch-new-batch-btn" id="batch-new-batch-btn">
          Apply to more jobs
        </button>
      </div>
    </div>
  `;

  // Add event listeners
  document.getElementById('batch-view-jobs-btn')?.addEventListener('click', () => {
    closeBatchPanel();
    // Jobs are already in the tracker
  });

  document.getElementById('batch-new-batch-btn')?.addEventListener('click', () => {
    batchSession = null;
    trackerData.settings.batch_session = null;
    storage.save(trackerData);
    batchPanelState = 'setup';
    renderBatchPanel();
  });
}

/**
 * Start a batch session
 */
async function startBatch() {
  const btn = document.getElementById('batch-start-btn');
  btn.disabled = true;
  btn.innerHTML = `
    <span class="batch-job-status-icon spinner"></span>
    Starting...
  `;

  try {
    const criteria = trackerData.settings?.applicant || {};

    // Get Supabase auth token
    const authToken = await getSupabaseAuthToken();
    if (!authToken) {
      throw new Error('Not authenticated. Please sign in to Peebo first.');
    }

    // Call REAL Edge Function
    const response = await fetch('https://diplqphbqlomcvlujcxd.supabase.co/functions/v1/peebo-batch/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        target_count: batchConfig.targetCount,
        criteria: {
          target_roles: batchConfig.targetRoles || criteria.target_roles || [],
          location: batchConfig.location || criteria.location_preference || 'Remote',
          salary_min: batchConfig.salaryMin || criteria.salary_minimum || null,
          industries: batchConfig.industries || criteria.industries || []
        },
        resume_text: criteria.resume_text || '',
        user_info: {
          name: criteria.name || '',
          email: criteria.email || '',
          phone: criteria.phone || '',
          linkedin: criteria.linkedin_url || ''
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start batch');
    }

    const result = await response.json();

    // Store session ID for polling
    batchSession = {
      id: result.session_id,
      status: 'scraping',
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      config: {
        target_count: batchConfig.targetCount,
        criteria_summary: formatBatchCriteria(criteria),
        resume_name: batchConfig.resumeName
      },
      jobs: [],
      total_cost: 0,
      completed_count: 0,
      failed_count: 0
    };

    // Save session to storage
    trackerData.settings.batch_session = batchSession;
    await storage.save(trackerData);

    // Update UI to scraping state
    batchPanelState = 'scraping';
    renderBatchPanel();

    // Start REAL polling
    startBatchPolling();

  } catch (error) {
    console.error('[Batch] Start error:', error);
    showError(`Failed to start batch: ${error.message}`);
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 3l10 6-10 6V3z"/>
      </svg>
      Start applying
    `;
  }
}

/**
 * Get Supabase auth token from chrome.storage or Flask session
 */
async function getSupabaseAuthToken() {
  // Try chrome.storage first (extension context)
  if (typeof chrome !== 'undefined' && chrome.storage) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['supabase_auth'], (result) => {
        resolve(result.supabase_auth?.access_token || '');
      });
    });
  }

  // Fall back to Flask session (localhost context)
  try {
    const response = await fetch('/api/auth_token');
    const data = await response.json();
    return data.token || '';
  } catch {
    return '';
  }
}

/**
 * Add a successful batch job to the tracker's jobs list
 */
async function addBatchJobToTracker(batchJob) {
  if (!batchJob.agent_success) return;

  // Check if job already exists
  const existingJob = trackerData.jobs.find(j =>
    j.jobUrl === batchJob.job_url ||
    (j.company === batchJob.company && j.role === batchJob.role)
  );

  if (existingJob) {
    // Update existing job
    existingJob.status = 'applied';
    existingJob.lastActivityDate = new Date().toISOString().split('T')[0];
    existingJob.notes = (existingJob.notes || '') + `\n[Batch] Applied via Peebo on ${new Date().toLocaleDateString()}`;
  } else {
    // Create new job entry
    const newJob = {
      id: generateUUID(),
      company: batchJob.company,
      role: batchJob.role,
      status: 'applied',
      dateApplied: new Date().toISOString().split('T')[0],
      lastActivityDate: new Date().toISOString().split('T')[0],
      jobUrl: batchJob.job_url,
      nextAction: 'Wait for response',
      notes: `Applied via Peebo batch apply. Cost: $${batchJob.cost?.toFixed(4) || '0.00'}`,
      emailVerified: batchJob.email_verified || false
    };
    trackerData.jobs.push(newJob);
  }

  await storage.save(trackerData);
}

/**
 * Check AgentMail for confirmation emails
 */
async function checkAgentMailVerification() {
  try {
    // Trigger AgentMail sync via Flask endpoint
    const response = await fetch('/api/trigger_email_sync', { method: 'POST' });
    if (response.ok) {
      // Reload data to get email_verified updates
      await refreshUI();
    }
  } catch (error) {
    console.error('[Batch] AgentMail sync error:', error);
  }
}

/**
 * Stop all batch jobs
 */
async function stopAllJobs() {
  if (!batchSession?.id) return;
  if (!confirm('Stop all remaining applications?')) return;

  try {
    const authToken = await getSupabaseAuthToken();

    const response = await fetch(
      `https://diplqphbqlomcvlujcxd.supabase.co/functions/v1/peebo-batch/${batchSession.id}/stop`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to stop batch');
    }

    // Update local state
    batchSession.jobs.forEach(job => {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'stopped';
      }
    });

    batchSession.status = 'stopped';
    batchSession.completed_at = new Date().toISOString();
    batchSession.completed_count = batchSession.jobs.filter(j => j.status === 'success').length;
    batchSession.failed_count = batchSession.jobs.filter(j => j.status === 'failed').length;

    trackerData.settings.batch_session = batchSession;
    await storage.save(trackerData);

    stopBatchPolling();
    updateBatchHeaderBar();

    batchPanelState = 'stopped';
    renderBatchPanel();

  } catch (error) {
    console.error('[Batch] Stop error:', error);
    showError('Failed to stop batch. Please try again.');
  }
}

/**
 * Stop a specific batch job
 */
async function stopBatchJob(jobId) {
  if (!batchSession?.id) return;

  const job = batchSession.jobs.find(j => j.id === jobId);
  if (!job) return;

  if (job.status !== 'queued' && job.status !== 'running') return;

  try {
    const authToken = await getSupabaseAuthToken();

    const response = await fetch(
      `https://diplqphbqlomcvlujcxd.supabase.co/functions/v1/peebo-batch/${batchSession.id}/job/${jobId}/stop`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to stop job');
    }

    // Update local state
    job.status = 'stopped';
    trackerData.settings.batch_session = batchSession;
    await storage.save(trackerData);
    renderBatchPanel();

  } catch (error) {
    console.error('[Batch] Stop job error:', error);
    showError('Failed to stop job. Please try again.');
  }
}

/**
 * Retry a failed batch job
 */
async function retryBatchJob(jobId) {
  if (!batchSession?.id) return;

  const job = batchSession.jobs.find(j => j.id === jobId);
  if (!job || job.status !== 'failed') return;

  try {
    const authToken = await getSupabaseAuthToken();

    const response = await fetch(
      `https://diplqphbqlomcvlujcxd.supabase.co/functions/v1/peebo-batch/${batchSession.id}/job/${jobId}/retry`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to retry job');
    }

    // Update local state
    job.status = 'queued';
    job.error_message = null;
    job.started_at = null;
    job.completed_at = null;

    // Reactivate batch if needed
    if (batchSession.status === 'complete' || batchSession.status === 'stopped') {
      batchSession.status = 'active';
      startBatchPolling();
    }

    trackerData.settings.batch_session = batchSession;
    await storage.save(trackerData);

    batchPanelState = 'active';
    renderBatchPanel();

  } catch (error) {
    console.error('[Batch] Retry error:', error);
    showError('Failed to retry job. Please try again.');
  }
}

/**
 * Start polling for batch status
 */
function startBatchPolling() {
  if (batchPollInterval) return;
  if (!batchSession?.id) return;

  batchPollInterval = setInterval(async () => {
    try {
      const authToken = await getSupabaseAuthToken();

      const response = await fetch(
        `https://diplqphbqlomcvlujcxd.supabase.co/functions/v1/peebo-batch/${batchSession.id}/status`,
        {
          headers: { 'Authorization': `Bearer ${authToken}` }
        }
      );

      if (!response.ok) {
        console.error('[Batch] Polling failed:', response.status);
        return;
      }

      const data = await response.json();

      // Update local session from server
      batchSession.status = data.status;
      batchSession.jobs = data.jobs || [];
      batchSession.total_cost = data.summary?.total_cost || 0;
      batchSession.completed_count = data.summary?.completed || 0;
      batchSession.failed_count = data.summary?.failed || 0;

      trackerData.settings.batch_session = batchSession;
      await storage.save(trackerData);

      // Update UI based on status
      if (data.status === 'active' && batchPanelState !== 'active') {
        batchPanelState = 'active';
      } else if (data.status === 'complete' || data.status === 'stopped') {
        batchPanelState = data.status;
        stopBatchPolling();

        // Add successful jobs to tracker
        for (const job of data.jobs || []) {
          if (job.agent_success) {
            await addBatchJobToTracker(job);
          }
        }

        // Check AgentMail for email verification
        await checkAgentMailVerification();
      }

      if (currentPanel === 'batch') {
        renderBatchPanel();
      }
      updateBatchHeaderBar();

    } catch (error) {
      console.error('[Batch] Polling error:', error);
    }
  }, 5000); // Poll every 5 seconds

  console.log('[Batch] Real polling started');
}

/**
 * Stop polling for batch status
 */
function stopBatchPolling() {
  if (batchPollInterval) {
    clearInterval(batchPollInterval);
    batchPollInterval = null;
    console.log('[Batch] Polling stopped');
  }
}

/**
 * Update the batch header bar
 */
function updateBatchHeaderBar() {
  const headerBar = document.getElementById('batch-header-bar');
  if (!headerBar) return;

  if (!batchSession || (batchSession.status !== 'active' && batchSession.status !== 'scraping')) {
    headerBar.classList.add('hidden');
    return;
  }

  // Don't show if panel is open
  if (currentPanel === 'batch') {
    headerBar.classList.add('hidden');
    return;
  }

  const jobs = batchSession.jobs || [];
  const completed = jobs.filter(j => j.status === 'success' || j.status === 'failed').length;
  const total = jobs.length;
  const remaining = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById('batch-header-text').textContent = `Applying: ${completed}/${total}`;
  document.getElementById('batch-header-fill').style.width = `${progress}%`;
  document.getElementById('batch-header-time').textContent = `~${estimateBatchTime(remaining)} min left`;

  headerBar.classList.remove('hidden');
}

/**
 * Format batch criteria for display
 */
function formatBatchCriteria(criteria) {
  const parts = [];
  if (criteria.target_roles?.length) {
    parts.push(`Roles: ${criteria.target_roles.join(', ')}`);
  }
  if (criteria.location_preference) {
    parts.push(`Location: ${criteria.location_preference}`);
  }
  if (criteria.salary_minimum) {
    parts.push(`Salary: $${Math.round(criteria.salary_minimum / 1000)}k+`);
  }
  return parts.join(' • ');
}

/**
 * Estimate batch time in minutes
 */
function estimateBatchTime(jobCount) {
  // ~2-5 minutes per job
  const minPerJob = 3;
  return Math.round(jobCount * minPerJob);
}

// Override panel close to handle batch panel
const originalCloseSidePanel = closeSidePanel;
closeSidePanel = function() {
  if (currentPanel === 'batch') {
    closeBatchPanel();
  } else {
    originalCloseSidePanel();
  }
};

// Initialize batch panel when ready
setTimeout(() => {
  initBatchPanel();
}, 100);
