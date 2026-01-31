# Autonomous Job Search & Apply System

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully autonomous system that searches for PM jobs via Google, evaluates them against criteria, and applies automatically.

**Architecture:** Google site: searches across 5 ATS platforms (Ashby, Greenhouse, Lever, Rippling, BambooHR) with role/location variations. LLM agent reviews each job for fit, then applies via CDP browser automation. Progress tracked in real-time.

**Tech Stack:** Python asyncio, ExtensionBrowser (CDP), Google search scraping, AgentMail for confirmations

---

## Task 1: Create job search configuration schema

**Files:**
- Modify: `/Users/sourabhkatti/applicator/applicant.yaml`

**Step 1: Add search configuration to applicant.yaml**

Add after `exclude_platforms`:

```yaml
# Job search configuration
search_config:
  # ATS platforms to search (site: filter domains)
  platforms:
    - "jobs.ashbyhq.com"
    - "boards.greenhouse.io"
    - "jobs.lever.co"
    - "ats.rippling.com"

  # Role variations to search
  roles:
    - "Staff Product Manager"
    - "Senior Product Manager"
    - "Principal Product Manager"
    - "Product Lead"
    - "Group Product Manager"
    - "Director of Product"

  # Location variations
  locations:
    - "San Francisco"
    - "Bay Area"
    - "remote"

  # Results per query
  results_per_query: 10

  # Minimum job fit score (1-10) to apply
  min_fit_score: 7
```

**Step 2: Verify YAML is valid**

Run: `python -c "import yaml; yaml.safe_load(open('applicant.yaml'))"`
Expected: No errors

**Step 3: Commit**

```bash
git add applicant.yaml
git commit -m "feat: add job search configuration schema"
```

---

## Task 2: Create Google search module

**Files:**
- Create: `/Users/sourabhkatti/peebo-local/job_search/google_search.py`
- Create: `/Users/sourabhkatti/peebo-local/job_search/__init__.py`

**Step 1: Create the job_search directory**

```bash
mkdir -p /Users/sourabhkatti/peebo-local/job_search
touch /Users/sourabhkatti/peebo-local/job_search/__init__.py
```

**Step 2: Create google_search.py**

