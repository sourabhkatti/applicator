// Peebo Onboarding Logic

// Supabase configuration
const SUPABASE_URL = 'https://diplqphbqlomcvlujcxd.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // Replace with actual key

// State
let currentStep = 1;
let resumeData = null;
let extractedInfo = {};

// DOM Elements
const steps = document.querySelectorAll('.step');
const stepLines = document.querySelectorAll('.step-line');
const stepContents = {
  1: document.getElementById('step-1'),
  2: document.getElementById('step-2'),
  3: document.getElementById('step-3'),
  4: document.getElementById('step-4'),
  complete: document.getElementById('step-complete')
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkExistingSetup();
  setupEventListeners();
});

// Check if user already has setup
async function checkExistingSetup() {
  try {
    const result = await chrome.storage.local.get(['peeboUser', 'session']);

    if (result.peeboUser && result.peeboUser.full_name && result.peeboUser.resume_text) {
      // Already onboarded, check if settings tab requested
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'settings') {
        // Show settings view (step 3 and 4)
        populateFormFromUser(result.peeboUser);
        goToStep(3);
      } else {
        // Redirect to popup or tracker
        window.close();
      }
    }
  } catch (error) {
    console.error('Failed to check setup:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Step 1: Welcome
  document.getElementById('start-btn').addEventListener('click', () => goToStep(2));

  // Step 2: Resume
  setupResumeUpload();

  document.getElementById('linkedin-import-btn').addEventListener('click', handleLinkedInImport);
  document.getElementById('paste-resume-btn').addEventListener('click', showResumeTextModal);
  document.getElementById('cancel-paste').addEventListener('click', hideResumeTextModal);
  document.getElementById('save-paste').addEventListener('click', saveResumeText);
  document.getElementById('remove-resume').addEventListener('click', removeResume);
  document.getElementById('back-2').addEventListener('click', () => goToStep(1));
  document.getElementById('next-2').addEventListener('click', () => {
    if (resumeData) {
      extractInfoFromResume();
      goToStep(3);
    }
  });

  // Step 3: Details
  document.getElementById('back-3').addEventListener('click', () => goToStep(2));
  document.getElementById('next-3').addEventListener('click', () => {
    if (validateDetailsForm()) {
      goToStep(4);
    }
  });

  // Step 4: Preferences
  document.getElementById('back-4').addEventListener('click', () => goToStep(3));
  document.getElementById('finish-btn').addEventListener('click', handleFinish);

  // Complete
  document.getElementById('start-applying-btn').addEventListener('click', () => {
    window.close();
  });
  document.getElementById('view-tracker-btn').addEventListener('click', () => {
    chrome.tabs.update({ url: chrome.runtime.getURL('tracker/tracker.html') });
  });
}

// Setup resume upload
function setupResumeUpload() {
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('resume-file');

  // Click to upload
  uploadZone.addEventListener('click', () => fileInput.click());

  // File selected
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');

    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
}

// Handle file upload
async function handleFileUpload(file) {
  const validTypes = ['application/pdf', 'text/plain', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

  if (!validTypes.includes(file.type) && !file.name.match(/\.(pdf|txt|doc|docx)$/i)) {
    alert('Please upload a PDF, TXT, DOC, or DOCX file.');
    return;
  }

  showLoading('Processing resume...');

  try {
    let text;

    if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      text = await file.text();
    } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      text = await extractTextFromPDF(file);
    } else {
      // For DOC/DOCX, we'd need a library - for now just read as text
      text = await file.text();
    }

    resumeData = {
      filename: file.name,
      text: text,
      file: file
    };

    showResumePreview(file.name);
    document.getElementById('next-2').disabled = false;
  } catch (error) {
    console.error('Failed to process resume:', error);
    alert('Failed to process resume. Please try again or paste the text directly.');
  } finally {
    hideLoading();
  }
}

