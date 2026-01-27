#!/usr/bin/env python3
"""
LinkedIn Job Search Scraper

Searches LinkedIn for jobs matching applicant.yaml preferences.
Returns a list of job URLs that can be passed to the batch applicator.

Usage:
    python linkedin_search.py [--count 30] [--output urls.txt]

Requirements:
    pip install playwright pyyaml
    playwright install chromium
"""

import argparse
import asyncio
import json
import random
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus, urlencode

import yaml

# Optional playwright import with helpful error message
try:
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("Error: playwright not installed.")
    print("Install with: pip install playwright && playwright install chromium")
    sys.exit(1)


def load_config():
    """Load applicant configuration."""
    config_path = Path(__file__).parent.parent / "applicant.yaml"
    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")

    with open(config_path) as f:
        return yaml.safe_load(f)


def build_linkedin_search_url(config: dict) -> str:
    """Build LinkedIn job search URL from config preferences."""
    base_url = "https://www.linkedin.com/jobs/search/"

    # Get search keywords from target roles
    target_roles = config.get('target_roles', [])
    keywords = target_roles[0] if target_roles else "Product Manager"

    # Build query parameters
    params = {
        'keywords': keywords,
        'refresh': 'true',
        'sortBy': 'R',  # Sort by relevance
    }

    # Location preference
    location = config.get('location', '')
    if location:
        params['location'] = location

    # Remote/hybrid filter (f_WT)
    # 1 = On-site, 2 = Remote, 3 = Hybrid
    location_pref = config.get('location_preference', '').lower()
    if 'remote' in location_pref:
        params['f_WT'] = '2'
    elif 'hybrid' in location_pref:
        params['f_WT'] = '3'

    # Experience level (f_E) - optional
    # 2 = Entry, 3 = Associate, 4 = Mid-Senior, 5 = Director, 6 = Executive

    # Time filter - posted in last week (f_TPR)
    params['f_TPR'] = 'r604800'  # Last week

    return f"{base_url}?{urlencode(params)}"


def should_exclude_job(job_url: str, company_name: str, config: dict) -> bool:
    """Check if job should be excluded based on config."""
    exclude_companies = [c.lower() for c in config.get('exclude_companies', [])]
    exclude_platforms = [p.lower() for p in config.get('exclude_platforms', [])]

    # Check company name
    if company_name:
        company_lower = company_name.lower()
        for exc in exclude_companies:
            if exc in company_lower:
                return True

    # Check URL for excluded platforms
    url_lower = job_url.lower()
    for platform in exclude_platforms:
        if platform.lower() in url_lower:
            return True

    # Skip Easy Apply jobs (these typically don't go to company ATS)
    if 'easy apply' in url_lower or 'easyapply' in url_lower:
        return True

    return False


async def human_delay(min_sec: float = 0.5, max_sec: float = 2.0):
    """Add human-like random delay."""
    await asyncio.sleep(random.uniform(min_sec, max_sec))


async def scroll_page(page, scrolls: int = 3):
    """Scroll page to load more content."""
    for _ in range(scrolls):
        await page.evaluate('window.scrollBy(0, window.innerHeight)')
        await human_delay(0.5, 1.5)