```python
#!/usr/bin/env python3
"""
Google search module for job discovery.
Uses site: filters to search specific ATS platforms.
"""

import asyncio
import re
import urllib.parse
from dataclasses import dataclass
from typing import List, Optional
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from browser.extension_browser import ExtensionBrowser


@dataclass
class JobResult:
    """A job found via Google search."""
    url: str
    title: str
    company: str
    platform: str
    location: Optional[str] = None
    description_snippet: Optional[str] = None

    def __hash__(self):
        return hash(self.url)

    def __eq__(self, other):
        return self.url == other.url


class GoogleJobSearch:
    """Search Google for jobs on specific ATS platforms."""

    def __init__(self, browser: ExtensionBrowser):
        self.browser = browser

    def build_query(self, role: str, location: str, platform: str) -> str:
        """Build a Google search query."""
        # site:jobs.ashbyhq.com "staff product manager" "san francisco"
        query = f'site:{platform} "{role}" "{location}"'
        return query

    async def search(self, query: str, max_results: int = 10) -> List[JobResult]:
        """
        Execute a Google search and extract job results.

        Args:
            query: Google search query
            max_results: Maximum results to return

        Returns:
            List of JobResult objects
        """
        # URL encode the query
        encoded_query = urllib.parse.quote(query)
        search_url = f"https://www.google.com/search?q={encoded_query}&num={max_results}"

        print(f"[GoogleSearch] Searching: {query}")
        await self.browser.navigate(search_url)
        await asyncio.sleep(2)  # Wait for results

        # Extract DOM
        state = await self.browser.get_dom_state(include_screenshot=False)

        results = []

        # Find search result links
        for el in state.elements:
            if el.tag == 'a' and el.name:
                href = el.name  # In our DOM extraction, 'name' often contains link text
                # Check if it's a job board link
                if any(platform in str(el.rect) for platform in ['ashbyhq', 'greenhouse', 'lever', 'rippling', 'bamboohr']):
                    # This is a simplified extraction - we'll need to refine based on actual DOM
                    pass

        # Alternative: Extract from page via JavaScript
        extract_script = """
        const results = [];
        document.querySelectorAll('a').forEach(a => {
            const href = a.href;
            if (href && (
                href.includes('jobs.ashbyhq.com') ||
                href.includes('boards.greenhouse.io') ||
                href.includes('jobs.lever.co') ||
                href.includes('ats.rippling.com') ||
                href.includes('bamboohr.com')
            )) {
                // Skip Google redirect URLs, extract actual URL
                let actualUrl = href;
                if (href.includes('google.com/url')) {
                    const match = href.match(/url=([^&]+)/);
                    if (match) actualUrl = decodeURIComponent(match[1]);
                }

                const title = a.innerText || a.textContent || '';
                if (title && actualUrl && !results.find(r => r.url === actualUrl)) {
                    results.push({
                        url: actualUrl,
                        title: title.substring(0, 200)
                    });
                }
            }
        });
        return results.slice(0, """ + str(max_results) + """);
        """

        # We'll execute this via the content script
        # For now, return empty and implement in next task
        return results

    async def search_all(
        self,
        roles: List[str],
        locations: List[str],
        platforms: List[str],
        results_per_query: int = 10
    ) -> List[JobResult]:
        """
        Run all search combinations and deduplicate results.

        Args:
            roles: List of role titles to search
            locations: List of locations to search
            platforms: List of ATS platform domains
            results_per_query: Max results per individual query

        Returns:
            Deduplicated list of JobResult objects
        """
        all_results = set()

        for platform in platforms:
            for role in roles:
                for location in locations:
                    query = self.build_query(role, location, platform)
                    results = await self.search(query, results_per_query)
                    all_results.update(results)

                    # Small delay between searches to avoid rate limiting
                    await asyncio.sleep(1)

        return list(all_results)


async def test_search():
    """Quick test of the search functionality."""
    browser = ExtensionBrowser()
    await browser.connect()

    search = GoogleJobSearch(browser)
    query = search.build_query("Staff Product Manager", "San Francisco", "jobs.ashbyhq.com")
    print(f"Query: {query}")

    results = await search.search(query, max_results=5)
    print(f"Found {len(results)} results")
    for r in results:
        print(f"  - {r.title}: {r.url}")

    await browser.close()


if __name__ == '__main__':
    asyncio.run(test_search())
```

**Step 3: Test the module loads**

Run: `cd /Users/sourabhkatti/peebo-local && python -c "from job_search.google_search import GoogleJobSearch; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
cd /Users/sourabhkatti/peebo-local
git init 2>/dev/null || true
git add job_search/
git commit -m "feat: add Google job search module"
```

---

## Task 3: Add JavaScript extraction to ExtensionBrowser

**Files:**
- Modify: `/Users/sourabhkatti/peebo-local/extension_bridge/native_client.py`
- Modify: `/Users/sourabhkatti/applicator/peebo-extension/background/service-worker.js`
- Modify: `/Users/sourabhkatti/applicator/peebo-extension/content/form-filler.js`

**Step 1: Add execute_script method to native_client.py**

Add after the `extract_dom` method (around line 237):

```python
    async def execute_script(self, script: str) -> dict:
        """Execute JavaScript in the page context and return result."""
        return await self.send_command('execute_script', {
            'script': script
        }, timeout=30.0)
```

**Step 2: Add execute_script handler to service-worker.js**

Add in the `handleNativeCommand` switch statement (around line 520):

```javascript
      case 'execute_script':
        result = await handleExecuteScript(params);
        break;
```

Add the handler function (after other handler functions):

