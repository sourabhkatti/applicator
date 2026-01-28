#!/usr/bin/env python3
"""
Extract job URLs from hiring.cafe and apply to each systematically.
"""

import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright


async def extract_jobs_from_hiringcafe(url: str) -> list[str]:
    """Extract all job application URLs from hiring.cafe."""
    job_urls = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print("Loading hiring.cafe...")
        await page.goto(url, wait_until="networkidle", timeout=60000)
        await asyncio.sleep(3)

        # Scroll to load more jobs
        print("Scrolling to load all jobs...")
        for i in range(5):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(2)
            print(f"  Scroll {i+1}/5")

        # Find all "Apply now" buttons and extract job URLs
        print("\nExtracting job URLs...")
        apply_buttons = await page.query_selector_all('a[href*="Apply now"], a:has-text("Apply now")')

        for button in apply_buttons:
            href = await button.get_attribute('href')
            if href:
                job_urls.append(href)

        # If that didn't work, try clicking job cards to reveal URLs
        if not job_urls:
            print("Trying alternative extraction method...")
            job_cards = await page.query_selector_all('[class*="JobCard"], article, [data-testid*="job"]')

            for i, card in enumerate(job_cards[:30]):  # Limit to first 30
                try:
                    await card.click()
                    await asyncio.sleep(1)

                    # Look for apply button in modal
                    apply_link = await page.query_selector('a[href*="greenhouse"], a[href*="ashbyhq"], a[href*="lever"]')

                    if apply_link:
                        href = await apply_link.get_attribute('href')
                        if href and href not in job_urls:
                            job_urls.append(href)
                            print(f"  Found job #{len(job_urls)}: {href[:80]}...")

                    # Close modal
                    close_btn = await page.query_selector('button[aria-label="Close"], [class*="close"]')
                    if close_btn:
                        await close_btn.click()
                        await asyncio.sleep(0.5)

                except Exception as e:
                    continue

        await browser.close()

    return job_urls


def apply_to_job_with_tailored_resume(job_url: str, job_num: int) -> dict:
    """Apply to a job with tailored resume."""
    print(f"\n{'='*70}")
    print(f"JOB #{job_num}: {job_url}")
    print(f"{'='*70}")

    # Step 1: Get job description
    print("[1/3] Fetching job description...")
    try:
        result = subprocess.run(
            ['python3', '-c', f'''
import asyncio
from playwright.async_api import async_playwright

async def get_desc():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("{job_url}", timeout=30000)
        await page.wait_for_load_state()
        text = await page.evaluate("document.body.innerText")
        await browser.close()
        print(text[:6000])

asyncio.run(get_desc())
'''],
            capture_output=True,
            text=True,
            timeout=45
        )
        job_desc = result.stdout[:6000]
    except Exception as e:
        print(f"  ✗ Failed to fetch job description: {e}")
        return {'success': False, 'error': 'Failed to fetch job description', 'url': job_url}

    # Step 2: Tailor resume
    print("[2/3] Tailoring resume...")
    try:
        result = subprocess.run(
            ['python3', 'auto-applicator/ats_optimizer.py', job_desc],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode != 0:
            print(f"  ✗ ATS optimizer failed")
            return {'success': False, 'error': 'Resume tailoring failed', 'url': job_url}
        print("  ✓ Resume tailored")
    except Exception as e:
        print(f"  ✗ Resume tailoring error: {e}")
        return {'success': False, 'error': str(e), 'url': job_url}

    # Step 3: Apply using browser-applicator
    print("[3/3] Applying via browser-applicator...")
    try:
        result = subprocess.run(
            ['python3', 'browser-applicator/apply.py', job_url, '--json'],
            capture_output=True,
            text=True,
            timeout=300
        )

        if result.stdout:
            app_result = json.loads(result.stdout)
            if app_result.get('success'):
                print(f"  ✓ APPLICATION SUCCESSFUL")
                return {**app_result, 'url': job_url}
            else:
                error = app_result.get('error', 'Unknown error')
                print(f"  ✗ Application failed: {error}")
                return {**app_result, 'url': job_url}
        else:
            print(f"  ✗ No output from browser-applicator")
            return {'success': False, 'error': 'No output', 'url': job_url}

    except subprocess.TimeoutExpired:
        print(f"  ✗ Application timed out")
        return {'success': False, 'error': 'Timeout', 'url': job_url}
    except Exception as e:
        print(f"  ✗ Application error: {e}")
        return {'success': False, 'error': str(e), 'url': job_url}


async def main():
    if len(sys.argv) < 2:
        print("Usage: python extract_and_apply.py <hiring_cafe_url> [target_apps]")
        sys.exit(1)

    hiring_cafe_url = sys.argv[1]
    target_applications = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    print(f"\n{'='*70}")
    print(f"BULK JOB APPLICATION - TARGET: {target_applications} SUCCESSFUL APPS")
    print(f"{'='*70}\n")

    # Extract job URLs
    job_urls = await extract_jobs_from_hiringcafe(hiring_cafe_url)

    if not job_urls:
        print("\n✗ No job URLs found. Please check the URL and try again.")
        sys.exit(1)

    print(f"\n✓ Extracted {len(job_urls)} job URLs\n")

    # Apply to jobs until we hit target
    successful = []
    failed = []

    for i, url in enumerate(job_urls, 1):
        if len(successful) >= target_applications:
            print(f"\n✓ REACHED TARGET: {target_applications} successful applications!")
            break

        result = apply_to_job_with_tailored_resume(url, i)

        if result.get('success'):
            successful.append(result)
            print(f"\n[PROGRESS: {len(successful)}/{target_applications} successful]")
        else:
            failed.append(result)

        # Small delay between applications
        if i < len(job_urls):
            time.sleep(3)

    # Summary
    print(f"\n\n{'='*70}")
    print(f"FINAL SUMMARY")
    print(f"{'='*70}")
    print(f"✓ Successful: {len(successful)}")
    print(f"✗ Failed: {len(failed)}")
    print(f"\nSuccessful applications:")
    for app in successful:
        company = app.get('company', 'Unknown')
        role = app.get('role', 'Unknown')
        print(f"  - {company} - {role}")

    print(f"\n{'='*70}\n")

    if len(successful) < target_applications:
        print(f"⚠️  Only reached {len(successful)}/{target_applications} successful applications")
        print(f"   Ran out of job URLs. Please provide more jobs or adjust target.")


if __name__ == '__main__':
    asyncio.run(main())
