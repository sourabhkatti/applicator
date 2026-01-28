#!/usr/bin/env python3
"""
Verify job applications by checking for confirmation emails in AgentMail.

This script:
1. Reads all pending_verification jobs from tracker
2. Fetches recent emails from AgentMail
3. Matches emails to companies
4. Updates tracker: pending_verification -> applied (or removes if no email)
"""
import json
import sys
from pathlib import Path
from agentmail_client import get_recent_emails, verify_email_received


def verify_applications():
    """Main verification function."""
    tracker_path = Path(__file__).parent.parent / "tracker" / "jobs.json"

    if not tracker_path.exists():
        print("No tracker file found")
        return

    # Load tracker data
    try:
        with open(tracker_path, 'r') as f:
            tracker_data = json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"Error reading tracker: {e}")
        return

    # Find pending verification jobs
    pending_jobs = [
        job for job in tracker_data.get("jobs", [])
        if job.get("status") == "pending_verification"
    ]

    if not pending_jobs:
        print("No pending verification jobs found")
        return

    print(f"\n{'='*70}")
    print(f"EMAIL VERIFICATION")
    print(f"Checking {len(pending_jobs)} pending applications...")
    print(f"{'='*70}\n")

    # Fetch recent emails from AgentMail
    print("Fetching emails from AgentMail...")
    try:
        emails = get_recent_emails("applicator@agentmail.to", since_minutes=15)
        print(f"✓ Retrieved {len(emails)} recent emails\n")
    except Exception as e:
        print(f"✗ Failed to fetch emails: {e}")
        return

    # Verify each pending job
    verified_count = 0
    failed_jobs = []

    for job in pending_jobs:
        company = job.get("company", "")
        role = job.get("role", "")
        submitted_at = job.get("submitted_at", "")

        print(f"Checking {company}...", end=" ")

        if verify_email_received(company, submitted_at, emails):
            # Update status to applied
            job["status"] = "applied"
            job["email_verified"] = True
            verified_count += 1
            print("✓ Email confirmed")
        else:
            # Mark for removal
            failed_jobs.append(job)
            print("✗ No confirmation email")

    # Remove failed jobs from tracker
    if failed_jobs:
        tracker_data["jobs"] = [
            job for job in tracker_data["jobs"]
            if job not in failed_jobs
        ]

    # Write updated tracker
    try:
        with open(tracker_path, 'w') as f:
            json.dump(tracker_data, f, indent=2)
    except IOError as e:
        print(f"\nError writing tracker: {e}")
        return

    # Print summary
    print(f"\n{'='*70}")
    print(f"VERIFICATION COMPLETE")
    print(f"{'='*70}")
    print(f"✓ Verified: {verified_count}/{len(pending_jobs)} applications")
    if failed_jobs:
        print(f"✗ Failed (no email): {len(failed_jobs)} applications")
        print("\nFailed applications:")
        for job in failed_jobs:
            print(f"  - {job.get('company')}: {job.get('role')}")
    print(f"{'='*70}\n")

    return verified_count


if __name__ == "__main__":
    verify_applications()