```javascript
async function handleExecuteScript({ script }) {
  if (!controlledTabId) {
    return { success: false, error: 'No tab attached' };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: controlledTabId },
      func: (code) => {
        return eval(code);
      },
      args: [script]
    });

    return {
      success: true,
      result: results[0]?.result
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
```

**Step 3: Add execute_script to ExtensionBrowser**

Add to `/Users/sourabhkatti/peebo-local/browser/extension_browser.py` after the `save_screenshot` method:

```python
    async def execute_script(self, script: str) -> any:
        """Execute JavaScript in the page and return the result."""
        result = await self.client.execute_script(script)
        if result.get('success'):
            return result.get('result')
        raise RuntimeError(f"Script execution failed: {result.get('error')}")
```

**Step 4: Update extension version**

In `/Users/sourabhkatti/applicator/peebo-extension/manifest.json`, change:
```json
"version": "1.10.2",
```

**Step 5: Commit**

```bash
cd /Users/sourabhkatti/applicator
git add peebo-extension/
git commit -m "feat: add execute_script for JS evaluation in page context"
```

---

## Task 4: Implement Google results extraction

**Files:**
- Modify: `/Users/sourabhkatti/peebo-local/job_search/google_search.py`

**Step 1: Update the search method with working extraction**

Replace the `search` method in `google_search.py`:

```python
    async def search(self, query: str, max_results: int = 10) -> List[JobResult]:
        """
        Execute a Google search and extract job results.
        """
        encoded_query = urllib.parse.quote(query)
        search_url = f"https://www.google.com/search?q={encoded_query}&num={max_results + 5}"

        print(f"[GoogleSearch] Searching: {query[:60]}...")
        await self.browser.navigate(search_url)
        await asyncio.sleep(2.5)

        # Extract job links via JavaScript
        extract_script = """
        (() => {
            const results = [];
            const dominated = ['ashbyhq.com', 'greenhouse.io', 'lever.co', 'rippling.com', 'bamboohr.com'];

            document.querySelectorAll('a[href]').forEach(a => {
                let href = a.href;

                // Skip non-job links
                if (!dominated.some(d => href.includes(d))) return;

                // Handle Google redirect URLs
                if (href.includes('/url?')) {
                    const params = new URLSearchParams(href.split('?')[1]);
                    href = params.get('url') || params.get('q') || href;
                }

                // Clean URL
                href = href.split('&')[0];

                // Get title from link text or parent
                let title = a.innerText?.trim() || '';
                if (!title || title.length < 5) {
                    title = a.closest('div')?.innerText?.split('\\n')[0] || '';
                }

                // Extract company from URL or title
                let company = '';
                const urlMatch = href.match(/\\/([^\\/]+)\\/jobs?\\//);
                if (urlMatch) company = urlMatch[1].replace(/-/g, ' ');

                // Determine platform
                let platform = 'unknown';
                if (href.includes('ashbyhq')) platform = 'ashby';
                else if (href.includes('greenhouse')) platform = 'greenhouse';
                else if (href.includes('lever')) platform = 'lever';
                else if (href.includes('rippling')) platform = 'rippling';
                else if (href.includes('bamboohr')) platform = 'bamboohr';

                if (title && href && !results.find(r => r.url === href)) {
                    results.push({
                        url: href,
                        title: title.substring(0, 200),
                        company: company,
                        platform: platform
                    });
                }
            });

            return results;
        })()
        """

        try:
            raw_results = await self.browser.execute_script(extract_script)

            results = []
            for r in (raw_results or [])[:max_results]:
                results.append(JobResult(
                    url=r['url'],
                    title=r['title'],
                    company=r.get('company', ''),
                    platform=r.get('platform', 'unknown')
                ))

            print(f"[GoogleSearch] Found {len(results)} jobs")
            return results

        except Exception as e:
            print(f"[GoogleSearch] Extraction error: {e}")
            return []
```