// Extract text from PDF (basic implementation)
async function extractTextFromPDF(file) {
  // In production, you'd use pdf.js or similar library
  // For now, we'll just store the file and prompt user to paste text
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Try to extract text using a simple approach
        // In production, use pdf.js: https://mozilla.github.io/pdf.js/
        const text = await extractPDFText(e.target.result);
        resolve(text);
      } catch (error) {
        // Fall back to asking user to paste
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Simple PDF text extraction (would need pdf.js in production)
async function extractPDFText(arrayBuffer) {
  // Placeholder - in production, use pdf.js
  // For now, return placeholder text that prompts user to verify
  return 'PDF content extracted. Please verify and edit your details on the next screen.';
}

// Handle LinkedIn import
async function handleLinkedInImport() {
  // Open LinkedIn in new tab for user to copy their profile
  const confirmed = confirm(
    'This will open LinkedIn where you can download your profile data.\n\n' +
    '1. Go to Settings > Data Privacy > Get a copy of your data\n' +
    '2. Download and extract the ZIP file\n' +
    '3. Upload the Profile.pdf file here\n\n' +
    'Open LinkedIn now?'
  );

  if (confirmed) {
    chrome.tabs.create({ url: 'https://www.linkedin.com/mypreferences/d/download-my-data' });
  }
}

// Show resume text modal
function showResumeTextModal() {
  document.getElementById('resume-text-modal').classList.remove('hidden');
  document.getElementById('upload-zone').classList.add('hidden');
  document.querySelector('.alternate-options').classList.add('hidden');
  document.querySelector('.divider').classList.add('hidden');
}

// Hide resume text modal
function hideResumeTextModal() {
  document.getElementById('resume-text-modal').classList.add('hidden');
  document.getElementById('upload-zone').classList.remove('hidden');
  document.querySelector('.alternate-options').classList.remove('hidden');
  document.querySelector('.divider').classList.remove('hidden');
}

// Save pasted resume text
function saveResumeText() {
  const text = document.getElementById('resume-textarea').value.trim();

  if (!text) {
    alert('Please paste your resume text.');
    return;
  }

  resumeData = {
    filename: 'resume.txt',
    text: text
  };

  hideResumeTextModal();
  showResumePreview('Pasted resume');
  document.getElementById('next-2').disabled = false;
}

// Show resume preview
function showResumePreview(filename) {
  document.getElementById('upload-zone').classList.add('hidden');
  document.querySelector('.divider').classList.add('hidden');
  document.querySelector('.alternate-options').classList.add('hidden');
  document.getElementById('resume-text-modal').classList.add('hidden');

  const preview = document.getElementById('resume-preview');
  document.getElementById('preview-filename').textContent = filename;
  preview.classList.remove('hidden');
}

// Remove resume
function removeResume() {
  resumeData = null;
  document.getElementById('resume-preview').classList.add('hidden');
  document.getElementById('upload-zone').classList.remove('hidden');
  document.querySelector('.divider').classList.remove('hidden');
  document.querySelector('.alternate-options').classList.remove('hidden');
  document.getElementById('next-2').disabled = true;
  document.getElementById('resume-file').value = '';
}

// Extract info from resume
function extractInfoFromResume() {
  if (!resumeData?.text) return;

  const text = resumeData.text;

  // Simple regex extraction (would be more sophisticated in production)
  extractedInfo = {
    name: extractName(text),
    email: extractEmail(text),
    phone: extractPhone(text),
    location: extractLocation(text),
    linkedin: extractLinkedIn(text)
  };

  // Populate form
  document.getElementById('full-name').value = extractedInfo.name || '';
  document.getElementById('email').value = extractedInfo.email || '';
  document.getElementById('phone').value = extractedInfo.phone || '';
  document.getElementById('location').value = extractedInfo.location || '';
  document.getElementById('linkedin').value = extractedInfo.linkedin || '';
}

// Extract name (simple heuristic)
function extractName(text) {
  // Look for name at the start of resume
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    // Simple check: if it looks like a name (2-4 words, no special chars)
    if (firstLine.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,3}$/)) {
      return firstLine;
    }
  }
  return '';
}

// Extract email
function extractEmail(text) {
  const match = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  return match ? match[0] : '';
}

// Extract phone
function extractPhone(text) {
  const match = text.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match ? match[0] : '';
}

// Extract location
function extractLocation(text) {
  // Look for city, state pattern
  const match = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s*([A-Z]{2})/);
  return match ? `${match[1]}, ${match[2]}` : '';
}

// Extract LinkedIn URL
function extractLinkedIn(text) {
  const match = text.match(/linkedin\.com\/in\/[\w-]+/i);
  return match ? `https://www.${match[0]}` : '';
}

// Validate details form
function validateDetailsForm() {
  const name = document.getElementById('full-name').value.trim();
  const email = document.getElementById('email').value.trim();

  if (!name) {
    alert('Please enter your full name.');
    return false;
  }

  if (!email || !email.includes('@')) {
    alert('Please enter a valid email address.');
    return false;
  }

  return true;
}

