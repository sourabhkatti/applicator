#!/usr/bin/env python3
"""
Browser-based job application automation using browser-use.

Handles job applications that require file uploads (resume PDF) instead of copy/paste.
Works with Ashby ATS, Greenhouse, and any other site where JavaScript file input
manipulation doesn't work.

Usage:
    python apply.py <job_url> [--resume /path/to/resume.pdf]

Example:
    python apply.py "https://jobs.ashbyhq.com/ramp/9972df9e-..."
    python apply.py "https://boards.greenhouse.io/company/jobs/123"
"""

import argparse
import asyncio
import json
import logging
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv


def load_tracker():
    """Load tracker data from jobs.json."""
    tracker_path = Path(__file__).parent.parent / "tracker" / "jobs.json"

    if not tracker_path.exists():
        return {"settings": {"followUpDays": 2, "active_tasks": {}}, "jobs": []}

    try:
        with open(tracker_path, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"Warning: Could not read tracker: {e}")
        return {"settings": {"followUpDays": 2, "active_tasks": {}}, "jobs": []}


def save_tracker(tracker_data):
    """Save tracker data to jobs.json."""
    tracker_path = Path(__file__).parent.parent / "tracker" / "jobs.json"

    try:
        with open(tracker_path, 'w') as f:
            json.dump(tracker_data, f, indent=2)
        return True
    except IOError as e:
        print(f"Warning: Could not write to tracker: {e}")
        return False


def create_active_task(company: str, role: str, job_url: str) -> str:
    """
    Create an active task entry in the tracker.
    Returns the task_id.
    """
    tracker_data = load_tracker()

    # Ensure active_tasks exists
    if 'settings' not in tracker_data:
        tracker_data['settings'] = {}
    if 'active_tasks' not in tracker_data['settings']:
        tracker_data['settings']['active_tasks'] = {}

    task_id = str(uuid.uuid4())
    tracker_data['settings']['active_tasks'][task_id] = {
        'task_id': task_id,
        'company': company,
        'role': role,
        'job_url': job_url,
        'started_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'status': 'running',
        'progress': 0,
        'current_step': 'Initializing browser',
        'total_steps': 0,
        'error_message': None,
        'cost': 0.0,
        'input_tokens': 0,
        'output_tokens': 0
    }

    save_tracker(tracker_data)
    return task_id