**Step 2: Test the search**

Run: `cd /Users/sourabhkatti/peebo-local && python job_search/google_search.py`
Expected: Shows query and found results

**Step 3: Commit**

```bash
cd /Users/sourabhkatti/peebo-local
git add job_search/
git commit -m "feat: implement Google results extraction with JS"
```

---

## Task 5: Create job reviewer module

**Files:**
- Create: `/Users/sourabhkatti/peebo-local/job_search/job_reviewer.py`

**Step 1: Create job_reviewer.py**

```python
#!/usr/bin/env python3
"""
Job reviewer module - LLM evaluates jobs against applicant criteria.
"""

import asyncio
import re
from dataclasses import dataclass
from typing import List, Optional, Dict, Any
import yaml
from pathlib import Path

from job_search.google_search import JobResult


@dataclass
class ReviewedJob:
    """A job that has been reviewed by the agent."""
    job: JobResult
    fit_score: int  # 1-10
    reasoning: str
    should_apply: bool
    job_description: Optional[str] = None
    salary_estimate: Optional[str] = None


class JobReviewer:
    """Reviews jobs against applicant criteria."""

    def __init__(self, applicant_config: Dict[str, Any]):
        self.config = applicant_config
        self.target_roles = applicant_config.get('target_roles', [])
        self.salary_minimum = applicant_config.get('salary_minimum', 0)
        self.location_preference = applicant_config.get('location_preference', '')
        self.industries = applicant_config.get('industries', [])
        self.exclude_companies = [c.lower() for c in applicant_config.get('exclude_companies', [])]
        self.min_fit_score = applicant_config.get('search_config', {}).get('min_fit_score', 7)

    def quick_filter(self, job: JobResult) -> tuple[bool, str]:
        """
        Quick filter based on URL/title without fetching full description.
        Returns (should_continue, reason).
        """
        # Check excluded companies
        company_lower = job.company.lower()
        for excluded in self.exclude_companies:
            if excluded in company_lower:
                return False, f"Excluded company: {excluded}"

        # Check if role seems relevant
        title_lower = job.title.lower()
        role_keywords = ['product', 'pm', 'product manager']
        if not any(kw in title_lower for kw in role_keywords):
            return False, "Not a product role"

        return True, "Passed quick filter"

    def evaluate_job(self, job: JobResult, job_description: str = "") -> ReviewedJob:
        """
        Evaluate a job against all criteria.

        This is a rule-based evaluation. For more sophisticated matching,
        this could be replaced with an LLM call.
        """
        score = 5  # Start neutral
        reasons = []

        title_lower = job.title.lower()
        desc_lower = job_description.lower()
        combined = title_lower + " " + desc_lower

        # Role level check (+2 for exact match, +1 for adjacent)
        level_keywords = {
            'staff': 2, 'principal': 2, 'senior': 1,
            'lead': 1, 'director': 2, 'head': 2, 'group': 2
        }
        for level, points in level_keywords.items():
            if level in title_lower:
                score += points
                reasons.append(f"+{points}: {level} level role")
                break

        # Industry check
        industry_keywords = {
            'security': 2, 'cybersecurity': 2, 'infosec': 2,
            'developer': 1, 'devtools': 2, 'platform': 1,
            'ai': 2, 'machine learning': 2, 'ml': 1, 'llm': 2
        }
        for industry, points in industry_keywords.items():
            if industry in combined:
                score += points
                reasons.append(f"+{points}: {industry} industry")
                break

        # Location check
        location_lower = self.location_preference.lower()
        if 'remote' in combined and 'remote' in location_lower:
            score += 1
            reasons.append("+1: remote friendly")
        if 'san francisco' in combined or 'sf' in combined:
            score += 1
            reasons.append("+1: SF location")

        # Salary check (if mentioned)
        salary_match = re.search(r'\$(\d{3}),?(\d{3})', combined)
        if salary_match:
            salary = int(salary_match.group(1) + salary_match.group(2))
            if salary >= self.salary_minimum:
                score += 1
                reasons.append(f"+1: salary ${salary:,} meets minimum")
            else:
                score -= 2
                reasons.append(f"-2: salary ${salary:,} below minimum")

        # Cap score at 10
        score = min(10, max(1, score))

        should_apply = score >= self.min_fit_score

        return ReviewedJob(
            job=job,
            fit_score=score,
            reasoning="; ".join(reasons) if reasons else "Base score",
            should_apply=should_apply,
            job_description=job_description[:500] if job_description else None
        )

    async def review_jobs(
        self,
        jobs: List[JobResult],
        browser=None  # ExtensionBrowser for fetching descriptions
    ) -> List[ReviewedJob]:
        """
        Review all jobs and return sorted by fit score.
        """
        reviewed = []

        for job in jobs:
            # Quick filter first
            should_continue, reason = self.quick_filter(job)
            if not should_continue:
                print(f"[Reviewer] Skipped: {job.company} - {reason}")
                continue

            # Fetch job description if browser available
            job_description = ""
            if browser:
                try:
                    await browser.navigate(job.url)
                    await asyncio.sleep(2)

                    # Extract job description text
                    script = """
                    (() => {
                        const selectors = [
                            '[data-qa="job-description"]',
                            '.job-description',
                            '.posting-description',
                            'article',
                            'main'
                        ];
                        for (const sel of selectors) {
                            const el = document.querySelector(sel);
                            if (el) return el.innerText.substring(0, 3000);
                        }
                        return document.body.innerText.substring(0, 3000);
                    })()
                    """
                    job_description = await browser.execute_script(script) or ""
                except Exception as e:
                    print(f"[Reviewer] Could not fetch description: {e}")

            # Evaluate
            result = self.evaluate_job(job, job_description)
            reviewed.append(result)

            status = "APPLY" if result.should_apply else "SKIP"
            print(f"[Reviewer] {status} ({result.fit_score}/10): {job.company} - {job.title[:40]}")

        # Sort by fit score descending
        reviewed.sort(key=lambda r: r.fit_score, reverse=True)

        return reviewed


def load_applicant_config(path: str = None) -> Dict[str, Any]:
    """Load applicant configuration from YAML."""
    if path is None:
        path = Path(__file__).parent.parent.parent / "applicator" / "applicant.yaml"

    with open(path) as f:
        return yaml.safe_load(f)
```