async def search_linkedin_jobs(config: dict, target_count: int = 30) -> list[dict]:
    """
    Search LinkedIn for jobs matching config preferences.

    Returns list of dicts with 'url', 'title', 'company' keys.
    """
    jobs = []
    search_url = build_linkedin_search_url(config)

    print(f"[LinkedIn] Starting search...")
    print(f"[LinkedIn] URL: {search_url[:80]}...")

    async with async_playwright() as p:
        # Launch browser
        browser = await p.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled']
        )

        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )

        page = await context.new_page()

        try:
            # Navigate to search results
            await page.goto(search_url, timeout=30000)
            await human_delay(2, 4)

            # Check if we hit a login wall
            if 'login' in page.url.lower() or 'authwall' in page.url.lower():
                print("[LinkedIn] Warning: Hit login wall. Using public search results only.")
                # Try public job search URL
                public_url = search_url.replace('www.linkedin.com', 'www.linkedin.com')
                await page.goto(public_url, timeout=30000)
                await human_delay(2, 3)

            pages_scraped = 0
            max_pages = 5

            while len(jobs) < target_count and pages_scraped < max_pages:
                pages_scraped += 1
                print(f"[LinkedIn] Scraping page {pages_scraped}...")

                # Scroll to load more jobs
                await scroll_page(page)

                # Find job cards
                # LinkedIn job cards have various selectors depending on logged-in state
                job_cards = await page.query_selector_all('.job-search-card, .jobs-search-results__list-item, [data-job-id]')

                if not job_cards:
                    # Try alternative selectors for public view
                    job_cards = await page.query_selector_all('.base-card, .job-result-card')

                print(f"[LinkedIn] Found {len(job_cards)} job cards on page {pages_scraped}")

                for card in job_cards:
                    if len(jobs) >= target_count:
                        break

                    try:
                        # Extract job URL
                        link = await card.query_selector('a[href*="/jobs/view/"], a[href*="linkedin.com/jobs"]')
                        if not link:
                            link = await card.query_selector('a')

                        if not link:
                            continue

                        href = await link.get_attribute('href')
                        if not href or '/jobs/' not in href:
                            continue

                        # Clean URL
                        job_url = href.split('?')[0]  # Remove query params
                        if not job_url.startswith('http'):
                            job_url = 'https://www.linkedin.com' + job_url

                        # Extract company name
                        company_elem = await card.query_selector('.job-search-card__subtitle, .base-search-card__subtitle, [class*="company"]')
                        company_name = await company_elem.inner_text() if company_elem else ''
                        company_name = company_name.strip()

                        # Extract title
                        title_elem = await card.query_selector('.job-search-card__title, .base-search-card__title, [class*="title"]')
                        title = await title_elem.inner_text() if title_elem else ''
                        title = title.strip()

                        # Check exclusions
                        if should_exclude_job(job_url, company_name, config):
                            print(f"[LinkedIn] Skipping excluded: {company_name}")
                            continue

                        # Check if we already have this job
                        if any(j['url'] == job_url for j in jobs):
                            continue

                        jobs.append({
                            'url': job_url,
                            'title': title,
                            'company': company_name
                        })

                        print(f"[LinkedIn] [{len(jobs)}/{target_count}] {company_name}: {title[:40]}...")

                    except Exception as e:
                        print(f"[LinkedIn] Error extracting job: {e}")
                        continue

                # Try to go to next page
                if len(jobs) < target_count:
                    next_btn = await page.query_selector('button[aria-label="Next"], a[aria-label="Next"]')
                    if next_btn and await next_btn.is_visible():
                        await next_btn.click()
                        await human_delay(2, 4)
                    else:
                        print("[LinkedIn] No more pages available")
                        break

        except PlaywrightTimeout:
            print("[LinkedIn] Page load timeout - using results collected so far")
        except Exception as e:
            print(f"[LinkedIn] Error during search: {e}")
        finally:
            await browser.close()

    return jobs


async def main():
    parser = argparse.ArgumentParser(description='Search LinkedIn for jobs')
    parser.add_argument('--count', type=int, default=30, help='Number of jobs to find')
    parser.add_argument('--output', type=str, help='Output file for URLs')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    args = parser.parse_args()

    try:
        config = load_config()
    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print("LinkedIn Job Search")
    print(f"{'='*60}")
    print(f"Target roles: {config.get('target_roles', ['Not specified'])}")
    print(f"Location: {config.get('location', 'Not specified')}")
    print(f"Remote/Hybrid: {config.get('location_preference', 'Not specified')}")
    print(f"Searching for {args.count} jobs...")
    print(f"{'='*60}\n")

    jobs = await search_linkedin_jobs(config, args.count)

    print(f"\n{'='*60}")
    print(f"Found {len(jobs)} jobs")
    print(f"{'='*60}\n")

    if args.output:
        output_path = Path(args.output)
        if args.json:
            with open(output_path, 'w') as f:
                json.dump(jobs, f, indent=2)
        else:
            with open(output_path, 'w') as f:
                for job in jobs:
                    f.write(f"{job['url']}\n")
        print(f"Saved to {output_path}")
    else:
        if args.json:
            print(json.dumps(jobs, indent=2))
        else:
            for job in jobs:
                print(f"{job['company']}: {job['title']}")
                print(f"  {job['url']}")


if __name__ == '__main__':
    asyncio.run(main())
