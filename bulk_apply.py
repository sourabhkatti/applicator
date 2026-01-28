#!/usr/bin/env python3
"""
Bulk job application script.
Extracts jobs from hiring.cafe and applies to each with tailored resume.
"""

import asyncio
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright


async def extract_job_urls_from_hiringcafe(search_url: str, limit: int = 25) -> list[dict]:
    """Extract job URLs from hiring.cafe search page using browser automation."""
    jobs = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print(f"Loading hiring.cafe search page...")
        await page.goto(search_url, wait_until="networkidle", timeout=60000)
        await asyncio.sleep(3)  # Let page fully load

        # Scroll to load more jobs
        for _ in range(3):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(2)

        # Find all job cards and extract info
        job_cards = await page.query_selector_all('[class*="JobCard"]')

        if not job_cards:
            # Try alternative selectors
            job_cards = await page.query_selector_all('article')

        print(f"Found {len(job_cards)} job cards on page")

        for i, card in enumerate(job_cards[:limit]):
            try:
                # Try to click on the job card to open details
                await card.click()
                await asyncio.sleep(1)

                # Look for "Apply now" button and extract href
                apply_button = await page.query_selector('a[href*="greenhouse"], a[href*="ashbyhq"], a[href*="lever"], button:has-text("Apply now")')

                if apply_button:
                    # Get the href or click and check new tab
                    href = await apply_button.get_attribute('href')

                    if not href:
                        # Button click opens new tab
                        async with page.expect_popup() as popup_info:
                            await apply_button.click()
                            popup = await popup_info.value
                            await popup.wait_for_load_state()
                            href = popup.url
                            await popup.close()

                    if href and any(domain in href for domain in ['greenhouse.io', 'ashbyhq.com', 'lever.co', 'jobs.', 'careers.']):
                        # Extract job title and company from card
                        title_elem = await card.query_selector('h3, h2, [class*="title"]')
                        company_elem = await card.query_selector('[class*="company"], [data-testid="company-name"]')

                        title = await title_elem.inner_text() if title_elem else "Unknown"
                        company = await company_elem.inner_text() if company_elem else "Unknown"

                        jobs.append({
                            'url': href,
                            'title': title.strip(),
                            'company': company.strip()
                        })
                        print(f"  [{len(jobs)}] {company.strip()} - {title.strip()}")

                # Close job detail panel if open
                close_button = await page.query_selector('button[aria-label="Close"], [class*="close"]')
                if close_button:
                    await close_button.click()
                    await asyncio.sleep(0.5)

            except Exception as e:
                print(f"  Error extracting job {i+1}: {e}")
                continue

        await browser.close()

    return jobs


def tailor_resume(job_description: str) -> str:
    """Run ATS optimizer to tailor resume for job description."""
    print("  Tailoring resume with ATS optimizer...")

    try:
        result = subprocess.run(
            ['python3', '/Users/sourabhkatti/applicator/auto-applicator/ats_optimizer.py', job_description],
            capture_output=True,
            text=True,
            timeout=120
        )

        if result.returncode == 0:
            # Check that optimized resume was created
            optimized_path = Path('/Users/sourabhkatti/applicator/auto-applicator/resume_optimized.txt')
            if optimized_path.exists():
                print("  ✓ Resume tailored successfully")
                return str(optimized_path)
            else:
                print("  ✗ Resume optimizer didn't create output file")
                return None
        else:
            print(f"  ✗ ATS optimizer failed: {result.stderr}")
            return None

    except subprocess.TimeoutExpired:
        print("  ✗ ATS optimizer timed out")
        return None
    except Exception as e:
        print(f"  ✗ Error running ATS optimizer: {e}")
        return None


async def get_job_description_from_url(url: str) -> str:
    """Fetch job description from application URL."""
    print(f"  Fetching job description from {url}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            await page.goto(url, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(2)

            # Get main text content
            text = await page.evaluate('''() => {
                // Try to find the main job description area
                const main = document.querySelector('main, [role="main"], #content, .job-description');
                return main ? main.innerText : document.body.innerText;
            }''')

            await browser.close()
            return text[:8000]  # Limit to first 8000 chars for ATS optimizer

        except Exception as e:
            print(f"  ✗ Error fetching job description: {e}")
            await browser.close()
            return None


def apply_to_job(job_url: str) -> dict:
    """Apply to job using browser-applicator script."""
    print(f"  Applying via browser-applicator...")

    try:
        result = subprocess.run(
            ['python3', '/Users/sourabhkatti/applicator/browser-applicator/apply.py', job_url, '--json'],
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout per application
        )

        if result.stdout:
            return json.loads(result.stdout)
        else:
            return {
                'success': False,
                'error': result.stderr or 'No output from browser-applicator'
            }

    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Application timed out after 5 minutes'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


async def main():
    search_url = sys.argv[1] if len(sys.argv) > 1 else None
    target_applications = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    if not search_url:
        print("Usage: python bulk_apply.py <hiring_cafe_search_url> [num_applications]")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"BULK JOB APPLICATION")
    print(f"Target: {target_applications} applications")
    print(f"{'='*60}\n")

    # Step 1: Extract job URLs from hiring.cafe
    print(f"[1/3] Extracting jobs from hiring.cafe...")
    jobs = await extract_job_urls_from_hiringcafe(search_url, limit=target_applications + 10)

    if not jobs:
        print("\n✗ No jobs found. Check the search URL and try again.")
        sys.exit(1)

    print(f"\n✓ Found {len(jobs)} jobs")

    # Step 2: Apply to each job
    print(f"\n[2/3] Applying to jobs with tailored resumes...")
    successful_applications = []
    failed_applications = []

    for i, job in enumerate(jobs[:target_applications], 1):
        print(f"\n--- Job {i}/{target_applications}: {job['company']} - {job['title']} ---")
        print(f"  URL: {job['url']}")

        # Get job description
        job_description = await get_job_description_from_url(job['url'])

        if not job_description:
            print("  ✗ Skipping - couldn't fetch job description")
            failed_applications.append({**job, 'error': 'Could not fetch job description'})
            continue

        # Tailor resume
        tailored_resume = tailor_resume(job_description)

        if not tailored_resume:
            print("  ✗ Skipping - resume tailoring failed")
            failed_applications.append({**job, 'error': 'Resume tailoring failed'})
            continue

        # Apply using browser-applicator
        result = apply_to_job(job['url'])

        if result.get('success'):
            print(f"  ✓ APPLICATION SUCCESSFUL!")
            successful_applications.append({**job, **result})
        else:
            error = result.get('error', 'Unknown error')
            print(f"  ✗ Application failed: {error}")
            failed_applications.append({**job, 'error': error})

        # Small delay between applications
        if i < target_applications:
            await asyncio.sleep(5)

    # Step 3: Summary
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"✓ Successful: {len(successful_applications)}")
    print(f"✗ Failed: {len(failed_applications)}")

    if successful_applications:
        print(f"\nSuccessful applications:")
        for app in successful_applications:
            print(f"  - {app['company']} - {app['title']}")

    if failed_applications:
        print(f"\nFailed applications:")
        for app in failed_applications:
            print(f"  - {app['company']} - {app['title']}: {app.get('error', 'Unknown')}")

    print(f"\n{'='*60}")
    print(f"Total verified applications in tracker: {len(successful_applications)}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    asyncio.run(main())