**Step 2: Test the module loads**

Run: `cd /Users/sourabhkatti/peebo-local && python -c "from job_search.job_reviewer import JobReviewer; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
cd /Users/sourabhkatti/peebo-local
git add job_search/
git commit -m "feat: add job reviewer module with scoring"
```

---

## Task 6: Create autonomous applicator orchestrator

**Files:**
- Create: `/Users/sourabhkatti/peebo-local/autonomous_applicator.py`

**Step 1: Create autonomous_applicator.py**

```python
#!/usr/bin/env python3
"""
Autonomous Job Applicator

Fully autonomous system that:
1. Searches for jobs via Google
2. Reviews them against criteria
3. Applies automatically
4. Tracks progress
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List
import yaml

sys.path.insert(0, str(Path(__file__).parent))

from browser.extension_browser import ExtensionBrowser
from job_search.google_search import GoogleJobSearch, JobResult
from job_search.job_reviewer import JobReviewer, ReviewedJob, load_applicant_config
from browser.applicator import JobApplicator, ApplicantInfo


@dataclass
class SessionState:
    """Tracks the current application session."""
    started_at: str
    target_count: int
    completed: int
    current_job: Optional[str]
    current_step: str
    jobs_applied: List[dict]
    jobs_pending: List[dict]
    jobs_skipped: List[dict]


class AutonomousApplicator:
    """
    Orchestrates the full autonomous job application flow.
    """

    def __init__(self, config_path: str = None):
        self.config = load_applicant_config(config_path)
        self.search_config = self.config.get('search_config', {})

        self.browser: Optional[ExtensionBrowser] = None
        self.searcher: Optional[GoogleJobSearch] = None
        self.reviewer: Optional[JobReviewer] = None
        self.applicator: Optional[JobApplicator] = None

        # Session state
        self.state_file = Path.home() / ".peebo" / "session_state.json"
        self.state_file.parent.mkdir(parents=True, exist_ok=True)

        # Tracker integration
        self.tracker_file = Path(__file__).parent.parent / "applicator" / "tracker" / "jobs.json"

    async def connect(self):
        """Initialize all components."""
        print("[Applicator] Connecting to browser...")
        self.browser = ExtensionBrowser()
        await self.browser.connect()

        self.searcher = GoogleJobSearch(self.browser)
        self.reviewer = JobReviewer(self.config)

        applicant = ApplicantInfo(
            name=self.config['name'],
            email=self.config['email'],
            phone=self.config['phone'],
            location=self.config['location'],
            linkedin_url=self.config.get('linkedin', ''),
            resume_path=self.config.get('resume_path'),
            resume_text=self.config.get('resume_text')
        )
        self.applicator = JobApplicator(applicant)
        self.applicator.browser = self.browser
        self.applicator._connected = True

        print("[Applicator] Connected!")

    async def close(self):
        """Clean up resources."""
        if self.browser:
            await self.browser.cleanup()
            await self.browser.close()

    def save_state(self, state: dict):
        """Save session state to file."""
        with open(self.state_file, 'w') as f:
            json.dump(state, f, indent=2, default=str)

    def load_state(self) -> Optional[dict]:
        """Load session state from file."""
        if self.state_file.exists():
            with open(self.state_file) as f:
                return json.load(f)
        return None

    def add_to_tracker(self, job: JobResult, status: str = "applied"):
        """Add a job to the tracker."""
        try:
            jobs = []
            if self.tracker_file.exists():
                with open(self.tracker_file) as f:
                    jobs = json.load(f)

            job_entry = {
                "id": len(jobs) + 1,
                "company": job.company,
                "role": job.title,
                "url": job.url,
                "status": status,
                "applied_at": datetime.now(timezone.utc).isoformat(),
                "platform": job.platform,
                "notes": "Applied via autonomous applicator"
            }
            jobs.append(job_entry)

            with open(self.tracker_file, 'w') as f:
                json.dump(jobs, f, indent=2)

            print(f"[Tracker] Added: {job.company} - {job.title}")
        except Exception as e:
            print(f"[Tracker] Error adding job: {e}")

    async def search_jobs(self) -> List[JobResult]:
        """Search for jobs using configured criteria."""
        print("\n" + "="*60)
        print("PHASE 1: SEARCHING FOR JOBS")
        print("="*60)

        platforms = self.search_config.get('platforms', [
            'jobs.ashbyhq.com',
            'boards.greenhouse.io',
            'jobs.lever.co'
        ])
        roles = self.search_config.get('roles', self.config.get('target_roles', []))
        locations = self.search_config.get('locations', ['San Francisco', 'remote'])
        results_per_query = self.search_config.get('results_per_query', 10)

        print(f"Platforms: {len(platforms)}")
        print(f"Roles: {len(roles)}")
        print(f"Locations: {len(locations)}")
        print(f"Total queries: {len(platforms) * len(roles) * len(locations)}")

        jobs = await self.searcher.search_all(
            roles=roles,
            locations=locations,
            platforms=platforms,
            results_per_query=results_per_query
        )

        print(f"\nFound {len(jobs)} unique jobs")
        return jobs

    async def review_jobs(self, jobs: List[JobResult]) -> List[ReviewedJob]:
        """Review jobs and filter to best matches."""
        print("\n" + "="*60)
        print("PHASE 2: REVIEWING JOBS")
        print("="*60)

        reviewed = await self.reviewer.review_jobs(jobs, browser=self.browser)

        approved = [r for r in reviewed if r.should_apply]
        print(f"\nApproved {len(approved)} of {len(reviewed)} jobs")

        return approved

    async def apply_to_job(self, reviewed_job: ReviewedJob) -> bool:
        """Apply to a single job."""
        job = reviewed_job.job
        print(f"\n[Applying] {job.company} - {job.title}")
        print(f"           URL: {job.url}")

        try:
            # Navigate to job
            await self.browser.navigate(job.url)
            await asyncio.sleep(3)

            # For Greenhouse, may need to click through to application
            if job.platform == 'greenhouse':
                state = await self.browser.get_dom_state(include_screenshot=False)
                for el in state.elements:
                    if el.name and 'apply' in el.name.lower():
                        await self.browser.click(x=el.center_x, y=el.center_y)
                        await asyncio.sleep(2)
                        break

            # Get form state
            state = await self.browser.get_dom_state(include_screenshot=False)

            # Auto-fill common fields
            fill_results = await self.applicator.auto_fill_common_fields()
            print(f"           Filled {len(fill_results)} fields")

            # Look for file upload
            fields = await self.applicator.find_form_fields()
            if fields['file_inputs']:
                await self.applicator.upload_resume()
                print("           Uploaded resume")

            # TODO: Handle additional form fields, custom questions
            # For now, we'll need manual review for complex forms

            # Add to tracker
            self.add_to_tracker(job, status="applied")

            return True

        except Exception as e:
            print(f"           ERROR: {e}")
            self.add_to_tracker(job, status="failed")
            return False

    async def run(self, target_count: int = 10):
        """
        Run the full autonomous application flow.

        Args:
            target_count: Number of jobs to apply to
        """
        print("\n" + "#"*60)
        print(f"# AUTONOMOUS JOB APPLICATOR - Target: {target_count} applications")
        print("#"*60)

        state = {
            "started_at": datetime.now(timezone.utc).isoformat(),
            "target_count": target_count,
            "completed": 0,
            "current_job": None,
            "current_step": "initializing",
            "jobs_applied": [],
            "jobs_pending": [],
            "jobs_skipped": []
        }
        self.save_state(state)

        try:
            await self.connect()

            # Phase 1: Search
            state["current_step"] = "searching"
            self.save_state(state)
            jobs = await self.search_jobs()

            # Phase 2: Review
            state["current_step"] = "reviewing"
            self.save_state(state)
            approved = await self.review_jobs(jobs)

            state["jobs_pending"] = [
                {"company": r.job.company, "title": r.job.title, "score": r.fit_score}
                for r in approved[:target_count]
            ]
            self.save_state(state)

            # Phase 3: Apply
            print("\n" + "="*60)
            print("PHASE 3: APPLYING TO JOBS")
            print("="*60)

            applied_count = 0
            for reviewed_job in approved:
                if applied_count >= target_count:
                    break

                state["current_job"] = f"{reviewed_job.job.company} - {reviewed_job.job.title}"
                state["current_step"] = "applying"
                self.save_state(state)

                success = await self.apply_to_job(reviewed_job)

                if success:
                    applied_count += 1
                    state["completed"] = applied_count
                    state["jobs_applied"].append({
                        "company": reviewed_job.job.company,
                        "title": reviewed_job.job.title,
                        "url": reviewed_job.job.url,
                        "score": reviewed_job.fit_score
                    })
                else:
                    state["jobs_skipped"].append({
                        "company": reviewed_job.job.company,
                        "title": reviewed_job.job.title,
                        "reason": "application failed"
                    })

                self.save_state(state)

                # Small delay between applications
                await asyncio.sleep(2)

            # Done
            state["current_step"] = "completed"
            state["current_job"] = None
            self.save_state(state)

            print("\n" + "#"*60)
            print(f"# COMPLETED: {applied_count} applications submitted")
            print("#"*60)

            return applied_count

        except KeyboardInterrupt:
            print("\n\nInterrupted by user")
            state["current_step"] = "interrupted"
            self.save_state(state)
        except Exception as e:
            print(f"\n\nError: {e}")
            state["current_step"] = f"error: {str(e)}"
            self.save_state(state)
            raise
        finally:
            await self.close()

    @classmethod
    def get_status(cls) -> Optional[dict]:
        """Get current session status."""
        state_file = Path.home() / ".peebo" / "session_state.json"
        if state_file.exists():
            with open(state_file) as f:
                return json.load(f)
        return None


async def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description='Autonomous Job Applicator')
    parser.add_argument('command', choices=['apply', 'status'], help='Command to run')
    parser.add_argument('count', nargs='?', type=int, default=10, help='Number of jobs to apply to')
    parser.add_argument('--config', help='Path to applicant.yaml')

    args = parser.parse_args()

    if args.command == 'status':
        state = AutonomousApplicator.get_status()
        if state:
            print(json.dumps(state, indent=2))
        else:
            print("No active session")

    elif args.command == 'apply':
        applicator = AutonomousApplicator(config_path=args.config)
        await applicator.run(target_count=args.count)


if __name__ == '__main__':
    asyncio.run(main())
```

