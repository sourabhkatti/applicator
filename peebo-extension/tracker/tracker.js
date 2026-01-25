// Peebo Tracker Logic

// State
let applications = [];
let filteredApps = [];
let editingApp = null;
let deleteTargetId = null;
let draggedCard = null;

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
  setupEventListeners();
  setupDragAndDrop();
  checkUrlParams();
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

  const formattedDate = formatDate(app.applied_at);

  card.innerHTML = `
    <div class="app-card-header">
      <div>
        <h3 class="app-company">${escapeHtml(app.company)}</h3>
        <p class="app-role">${escapeHtml(app.role)}</p>
      </div>
      <div class="app-card-actions">
        ${app.job_url ? `
          <a href="${escapeHtml(app.job_url)}" target="_blank" class="btn btn-icon btn-ghost" title="Open job posting">
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

  return apps.filter(app =>
    app.company.toLowerCase().includes(query) ||
    app.role.toLowerCase().includes(query) ||
    (app.notes && app.notes.toLowerCase().includes(query))
  );
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
  document.getElementById('app-role').value = app.role;
  document.getElementById('app-url').value = app.job_url || '';
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

// Handle form submit
async function handleFormSubmit(e) {
  e.preventDefault();

  const formData = {
    company: document.getElementById('app-company').value.trim(),
    role: document.getElementById('app-role').value.trim(),
    job_url: document.getElementById('app-url').value.trim() || null,
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
