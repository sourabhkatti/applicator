// Peebo Job Detector Content Script
// Detects job postings on ATS pages and extracts job information

// ATS-specific selectors and patterns
const ATS_PATTERNS = {
  greenhouse: {
    urlPattern: /greenhouse\.io/,
    selectors: {
      title: '[class*="job-title"], h1.app-title, .job-title',
      company: '[class*="company-name"], .company-name, [data-company]',
      location: '[class*="location"], .location',
      applyButton: '#submit_app, button[type="submit"], .submit-button'
    }
  },
  lever: {
    urlPattern: /lever\.co/,
    selectors: {
      title: '.posting-headline h2, .posting-title',
      company: '.main-header-logo img[alt], .company-name',
      location: '.posting-categories .location, .sort-by-time',
      applyButton: '.postings-btn, .apply-button'
    }
  },
  ashby: {
    urlPattern: /ashbyhq\.com/,
    selectors: {
      title: 'h1, [class*="JobTitle"], [data-testid="job-title"]',
      company: '[class*="CompanyName"], .company-name',
      location: '[class*="Location"], [data-testid="job-location"]',
      applyButton: 'button[type="submit"], [data-testid="apply-button"]'
    }
  },
  workday: {
    urlPattern: /workday\.com|myworkdayjobs\.com/,
    selectors: {
      title: '[data-automation-id="jobPostingHeader"], h1, .job-title',
      company: '[data-automation-id="companyName"], .company-name',
      location: '[data-automation-id="location"], .location',
      applyButton: '[data-automation-id="applyButton"], button[type="submit"]'
    }
  },
  linkedin: {
    urlPattern: /linkedin\.com\/jobs/,
    selectors: {
      title: '.job-details-jobs-unified-top-card__job-title, h1',
      company: '.job-details-jobs-unified-top-card__company-name, .topcard__org-name-link',
      location: '.job-details-jobs-unified-top-card__bullet, .topcard__flavor--bullet',
      applyButton: '.jobs-apply-button, .apply-button'
    }
  },
  icims: {
    urlPattern: /icims\.com/,
    selectors: {
      title: '.iCIMS_JobHeaderTitle, h1',
      company: '.iCIMS_CompanyName, .company-name',
      location: '.iCIMS_JobHeaderLocale, .location',
      applyButton: '.iCIMS_ApplyButton, button[type="submit"]'
    }
  },
  jobvite: {
    urlPattern: /jobvite\.com/,
    selectors: {
      title: '.jv-job-detail-name, h1',
      company: '.jv-company-name, .company-name',
      location: '.jv-job-detail-meta-location, .location',
      applyButton: '.jv-apply-btn, button[type="submit"]'
    }
  },
  smartrecruiters: {
    urlPattern: /smartrecruiters\.com/,
    selectors: {
      title: '.job-title, h1',
      company: '.company-name',
      location: '.job-location, .location',
      applyButton: '.apply-btn, button[type="submit"]'
    }
  }
};

// State
let jobInfo = null;
let atsType = null;

// Initialize
function init() {
  // Detect ATS type
  atsType = detectATS();

  if (atsType) {
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', extractJobInfo);
    } else {
      extractJobInfo();
    }

    // Also observe for dynamic content
    observePageChanges();
  }
}

// Detect which ATS we're on
function detectATS() {
  const url = window.location.href;

  for (const [name, pattern] of Object.entries(ATS_PATTERNS)) {
    if (pattern.urlPattern.test(url)) {
      return name;
    }
  }

  return null;
}

// Extract job information from the page
function extractJobInfo() {
  if (!atsType) return;

  const selectors = ATS_PATTERNS[atsType].selectors;

  const title = extractText(selectors.title);
  const company = extractCompany(selectors.company);
  const location = extractText(selectors.location);

  if (title) {
    jobInfo = {
      isJobPage: true,
      title,
      company,
      location,
      role: title,
      url: window.location.href,
      atsType
    };

    console.log('Peebo detected job:', jobInfo);
  }
}

// Extract text from selector
function extractText(selector) {
  const selectors = selector.split(',').map(s => s.trim());

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        return el.textContent.trim();
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }

  return null;
}

// Extract company name (might be in alt text, title, etc.)
function extractCompany(selector) {
  const selectors = selector.split(',').map(s => s.trim());

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        // Check various attributes
        if (el.tagName === 'IMG' && el.alt) {
          return el.alt.trim();
        }
        if (el.dataset.company) {
          return el.dataset.company.trim();
        }
        return el.textContent.trim();
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }

  // Fallback: try to extract from URL
  return extractCompanyFromUrl(window.location.href);
}

// Extract company from URL
function extractCompanyFromUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    if (hostname.includes('greenhouse.io') || hostname.includes('lever.co') ||
        hostname.includes('ashbyhq.com')) {
      // Pattern: jobs.greenhouse.io/companyname or companyname.lever.co
      const match = parsed.pathname.match(/^\/([^\/]+)/);
      if (match) {
        return formatCompanyName(match[1]);
      }
    }

    if (hostname.includes('myworkdayjobs.com')) {
      const match = hostname.match(/(\w+)\.myworkdayjobs\.com/);
      if (match) {
        return formatCompanyName(match[1]);
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Format company name
function formatCompanyName(name) {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Observe for dynamic content changes
function observePageChanges() {
  const observer = new MutationObserver((mutations) => {
    // Debounce
    clearTimeout(window.peeboDebounce);
    window.peeboDebounce = setTimeout(() => {
      extractJobInfo();
    }, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_JOB_INFO') {
    sendResponse(jobInfo || { isJobPage: false });
  }

  return true;
});

// Initialize
init();