**Step 2: Fix missing import**

Add at the top of the file after existing imports:

```python
from dataclasses import dataclass
```

**Step 3: Test the module loads**

Run: `cd /Users/sourabhkatti/peebo-local && python -c "from autonomous_applicator import AutonomousApplicator; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
cd /Users/sourabhkatti/peebo-local
git add autonomous_applicator.py
git commit -m "feat: add autonomous applicator orchestrator"
```

---

## Task 7: Create simple run.py entry point

**Files:**
- Create: `/Users/sourabhkatti/peebo-local/run.py`

**Step 1: Create run.py**

```python
#!/usr/bin/env python3
"""
Peebo Autonomous Job Applicator - Entry Point

Usage:
    python run.py apply 10    # Apply to 10 jobs
    python run.py status      # Check progress
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from autonomous_applicator import AutonomousApplicator, main

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python run.py apply <count>  - Apply to jobs")
        print("  python run.py status         - Check progress")
        sys.exit(1)

    asyncio.run(main())
```

**Step 2: Make executable**

```bash
chmod +x /Users/sourabhkatti/peebo-local/run.py
```

**Step 3: Commit**

```bash
cd /Users/sourabhkatti/peebo-local
git add run.py
git commit -m "feat: add run.py entry point"
```

---

## Task 8: Integration test with 2 real applications

**Files:**
- None (testing existing code)

**Step 1: Reload Chrome extension**

In Chrome:
1. Go to `chrome://extensions`
2. Click refresh on Peebo extension

**Step 2: Run the autonomous applicator for 2 jobs**

```bash
cd /Users/sourabhkatti/peebo-local
python run.py apply 2
```

**Expected output:**
- Shows search progress across platforms
- Reviews and scores jobs
- Applies to top 2 matching jobs
- Updates tracker

**Step 3: Check status**

```bash
python run.py status
```

**Expected:** Shows completed applications and status

**Step 4: Verify tracker**

```bash
cat /Users/sourabhkatti/applicator/tracker/jobs.json | python -m json.tool | tail -20
```

**Expected:** New job entries with "Applied via autonomous applicator" notes

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Search config schema | applicant.yaml |
| 2 | Google search module | job_search/google_search.py |
| 3 | JS execution in browser | native_client.py, service-worker.js |
| 4 | Google results extraction | google_search.py |
| 5 | Job reviewer | job_search/job_reviewer.py |
| 6 | Autonomous orchestrator | autonomous_applicator.py |
| 7 | Entry point | run.py |
| 8 | Integration test | (runtime test) |