def update_task_cost(task_id: str, cost: float, input_tokens: int = 0, output_tokens: int = 0):
    """Update the cost for an active task."""
    try:
        tracker_data = load_tracker()
        if task_id in tracker_data['settings'].get('active_tasks', {}):
            tracker_data['settings']['active_tasks'][task_id].update({
                'cost': cost,
                'input_tokens': input_tokens,
                'output_tokens': output_tokens,
                'updated_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            })
            save_tracker(tracker_data)
    except Exception as e:
        print(f"Warning: Failed to update task cost: {e}")


def update_task_progress(task_id: str, current_step: str, progress: int):
    """Update active task progress in tracker."""
    try:
        tracker_data = load_tracker()
        if task_id in tracker_data['settings'].get('active_tasks', {}):
            tracker_data['settings']['active_tasks'][task_id].update({
                'current_step': current_step,
                'progress': progress,
                'updated_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            })
            save_tracker(tracker_data)
    except Exception as e:
        print(f"Warning: Failed to update task progress: {e}")


def complete_task(task_id: str, company: str, role: str, job_url: str, agent_result: str = None,
                   cost: float = 0.0, input_tokens: int = 0, output_tokens: int = 0):
    """
    Remove task from active_tasks and add to jobs list.
    """
    tracker_data = load_tracker()

    # Remove from active tasks
    if task_id in tracker_data['settings'].get('active_tasks', {}):
        del tracker_data['settings']['active_tasks'][task_id]

    # Check if job already exists (by URL)
    existing_urls = [job.get("jobUrl", "") for job in tracker_data.get("jobs", [])]
    if job_url in existing_urls:
        print(f"Job already in tracker: {job_url}")
        save_tracker(tracker_data)
        return True

    # Create new job entry with unified schema
    today = datetime.now().strftime("%Y-%m-%d")
    applied_at = datetime.now().isoformat() + "Z"

    new_job = {
        "id": str(uuid.uuid4()).upper(),
        "company": company.replace("-", " ").replace("_", " ").title(),
        "role": role,
        "status": "applied",
        "interview_stage": None,
        "applied_at": applied_at,
        "dateApplied": today,
        "lastActivityDate": today,
        "followUpBy": None,
        "jobUrl": job_url,
        "salaryMin": None,
        "salaryMax": None,
        "recruiterName": None,
        "recruiterEmail": None,
        "hiringManagerName": None,
        "hiringManagerEmail": None,
        "referralContact": None,
        "referralStatus": "none",
        "interviews": [],
        "notes": f"Applied via browser-applicator on {today}. Awaiting email confirmation.\n\n{agent_result[:200] if agent_result else ''}".strip(),
        "companyResearch": None,
        "prepChecklist": {
            "companyResearch": False,
            "starStories": False,
            "questionsReady": False,
            "technicalPrep": False
        },
        "offer": None,
        "nextAction": "Wait for response",
        "email_verified": False,
        "browser_use_task_id": task_id,
        "application_cost": cost,
        "application_tokens": {
            "input": input_tokens,
            "output": output_tokens
        },
        "audit_trail": [],
        "synced": True,
        "created_at": applied_at,
        "updated_at": applied_at
    }

    # Add to jobs list (at beginning)
    tracker_data['jobs'].insert(0, new_job)

    save_tracker(tracker_data)
    cost_str = f"${cost:.4f}" if cost > 0 else "N/A"
    print(f"✅ Added to tracker: {company} - {role} (Cost: {cost_str})")
    return True


def error_task(task_id: str, error_message: str):
    """Mark task as errored."""
    try:
        tracker_data = load_tracker()
        if task_id in tracker_data['settings'].get('active_tasks', {}):
            tracker_data['settings']['active_tasks'][task_id].update({
                'status': 'error',
                'error_message': error_message,
                'updated_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            })
            save_tracker(tracker_data)
    except Exception as e:
        print(f"Warning: Failed to update task error: {e}")


def cancel_task(task_id: str) -> bool:
    """
    Mark task as cancelled and remove from active tasks.
    Returns True if task was found and cancelled, False otherwise.
    """
    try:
        tracker_data = load_tracker()
        active_tasks = tracker_data['settings'].get('active_tasks', {})

        if task_id not in active_tasks:
            return False

        # Mark as cancelled (keep in active_tasks briefly so UI can show status)
        tracker_data['settings']['active_tasks'][task_id].update({
            'status': 'cancelled',
            'error_message': 'Task cancelled by user',
            'updated_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        })
        save_tracker(tracker_data)

        # Remove from active tasks after a brief delay (let UI poll once)
        # The UI will see 'cancelled' status and can clean up
        return True
    except Exception as e:
        print(f"Warning: Failed to cancel task: {e}")
        return False


def remove_task(task_id: str) -> bool:
    """Remove a task from active_tasks entirely."""
    try:
        tracker_data = load_tracker()
        if task_id in tracker_data['settings'].get('active_tasks', {}):
            del tracker_data['settings']['active_tasks'][task_id]
            save_tracker(tracker_data)
            return True
        return False
    except Exception as e:
        print(f"Warning: Failed to remove task: {e}")
        return False


def get_api_key() -> str:
    """Retrieve API key from macOS Keychain."""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", "browser-applicator-api-key", "-w"],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        raise ValueError(
            "API key not found in Keychain. Add it with:\n"
            "  security add-generic-password -a \"$USER\" -s \"browser-applicator-api-key\" -w \"your-api-key\"\n"
            "Run setup to configure your LLM provider."
        )


def load_config() -> dict:
    """Load configuration from applicant.yaml."""
    config_path = Path(__file__).parent.parent / "applicant.yaml"
    if not config_path.exists():
        raise FileNotFoundError(
            f"Configuration file not found: {config_path}\n"
            "Run setup first or copy applicant.yaml.example to applicant.yaml"
        )

    with open(config_path) as f:
        return yaml.safe_load(f)


def get_llm(config: dict):
    """Initialize LLM based on provider configuration."""
    provider = config.get("llm_provider", "openrouter")
    model = config.get("llm_model", "google/gemini-2.0-flash-001")
    api_key = get_api_key()

    # Import browser-use LLM classes
    try:
        from browser_use.llm import ChatAnthropic, ChatOpenAI
    except ImportError as e:
        raise ImportError(f"Missing browser-use dependency: {e}\nRun: pip install browser-use")

    if provider == "openrouter":
        return ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
        )
    elif provider == "anthropic":
        return ChatAnthropic(
            model=model,
            api_key=api_key,
        )
    elif provider == "openai":
        return ChatOpenAI(
            model=model,
            api_key=api_key,
        )
    elif provider == "google":
        return ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        )
    else:
        raise ValueError(f"Unknown LLM provider: {provider}. Use: openrouter, anthropic, openai, or google")


# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from applicant_parser import get_applicant_context, get_applicant_info
from resume_generator import get_default_resume_path, prepare_resume

load_dotenv()


def setup_logging(job_name: str, json_mode: bool = False) -> tuple[logging.Logger, str]:
    """Setup logging to file and return logger and log path."""
    log_dir = Path(__file__).parent / "output" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_file = log_dir / f"{job_name}_{timestamp}.log"

    logger = logging.getLogger("browser-applicator")
    logger.setLevel(logging.DEBUG)

    # Clear existing handlers
    logger.handlers = []

    # File handler
    fh = logging.FileHandler(log_file)
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
    logger.addHandler(fh)

    # Console handler (only if not in JSON mode - to avoid polluting JSON output)
    if not json_mode:
        ch = logging.StreamHandler()
        ch.setLevel(logging.INFO)
        ch.setFormatter(logging.Formatter('%(message)s'))
        logger.addHandler(ch)

    return logger, str(log_file)


def extract_company_from_url(url: str) -> str:
    """Extract company name from job URL."""
    # Ashby: jobs.ashbyhq.com/company/...
    match = re.search(r'jobs\.ashbyhq\.com/([^/]+)', url)
    if match:
        return match.group(1)

    # Greenhouse: boards.greenhouse.io/company/...
    match = re.search(r'boards\.greenhouse\.io/([^/]+)', url)
    if match:
        return match.group(1)

    # Lever: jobs.lever.co/company/...
    match = re.search(r'jobs\.lever\.co/([^/]+)', url)
    if match:
        return match.group(1)

    # Generic: try to extract domain
    match = re.search(r'https?://([^/]+)', url)
    if match:
        return match.group(1).replace('.', '_')

    return "unknown"


def fetch_role_from_url(url: str) -> str:
    """Fetch job role/title from the job URL by requesting the page."""
    import urllib.request
    import urllib.error

    try:
        # Quick request to get page title
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8', errors='ignore')[:10000]  # Only read first 10KB

            # Try og:title first (most reliable)
            og_match = re.search(r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']', html, re.IGNORECASE)
            if og_match:
                title = og_match.group(1)
                # Clean up: often format is "Role - Company" or "Role at Company"
                role = re.split(r'\s*[-–—@|]\s*', title)[0].strip()
                if role and len(role) > 2:
                    return role

            # Try page title
            title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
            if title_match:
                title = title_match.group(1)
                role = re.split(r'\s*[-–—@|]\s*', title)[0].strip()
                if role and len(role) > 2:
                    return role

    except (urllib.error.URLError, TimeoutError, Exception):
        pass  # Fail silently, will use "Unknown Role"

    return "Unknown Role"


async def apply_to_job(
    job_url: str,
    resume_path: str,
    logger: logging.Logger,
    config: dict,
    json_mode: bool = False
) -> dict:
    """
    Apply to a job posting using browser-use.

    Returns dict with:
        - success: bool
        - company: str
        - role: str (if found)
        - screenshot: str (path to confirmation screenshot)
        - error: str (if failed)
        - task_id: str (active task ID)
    """
    # Import browser-use here to avoid import errors if not installed
    try:
        from browser_use import Agent, Browser
    except ImportError as e:
        logger.error(f"Missing dependency: {e}")
        logger.error("Run: pip install browser-use")
        return {"success": False, "error": f"Missing dependency: {e}"}

    company = extract_company_from_url(job_url)
    logger.info(f"Applying to {company}")

    # Fetch role from job page
    role = fetch_role_from_url(job_url)
    logger.info(f"Role: {role}")

    # Create active task with fetched role
    task_id = create_active_task(company, role, job_url)
    logger.info(f"Created active task: {task_id}")

    # Get applicant info from config
    try:
        applicant = get_applicant_info(config)
        logger.info(f"Applicant: {applicant['name']}")
    except Exception as e:
        logger.error(f"Failed to get applicant info: {e}")
        return {"success": False, "error": str(e), "company": company}

    # Prepare resume
    try:
        prepared_resume = prepare_resume(resume_path, config)
        logger.info(f"Resume prepared: {prepared_resume}")
    except Exception as e:
        logger.error(f"Failed to prepare resume: {e}")
        return {"success": False, "error": str(e), "company": company}

    # Get applicant context for custom questions
    applicant_context = get_applicant_context(config)

    # Setup screenshot path
    screenshot_dir = Path(__file__).parent / "output" / "screenshots"
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    screenshot_path = screenshot_dir / f"{company}_{timestamp}.png"

    # Work authorization from config
    authorized_us = config.get("authorized_to_work_us", True)
    requires_sponsorship = config.get("requires_sponsorship", False)

    # Build the agent task
    task = f"""
Apply to this job posting: {job_url}

## Applicant Information (use exactly as provided)
- Full Name: {applicant['name']}
- Email: {applicant['email']}
- Phone: {applicant['phone']}
- Location: {applicant['location']}
- LinkedIn: {applicant['linkedin']}

## Resume File
Upload this file for the resume: {prepared_resume}

## Applicant Background (use for answering custom questions)
{applicant_context}

## Step-by-Step Instructions

1. **Navigate**: Go to {job_url}

2. **EARLY EXIT CHECK - Email Verification Blocker**:
   - After page loads, check if you see ANY of these:
     - "Enter security code" or "Verification code"
     - "Check your email for a code"
     - "We've sent you a code"
   - If you see ANY email verification requirement, immediately STOP and report:
     "FAILURE: This application requires email verification which cannot be completed automatically."
   - Do NOT attempt to proceed with such applications

3. **Application Tab**: Click "Application" tab if the page shows job description first

4. **CRITICAL - Scan for ALL required fields FIRST**:
   - Scroll through the ENTIRE form before filling anything
   - Required fields are marked with * (asterisk) or say "required"
   - Note all required fields so you don't miss any

4. **Standard Fields**: Fill out these fields exactly as provided:
   - Name/Legal Name/Full Name: {applicant['name']}
   - Email: {applicant['email']}
   - Phone: {applicant['phone']}
   - Location (if asked): {applicant['location']}

5. **Resume Upload**:
   - Find the Resume upload field (usually has "Upload File" button)
   - Use upload_file action with path: {prepared_resume}

6. **LinkedIn**: Enter {applicant['linkedin']} in LinkedIn/Social Profile field

7. **Work Authorization & Policy Questions (CRITICAL - these are common failure points)**:

   **IMPORTANT: How to click Ashby radio buttons (THESE ARE CUSTOM COMPONENTS):**
   - Ashby uses custom React radio buttons - clicking spans/labels often doesn't work
   - For Yes/No button pairs (segmented controls): Click directly on the button element
   - For radio button lists: You MUST click the actual INPUT element (type="radio"), NOT the span or label
   - To find the input: Look for elements with role="radio" or input[type="radio"] - they have lower element indices than the visible labels
   - After clicking, WAIT 2 seconds for the selection to register
   - Verify the selection shows as active (filled circle, aria-checked="true") before moving on
   - IF CLICKS DON'T WORK after 2 attempts: Use JavaScript execution to select the radio:
     document.querySelector('input[name="sponsorship"][value="no"]').click()
     Or: document.querySelectorAll('input[type="radio"]')[index].click()

   **Answer these questions as follows:**
   - "Are you legally authorized to work in the United States?" → Click {"Yes" if authorized_us else "No"}
   - "Will you now or in the future require employment visa sponsorship?" → Click the radio button for "{"Yes, I will require [company] to sponsor my employment" if requires_sponsorship else "No, I do not require sponsorship to work in the United States"}"

   **Hybrid/Remote Work Policy Questions (common on Ashby forms):**
   - "Are you able to work from the office X days a week?" or similar hybrid questions → Click "Yes, I'm able to work from the office" option (first option usually)
   - "Which office would you be able to work from?" → Click "San Francisco" or the first listed office location
   - If asked about relocation: Select "I'm open to relocating" or the SF option

   **After answering each radio button question:**
   - Scroll the question into full view
   - Click the option text (not just the radio circle)
   - Wait 1 second
   - Visually confirm the radio button is now filled/selected before proceeding

8. **Custom Questions** (answer ALL that have asterisks or say required):
   - Use the applicant background above to write thoughtful, relevant answers
   - Keep answers concise (2-3 sentences unless more space is clearly needed)
   - Connect experience to the company's domain when possible
   - For "Why this company?": I am excited about [company]'s mission and believe my experience in [relevant domain] aligns well with this role.
   - For "years of experience": 10+
   - For salary expectations: Open to discussing based on total compensation

9. **Demographic/EEO Questions**:
   - Select "Decline to self-identify" or "I don't wish to answer" or "I prefer not to answer" for all

10. **Marketing/Communication Consent**:
    - Decline or uncheck any options for marketing emails, newsletters, or promotional communications
    - Only accept communications strictly necessary for the application process

11. **Before Submitting - Verify**:
    - Scroll through entire form one more time
    - Look for any error messages or unfilled required fields
    - If there are validation errors, fix them before submitting

12. **Submit**: Click the Submit Application button

13. **CRITICAL - Verify Submission and Fix ALL Errors (DO NOT SKIP)**:
    - After clicking Submit, WAIT 8 seconds for the page to fully update
    - Scroll to TOP of page to check for error messages
    - Then carefully READ the page content to determine if submission succeeded

    - **IMMEDIATE FAILURE - Email Verification**:
      - If you see "security code", "verification code", "check your email", or "enter code":
        → Report "FAILURE: Email verification required" and STOP immediately

    - **ERROR RESOLUTION - DO NOT SUBMIT AGAIN UNTIL ALL ERRORS FIXED**:
      - If you see error banner like "Your form needs corrections" or any red error messages:
        1. READ AND LIST every single error message on the page
        2. For EACH error message, find the corresponding field
        3. Fill/fix that specific field with the correct value
        4. After fixing ALL errors, scroll through form to verify no errors remain
        5. ONLY THEN click Submit again

      - Common errors and how to fix them:
        * "Missing entry for required field: Location" → Fill location field with "San Francisco, California"
        * "Missing entry for required field: Can you provide proof of authorization" → Click "Yes" button
        * "Missing entry for required field: Will you now or in the future require employer sponsorship" → Find the radio button question, click the "No, I do not require sponsorship" text label
        * "Missing entry for required field: [hybrid/office policy question]" → Find the hybrid policy question, click "Yes, I'm able to work from the office 3 days a week" text label
        * "Missing entry for required field: Which of [company]'s offices" → Find the office selection, click "San Francisco" option text
        * "Missing entry for required field: [field name]" → Scroll to find that field and fill it
        * Any dropdown showing "Select..." → Click it and choose appropriate option
        * Any checkbox that says "required" → Check it if appropriate

      - FOR RADIO BUTTONS THAT DIDN'T REGISTER:
        1. Scroll the question fully into view
        2. Find the INPUT element (type="radio") not the span/label, and click IT directly
        3. If no input element visible, look for the clickable circle/dot element
        4. Wait 2 seconds
        5. Look at the radio circle - it should now be filled/solid
        6. If clicking still fails after 2 attempts, use JavaScript to select:
           - Find the input element by its value/name attribute
           - Use: document.querySelector('input[value="..."]').click()
           - Or: element.checked = true; element.dispatchEvent(new Event('change', {bubbles: true}))

      - You MUST resolve every single bullet point in error messages before clicking Submit again
      - After fixing errors, verify by scrolling through form that no red text or error messages remain

    - **SUCCESS indicators** (must see at least one of these):
      - "Thank you" or "Thanks for applying" or "Application received"
      - "Application submitted" or "Successfully submitted"
      - "We'll be in touch" or "We will review" or "We'll contact you"
      - Form has completely disappeared (replaced with confirmation page)
      - Page URL changed to a "submitted" or "thank-you" page
      - A green checkmark or success icon with confirmation text
      - NO error messages or red text visible anywhere on page

    - **FAILURE indicators** (if ANY of these, submission FAILED):
      - Email verification code request
      - Form still visible with same input fields
      - Red error text or validation messages STILL present after fixes
      - "Required" warnings next to fields
      - "Please complete" or "Please fill" messages
      - Error banner still showing "Your form needs corrections"
      - Page looks identical to before clicking Submit

    - Maximum 5 submit attempts allowed - fix errors and retry each time
    - After 5 failed submit attempts, report exact remaining errors and STOP

14. **If Submit Fails**:
    - Read any error messages carefully
    - Scroll up to find missed required fields
    - Fill any missing fields and try again
    - After 3 failed attempts, report what's missing and stop

## Important Notes
- REQUIRED FIELDS: Look for asterisks (*) or "required" text - these MUST be filled
- Do not skip any required fields - make your best attempt
- If a field has options, choose the most appropriate one
- If submission fails repeatedly, check for validation errors at the top of the form

## Output (MUST include all of the following)
When complete, provide:
- SUCCESS or FAILURE (based on what you SAW on the page after submit, not what you think happened)
- What confirmation message you saw (quote the exact text if possible)
- If FAILURE: what error messages or issues you observed
- The job role/title
"""

    # Initialize browser and agent
    try:
        llm = get_llm(config)
    except Exception as e:
        logger.error(f"Failed to initialize LLM: {e}")
        return {"success": False, "error": str(e), "company": company}

    # Maximum stealth configuration with persistent profile
    # Use a persistent user data directory to maintain cookies/sessions across runs
    user_data_dir = Path(__file__).parent / "output" / "sourabh_katti_profile"
    user_data_dir.mkdir(parents=True, exist_ok=True)

    # Configure browser with extended timeouts
    import os
    # Suppress browser-use logs in JSON mode to avoid polluting JSON output
    os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'ERROR' if json_mode else 'INFO'

    # Check for cloud browser option (better anti-detection)
    use_cloud = os.environ.get('BROWSER_USE_CLOUD', '').lower() == 'true'

    if use_cloud:
        # Cloud browser has better stealth capabilities
        browser = Browser(use_cloud=True)
        logger.info("Using cloud browser for better stealth")
    else:
        # Local browser with stealth configuration
        # Using persistent profile helps with reCAPTCHA trust score
        browser = Browser(
            headless=False,
            user_data_dir=str(user_data_dir),
            # Slow down interactions to appear more human-like
            minimum_wait_page_load_time=1.5,
            wait_for_network_idle_page_load_time=2.5,
            wait_between_actions=0.5,
        )

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        available_file_paths=[prepared_resume],
        max_time_seconds=240,  # 4 minutes timeout for entire application
        max_actions_per_step=30,  # Allow more actions per step for complex forms
    )

    try:
        logger.info("Starting browser-use agent...")
        update_task_progress(task_id, "Running browser automation", 10)

        history = await agent.run()

        update_task_progress(task_id, "Processing results", 90)

        # Extract cost information from browser-use history
        total_cost = 0.0
        total_input_tokens = 0
        total_output_tokens = 0
        try:
            # browser-use history object tracks token usage
            if hasattr(history, 'total_input_tokens'):
                total_input_tokens = history.total_input_tokens() if callable(history.total_input_tokens) else history.total_input_tokens
            if hasattr(history, 'total_output_tokens'):
                total_output_tokens = history.total_output_tokens() if callable(history.total_output_tokens) else history.total_output_tokens

            # Estimate cost based on model (approximate pricing)
            # OpenRouter Gemini 2.0 Flash: ~$0.10/1M input, ~$0.40/1M output
            # Anthropic Claude Sonnet: ~$3/1M input, ~$15/1M output
            provider = config.get("llm_provider", "openrouter")
            model = config.get("llm_model", "").lower()

            if "gemini" in model:
                # Google Gemini pricing (very cheap)
                total_cost = (total_input_tokens * 0.0000001) + (total_output_tokens * 0.0000004)
            elif "claude" in model or provider == "anthropic":
                # Anthropic Claude pricing
                total_cost = (total_input_tokens * 0.000003) + (total_output_tokens * 0.000015)
            elif "gpt-4" in model:
                # OpenAI GPT-4 pricing
                total_cost = (total_input_tokens * 0.00003) + (total_output_tokens * 0.00006)
            else:
                # Default estimate
                total_cost = (total_input_tokens * 0.000001) + (total_output_tokens * 0.000002)

            logger.info(f"Cost estimate: ${total_cost:.4f} ({total_input_tokens} in / {total_output_tokens} out tokens)")
        except Exception as cost_error:
            logger.warning(f"Could not extract cost: {cost_error}")

        # Update task with cost information
        update_task_cost(task_id, total_cost, total_input_tokens, total_output_tokens)

        # Try to take final screenshot if possible
        try:
            if hasattr(agent, 'browser_session') and agent.browser_session:
                page = await agent.browser_session.get_current_page()
                if page:
                    await page.screenshot(path=str(screenshot_path))
                    logger.info(f"Screenshot saved: {screenshot_path}")
        except Exception as screenshot_error:
            logger.warning(f"Could not take screenshot: {screenshot_error}")

        result = history.final_result()
        logger.info(f"Agent result: {result}")

        # Parse success from result
        success = False
        role = "Unknown"

        if result:
            result_lower = result.lower()
            # Require explicit confirmation signals - the agent must have seen a confirmation page
            confirmation_signals = ['thank you', 'thanks for applying', 'application received',
                                    'application submitted', 'we will review', "we'll be in touch",
                                    'successfully submitted', 'has been submitted', 'submitted successfully',
                                    'success:', 'the application was submitted', 'no longer visible']
            failure_signals = ['not found', 'job not found', 'unable to submit', 'could not',
                              'failed', 'error', 'captcha', 'without the resume',
                              'missing required', 'validation', 'spam', 'failure:']

            has_confirmation = any(signal in result_lower for signal in confirmation_signals)
            has_failure = any(signal in result_lower for signal in failure_signals)

            # Only count as success if we see confirmation AND no failure signals
            if has_confirmation and not has_failure:
                success = True

            # Try to extract role
            role_match = re.search(r'(product manager|pm|engineer|designer|analyst|director)[^,\n]*', result_lower, re.IGNORECASE)
            if role_match:
                role = role_match.group(0).title()

        return {
            "success": success,
            "company": company,
            "role": role,
            "screenshot": str(screenshot_path) if screenshot_path.exists() else None,
            "agent_result": result,
            "task_id": task_id,
            "cost": total_cost,
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens
        }

    except Exception as e:
        logger.error(f"Agent error: {e}")
        error_task(task_id, str(e))
        return {
            "success": False,
            "company": company,
            "error": str(e),
            "screenshot": str(screenshot_path) if screenshot_path.exists() else None,
            "task_id": task_id
        }


async def main():
    parser = argparse.ArgumentParser(
        description="Apply to job postings that require file uploads",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python apply.py "https://jobs.ashbyhq.com/ramp/9972df9e-..."
    python apply.py "https://boards.greenhouse.io/company/jobs/123" --resume ~/resume.pdf
        """
    )
    parser.add_argument(
        "url",
        help="Job posting URL"
    )
    parser.add_argument(
        "--resume",
        default=None,
        help="Path to resume file (PDF or text). Defaults to value in applicant.yaml."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output result as JSON only (for programmatic use)"
    )

    args = parser.parse_args()

    # Load configuration
    try:
        config = load_config()
    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)

    # Get resume path
    resume_path = args.resume if args.resume else config.get("resume_path") or get_default_resume_path()

    # Setup logging
    company = extract_company_from_url(args.url)
    logger, log_path = setup_logging(company, json_mode=args.json)

    logger.info("Browser Applicator")
    logger.info(f"URL: {args.url}")
    logger.info(f"Resume: {resume_path}")
    logger.info(f"Log: {log_path}")
    logger.info("-" * 50)

    # Run application
    result = await apply_to_job(args.url, resume_path, logger, config, json_mode=args.json)
    result["log"] = log_path

    # Add to tracker if successful
    if result.get("success"):
        complete_task(
            task_id=result.get("task_id"),
            company=result.get("company", company),
            role=result.get("role", "Unknown Role"),
            job_url=args.url,
            agent_result=result.get("agent_result"),
            cost=result.get("cost", 0.0),
            input_tokens=result.get("input_tokens", 0),
            output_tokens=result.get("output_tokens", 0)
        )

    # Output result
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("\n" + "=" * 50)
        print("APPLICATION RESULT")
        print("=" * 50)
        if result.get("success"):
            print(f"SUCCESS: Applied to {result.get('company')} - {result.get('role', 'Unknown Role')}")
        else:
            print(f"FAILED: {result.get('error', 'Unknown error')}")
        print(f"Screenshot: {result.get('screenshot', 'N/A')}")
        print(f"Log: {result.get('log')}")
        print("=" * 50)

    # Exit with appropriate code
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    asyncio.run(main())
