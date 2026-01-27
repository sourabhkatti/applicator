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
         onclick="openDetailModal('${job.id}')"
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
  
  closeAllModals();
  await refreshUI();
}

async function handleSaveDetail(e) {
  e.preventDefault();
  
  const jobId = document.getElementById('detail-id').value;
  const job = trackerData.jobs.find(j => j.id === jobId);
  if (!job) return;
  
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
  
  job.notes = document.getElementById('detail-notes').value.trim();
  job.companyResearch = document.getElementById('detail-company-research').value.trim() || null;
  
  job.updated_at = new Date().toISOString();
  
  await storage.save(trackerData);
  
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
  
  job.status = newStatus;
  job.lastActivityDate = new Date().toISOString().split('T')[0];
  job.updated_at = new Date().toISOString();
  
  // Clear interview_stage if moving out of interviewing
  if (newStatus !== 'interviewing') {
    job.interview_stage = null;
  }
  
  await storage.save(trackerData);
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
