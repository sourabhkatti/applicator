#!/usr/bin/env python3
"""
AgentMail to Tracker Sync Service

Monitors AgentMail inbox for job application confirmation emails
and automatically updates the tracker with confirmed applications.
"""

import json
import re
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Set

# Paths
TRACKER_DIR = Path(__file__).parent.parent / "tracker"
TRACKER_FILE = TRACKER_DIR / "jobs.json"
SYNC_STATE_FILE = Path(__file__).parent / "agentmail_sync_state.json"

# AgentMail API config
API_BASE = "https://api.agentmail.to/v0"
INBOX_ID = "applicator@agentmail.to"


def get_api_key() -> str:
    """Retrieve AgentMail API key from macOS Keychain."""
    import os
    try:
        result = subprocess.run(
            ['security', 'find-generic-password', '-a', os.getenv('USER'),
             '-s', 'agentmail-api-key', '-w'],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Failed to retrieve AgentMail API key: {e}")


def fetch_inbox_threads() -> List[Dict]:
    """Fetch all threads from AgentMail inbox."""
    import requests

    api_key = get_api_key()
    url = f"{API_BASE}/inboxes/{INBOX_ID}/threads"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
        return data.get('threads', [])
    except Exception as e:
        print(f"Error fetching threads: {e}")
        return []


def extract_company_from_sender(sender: str) -> str:
    """
    Extract company name from sender email.

    Example: "Material Security Hiring Team <no-reply@ashbyhq.com>" -> "Material Security"
    """
    # Remove email portion
    sender = sender.split('<')[0].strip()

    # Remove common suffixes
    for suffix in [' Hiring Team', ' Recruiting Team', ' Recruiting', 'The ', ' Team']:
        sender = sender.replace(suffix, '')

    return sender.strip()


def extract_role_from_preview(subject: str, preview: str) -> str:
    """
    Extract role/position from email subject or preview.

    Looks for patterns like "for the X role" or "for X position"
    """
    combined = f"{subject} {preview}"

    # Pattern: "for the X role"
    match = re.search(r'for (?:the )?([A-Z][^.!?]+?)(?:role|position)', combined)
    if match:
        role = match.group(1).strip()
        # Clean up common variations
        role = re.sub(r'\s+at\s+\w+.*$', '', role)  # Remove "at Company"
        return role

    # Pattern: "application for X"
    match = re.search(r'application for (?:the )?([A-Z][^.!?]+?)(?:\.|!)', combined)
    if match:
        return match.group(1).strip()

    return "Product Manager"  # Default fallback


def is_confirmation_email(subject: str, preview: str) -> bool:
    """
    Determine if email is a job application confirmation.

    Looks for keywords like "thank you for applying", "received your application"
    """
    text = f"{subject.lower()} {preview.lower()}"

    confirmation_phrases = [
        'thank you for applying',
        'thanks for applying',
        'received your application',
        "we've received your application",
        'application received',
        'thank you for your application',
        'thanks for your application',
        'application has been received',
        'appreciate your interest',
    ]

    return any(phrase in text for phrase in confirmation_phrases)


def load_tracker_jobs() -> Dict:
    """Load current tracker data."""
    if not TRACKER_FILE.exists():
        return {"settings": {"followUpDays": 2}, "jobs": []}

    try:
        with open(TRACKER_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"settings": {"followUpDays": 2}, "jobs": []}


def save_tracker_jobs(data: Dict):
    """Save tracker data."""
    TRACKER_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(TRACKER_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def load_sync_state() -> Set[str]:
    """Load set of thread IDs we've already processed."""
    if not SYNC_STATE_FILE.exists():
        return set()

    try:
        with open(SYNC_STATE_FILE, 'r') as f:
            data = json.load(f)
            return set(data.get('processed_threads', []))
    except (json.JSONDecodeError, IOError):
        return set()


def save_sync_state(processed_threads: Set[str]):
    """Save set of processed thread IDs."""
    last_sync = datetime.utcnow().isoformat() + 'Z'
    with open(SYNC_STATE_FILE, 'w') as f:
        json.dump({
            'processed_threads': list(processed_threads),
            'last_sync': last_sync
        }, f, indent=2)

    # Also update jobs.json settings for UI visibility
    try:
        tracker_data = load_tracker_jobs()
        tracker_data.setdefault('settings', {})['last_email_sync'] = last_sync
        save_tracker_jobs(tracker_data)
    except Exception as e:
        print(f"Warning: Could not update tracker sync timestamp: {e}")


def job_exists_in_tracker(tracker_data: Dict, company: str, role: str = None) -> bool:
    """
    Check if a job from this company+role already exists in tracker.

    FIXED: Now checks both company AND role (not just company) to prevent
    losing multiple roles at the same company.
    """
    company_lower = company.lower().replace(' ', '').replace('-', '')

    for job in tracker_data.get('jobs', []):
        job_company = job.get('company', '').lower().replace(' ', '').replace('-', '')

        if company_lower == job_company:
            # If role provided, match on both company + role
            if role:
                job_role = job.get('role', '').lower().replace(' ', '').replace('-', '')
                role_lower = role.lower().replace(' ', '').replace('-', '')
                # Fuzzy match: check if one contains the other
                if role_lower in job_role or job_role in role_lower:
                    return True
            else:
                # No role provided, match on company only
                return True

    return False


def update_or_add_job(tracker_data: Dict, company: str, role: str, timestamp: str) -> str:
    """
    Update existing job or add new one.

    CRITICAL FIX: Previously add_job_to_tracker would skip existing jobs,
    meaning browser-applicator jobs would never get email_verified=True.
    Now we UPDATE existing jobs to set email verification.

    Returns 'updated' or 'added'.
    """
    # Try to find existing job by company+role
    for job in tracker_data.get('jobs', []):
        if (job['company'].lower().strip() == company.lower().strip() and
            job['role'].lower().strip() == role.lower().strip()):
            # UPDATE existing job
            job['email_verified'] = True
            job['updated_at'] = datetime.utcnow().isoformat() + 'Z'
            existing_notes = job.get('notes', '')
            verification_note = f"\n✅ Email confirmation received on {timestamp[:10]}"
            if verification_note not in existing_notes:
                job['notes'] = (existing_notes + verification_note).strip()
            return 'updated'

    # If not found, ADD new job with unified schema
    try:
        dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        date_applied = dt.strftime('%Y-%m-%d')
    except:
        date_applied = datetime.utcnow().strftime('%Y-%m-%d')

    new_job = {
        "id": str(uuid.uuid4()).upper(),
        "company": company,
        "role": role,
        "status": "applied",
        "interview_stage": None,  # NEW - unified schema
        "applied_at": timestamp,  # NEW - ISO timestamp
        "dateApplied": date_applied,
        "nextAction": "Wait for response",
        "jobUrl": None,
        "salaryMin": None,
        "salaryMax": None,
        "recruiterName": None,
        "recruiterEmail": None,
        "hiringManagerName": None,
        "hiringManagerEmail": None,
        "referralContact": None,
        "referralStatus": "none",
        "interviews": [],
        "lastActivityDate": date_applied,
        "followUpBy": None,
        "notes": f"Auto-added from AgentMail confirmation. Email verified on {date_applied}.",
        "companyResearch": None,
        "prepChecklist": {
            "companyResearch": False,
            "starStories": False,
            "questionsReady": False,
            "technicalPrep": False
        },
        "offer": None,
        "email_verified": True,  # NEW
        "browser_use_task_id": None,  # NEW
        "audit_trail": [],  # NEW
        "synced": True,  # NEW
        "created_at": timestamp,  # NEW
        "updated_at": timestamp  # NEW
    }

    tracker_data.setdefault('jobs', []).insert(0, new_job)
    return 'added'


def sync_agentmail_to_tracker():
    """
    Main sync function.

    Fetches confirmation emails and adds new jobs to tracker.
    """
    print(f"\n{'='*80}")
    print(f"AgentMail → Tracker Sync")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*80}\n")

    # Load state
    processed_threads = load_sync_state()
    tracker_data = load_tracker_jobs()

    # Fetch threads
    print("Fetching threads from AgentMail...")
    threads = fetch_inbox_threads()
    print(f"Retrieved {len(threads)} threads")

    # Process new threads
    new_jobs_added = 0
    new_threads = []

    for thread in threads:
        thread_id = thread.get('thread_id')

        # Skip if already processed
        if thread_id in processed_threads:
            continue

        sender = thread.get('senders', [''])[0]
        subject = thread.get('subject', '')
        preview = thread.get('preview', '')
        timestamp = thread.get('timestamp', '')

        # Check if it's a confirmation email
        if not is_confirmation_email(subject, preview):
            continue

        # Extract company and role
        company = extract_company_from_sender(sender)
        role = extract_role_from_preview(subject, preview)

        print(f"\n📧 New confirmation: {company}")
        print(f"   Role: {role}")
        print(f"   Subject: {subject}")

        # Update or add to tracker
        result = update_or_add_job(tracker_data, company, role, timestamp)

        if result == 'added':
            print(f"   ✅ Added to tracker")
            new_jobs_added += 1
        elif result == 'updated':
            print(f"   ✅ Updated email verification")
            new_jobs_added += 1  # Count updates as progress

        # Mark as processed
        new_threads.append(thread_id)

    # Save state
    if new_threads:
        processed_threads.update(new_threads)
        save_sync_state(processed_threads)

    if new_jobs_added > 0:
        save_tracker_jobs(tracker_data)
        print(f"\n{'='*80}")
        print(f"✅ Sync complete: {new_jobs_added} new job(s) added to tracker")
        print(f"{'='*80}\n")
    else:
        print(f"\n{'='*80}")
        print(f"✅ Sync complete: No new jobs to add")
        print(f"{'='*80}\n")

    return new_jobs_added


def monitor_continuous(interval_seconds: int = 60):
    """
    Continuously monitor AgentMail and sync to tracker.

    Args:
        interval_seconds: Time between sync checks (default 60 seconds)
    """
    print("Starting AgentMail → Tracker continuous monitoring")
    print(f"Sync interval: {interval_seconds} seconds")
    print("Press Ctrl+C to stop\n")

    try:
        while True:
            try:
                sync_agentmail_to_tracker()
            except Exception as e:
                print(f"Error during sync: {e}")

            print(f"Sleeping for {interval_seconds} seconds...")
            time.sleep(interval_seconds)
    except KeyboardInterrupt:
        print("\n\nMonitoring stopped by user")


if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == '--once':
        # One-time sync
        sync_agentmail_to_tracker()
    else:
        # Continuous monitoring (default)
        interval = int(sys.argv[1]) if len(sys.argv) > 1 else 60
        monitor_continuous(interval)