// Handle finish
async function handleFinish() {
  if (!validatePreferencesForm()) return;

  showLoading('Saving your profile...');

  try {
    const userData = collectUserData();

    // Save to local storage first
    await chrome.storage.local.set({ peeboUser: userData });

    // Try to sync to Supabase
    await syncToSupabase(userData);

    goToStep('complete');
  } catch (error) {
    console.error('Failed to save profile:', error);
    alert('Failed to save profile. Please try again.');
  } finally {
    hideLoading();
  }
}

// Validate preferences form
function validatePreferencesForm() {
  const roles = document.getElementById('target-roles').value.trim();

  if (!roles) {
    alert('Please enter at least one target role.');
    return false;
  }

  return true;
}

// Collect user data from forms
function collectUserData() {
  return {
    full_name: document.getElementById('full-name').value.trim(),
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim() || null,
    location: document.getElementById('location').value.trim() || null,
    linkedin_url: document.getElementById('linkedin').value.trim() || null,
    resume_text: resumeData?.text || null,
    target_roles: document.getElementById('target-roles').value.split(',').map(r => r.trim()).filter(Boolean),
    salary_minimum: parseSalary(document.getElementById('salary-min').value),
    location_preference: document.getElementById('location-pref').value,
    industries: document.getElementById('industries').value.split(',').map(i => i.trim()).filter(Boolean),
    authorized_to_work_us: document.getElementById('authorized-work').checked,
    requires_sponsorship: document.getElementById('requires-sponsorship').checked,
    exclude_companies: document.getElementById('exclude-companies').value.split(',').map(c => c.trim()).filter(Boolean)
  };
}

// Parse salary string to number
function parseSalary(str) {
  if (!str) return null;
  const match = str.replace(/[,$]/g, '').match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

// Sync to Supabase
async function syncToSupabase(userData) {
  const result = await chrome.storage.local.get(['session']);

  if (!result.session?.access_token) {
    console.log('No session, skipping Supabase sync');
    return;
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/peebo_users?auth_user_id=eq.${result.session.user.id}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${result.session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(userData)
    }
  );

  if (!response.ok) {
    console.error('Failed to sync to Supabase:', await response.text());
  }
}

// Populate form from existing user
function populateFormFromUser(user) {
  if (user.resume_text) {
    resumeData = { text: user.resume_text, filename: 'Existing resume' };
    showResumePreview('Existing resume');
    document.getElementById('next-2').disabled = false;
  }

  document.getElementById('full-name').value = user.full_name || '';
  document.getElementById('email').value = user.email || '';
  document.getElementById('phone').value = user.phone || '';
  document.getElementById('location').value = user.location || '';
  document.getElementById('linkedin').value = user.linkedin_url || '';
  document.getElementById('target-roles').value = (user.target_roles || []).join(', ');
  document.getElementById('salary-min').value = user.salary_minimum ? `$${user.salary_minimum.toLocaleString()}` : '';
  document.getElementById('location-pref').value = user.location_preference || 'any';
  document.getElementById('industries').value = (user.industries || []).join(', ');
  document.getElementById('authorized-work').checked = user.authorized_to_work_us !== false;
  document.getElementById('requires-sponsorship').checked = user.requires_sponsorship || false;
  document.getElementById('exclude-companies').value = (user.exclude_companies || []).join(', ');
}

// Go to step
function goToStep(step) {
  // Hide all step contents
  Object.values(stepContents).forEach(el => el.classList.add('hidden'));

  // Show target step
  if (step === 'complete') {
    stepContents.complete.classList.remove('hidden');
    document.getElementById('progress-steps').classList.add('hidden');
  } else {
    stepContents[step].classList.remove('hidden');
    currentStep = step;
    updateProgressSteps();
  }
}

// Update progress steps UI
function updateProgressSteps() {
  steps.forEach((step, index) => {
    const stepNum = index + 1;
    step.classList.remove('active', 'completed');

    if (stepNum < currentStep) {
      step.classList.add('completed');
    } else if (stepNum === currentStep) {
      step.classList.add('active');
    }
  });

  stepLines.forEach((line, index) => {
    line.classList.toggle('completed', index < currentStep - 1);
  });
}

// Show loading overlay
function showLoading(message) {
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.id = 'loading-overlay';
  overlay.innerHTML = `
    <img src="../assets/mascot/peebo-working.svg" alt="Loading" class="mascot">
    <p class="loading-text">${message}</p>
  `;
  document.body.appendChild(overlay);
}

// Hide loading overlay
function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.remove();
  }
}
