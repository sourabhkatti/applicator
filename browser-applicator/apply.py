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
from datetime import datetime
from pathlib import Path

import yaml
from dotenv import load_dotenv


def add_to_tracker(job_url: str, company: str, role: str, agent_result: str = None) -> bool:
    """
    Add a successful application to the job tracker.

    Returns True if added successfully, False otherwise.
    """
    tracker_path = Path(__file__).parent.parent / "tracker" / "jobs.json"

    if not tracker_path.exists():
        # Initialize tracker if it doesn't exist
        tracker_data = {"settings": {"followUpDays": 2}, "jobs": []}
    else:
        try:
            with open(tracker_path, 'r') as f:
                tracker_data = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: Could not read tracker: {e}")
            return False

    # Check if job already exists (by URL)
    existing_urls = [job.get("jobUrl", "") for job in tracker_data.get("jobs", [])]
    if job_url in existing_urls:
        print(f"Job already in tracker: {job_url}")
        return True

    # Create new job entry
    today = datetime.now().strftime("%Y-%m-%d")
    new_job = {
        "id": str(uuid.uuid4()).upper(),
        "company": company.replace("-", " ").replace("_", " ").title(),
        "role": role,
        "status": "applied",
        "dateApplied": today,
        "nextAction": "Wait for response",
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
        "lastActivityDate": today,
        "followUpBy": None,
        "notes": f"Applied via browser-applicator. {agent_result[:200] if agent_result else ''}".strip(),
        "companyResearch": None,
        "prepChecklist": {
            "companyResearch": False,
            "starStories": False,
            "questionsReady": False,
            "technicalPrep": False
        },
        "offer": None
    }

    # Add to jobs list
    tracker_data["jobs"].append(new_job)

    # Write back to file
    try:
        with open(tracker_path, 'w') as f:
            json.dump(tracker_data, f, indent=2)
        print(f"✓ Added to tracker: {company} - {role}")
        return True
    except IOError as e:
        print(f"Warning: Could not write to tracker: {e}")
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


def setup_logging(job_name: str) -> tuple[logging.Logger, str]:
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

    # Console handler
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


async def apply_to_job(
    job_url: str,
    resume_path: str,
    logger: logging.Logger,
    config: dict
) -> dict:
    """
    Apply to a job posting using browser-use.

    Returns dict with:
        - success: bool
        - company: str
        - role: str (if found)
        - screenshot: str (path to confirmation screenshot)
        - error: str (if failed)
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
2. **Application Tab**: Click "Application" tab if the page shows job description first

3. **CRITICAL - Scan for ALL required fields FIRST**:
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

7. **Work Authorization Questions**:
   - "Legally authorized to work in US?" → Select {"YES" if authorized_us else "NO"}
   - "Require visa sponsorship?" → Select {"YES" if requires_sponsorship else "NO"}

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

13. **If Submit Fails**:
    - Read any error messages carefully
    - Scroll up to find missed required fields
    - Fill any missing fields and try again
    - After 3 failed attempts, report what's missing and stop

14. **Confirmation**:
    - Wait for the confirmation/thank you page to load
    - Extract the job role/title if visible

## Important Notes
- REQUIRED FIELDS: Look for asterisks (*) or "required" text - these MUST be filled
- Do not skip any required fields - make your best attempt
- If a field has options, choose the most appropriate one
- If submission fails repeatedly, check for validation errors at the top of the form

## Output
When complete, provide:
- Whether the application was successfully submitted
- The job role/title
- Any error messages encountered
"""

    # Initialize browser and agent
    try:
        llm = get_llm(config)
    except Exception as e:
        logger.error(f"Failed to initialize LLM: {e}")
        return {"success": False, "error": str(e), "company": company}

    browser = Browser()

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        available_file_paths=[prepared_resume],
    )

    try:
        logger.info("Starting browser-use agent...")
        history = await agent.run()

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
            if any(word in result_lower for word in ['success', 'submitted', 'thank you', 'confirmation', 'received']):
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
            "agent_result": result
        }

    except Exception as e:
        logger.error(f"Agent error: {e}")
        return {
            "success": False,
            "company": company,
            "error": str(e),
            "screenshot": str(screenshot_path) if screenshot_path.exists() else None
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
    logger, log_path = setup_logging(company)

    logger.info("Browser Applicator")
    logger.info(f"URL: {args.url}")
    logger.info(f"Resume: {resume_path}")
    logger.info(f"Log: {log_path}")
    logger.info("-" * 50)

    # Run application
    result = await apply_to_job(args.url, resume_path, logger, config)
    result["log"] = log_path

    # Add to tracker if successful
    if result.get("success"):
        add_to_tracker(
            job_url=args.url,
            company=result.get("company", company),
            role=result.get("role", "Unknown Role"),
            agent_result=result.get("agent_result")
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
