"""
AgentMail API client for checking confirmation emails.
"""
import subprocess
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Optional


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
        raise RuntimeError(f"Failed to retrieve AgentMail API key from Keychain: {e}")


def get_recent_emails(inbox_id: str, since_minutes: int = 10) -> List[Dict]:
    """
    Fetch recent emails from AgentMail inbox.

    Args:
        inbox_id: AgentMail inbox identifier (e.g., "applicator@agentmail.to")
        since_minutes: Only fetch emails from last N minutes

    Returns:
        List of email dicts with keys: sender, subject, received_at, body_preview
    """
    api_key = get_api_key()

    # AgentMail API endpoint
    url = f"https://api.agentmail.to/v0/inboxes/{inbox_id}/threads"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # Calculate timestamp for filtering
    since_time = datetime.utcnow() - timedelta(minutes=since_minutes)

    params = {
        "since": since_time.isoformat() + "Z",
        "limit": 100  # Should be enough for batch applications
    }

    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()

        data = response.json()

        # Transform to simplified format (API returns threads)
        emails = []
        for thread in data.get('threads', []):
            emails.append({
                'sender': thread.get('last_message_sender', ''),
                'subject': thread.get('subject', ''),
                'received_at': thread.get('last_activity', ''),
                'thread_id': thread.get('thread_id', ''),
                'participants': thread.get('participants', [])
            })

        return emails

    except requests.exceptions.RequestException as e:
        print(f"Warning: Failed to fetch emails from AgentMail: {e}")
        return []


def wait_for_confirmation_email(
    company: str,
    inbox_id: str = "applicator@agentmail.to",
    timeout_seconds: int = 120,
    poll_interval: int = 10
) -> Optional[Dict]:
    """
    Wait for confirmation email after submitting application.

    Args:
        company: Company name to look for in email
        inbox_id: AgentMail inbox to check
        timeout_seconds: Max time to wait for email (default 2 minutes)
        poll_interval: Seconds between checks (default 10)

    Returns:
        Email dict if found, None if timeout
    """
    import time

    start_time = datetime.utcnow()
    company_lower = company.lower().replace('-', '').replace('_', '').replace(' ', '')

    print(f"[Email Verification] Waiting for confirmation email from {company}...")

    attempts = 0
    max_attempts = timeout_seconds // poll_interval

    while attempts < max_attempts:
        attempts += 1
        print(f"[Email Verification] Checking inbox... (attempt {attempts}/{max_attempts})")

        # Fetch recent emails (last 5 minutes should cover it)
        emails = get_recent_emails(inbox_id, since_minutes=5)

        for email in emails:
            subject_lower = email.get('subject', '').lower()
            sender = email.get('sender', '').lower()

            # Check if this is a confirmation email for this company
            # Look for company name in subject or sender, plus confirmation keywords
            is_company_match = (
                company_lower in subject_lower.replace('-', '').replace(' ', '') or
                company_lower in sender.replace('-', '').replace('.', '')
            )

            is_confirmation = any(kw in subject_lower for kw in [
                'thank you', 'thanks for', 'application', 'received',
                'submitted', 'applying', 'confirmation'
            ])

            if is_company_match and is_confirmation:
                print(f"[Email Verification] ✓ Confirmation email received!")
                print(f"    Subject: {email.get('subject', 'N/A')}")
                return email

        # Wait before next check
        if attempts < max_attempts:
            time.sleep(poll_interval)

    print(f"[Email Verification] ✗ No confirmation email received within {timeout_seconds}s")
    return None


def verify_email_received(company: str, submitted_at: str, emails: List[Dict]) -> bool:
    """
    Check if confirmation email exists for this company.

    Args:
        company: Company name from tracker
        submitted_at: ISO timestamp when application was submitted
        emails: List of recent emails from get_recent_emails()

    Returns:
        True if confirmation email found, False otherwise
    """
    # Normalize company name for matching
    company_lower = company.lower().replace('-', '').replace('_', '').replace(' ', '')

    # Parse submission timestamp
    try:
        submitted_dt = datetime.fromisoformat(submitted_at.replace('Z', '+00:00'))
    except:
        # If parsing fails, just check all emails
        submitted_dt = datetime.min.replace(tzinfo=None)

    for email in emails:
        # Parse email timestamp
        try:
            received_dt = datetime.fromisoformat(email['received_at'].replace('Z', '+00:00'))
        except:
            continue

        # Only check emails received after submission
        if received_dt < submitted_dt:
            continue

        # Extract sender domain
        sender = email['sender'].lower()
        if '@' in sender:
            sender_domain = sender.split('@')[1]
        else:
            sender_domain = sender

        subject_lower = email['subject'].lower()

        # Match: company name in sender domain OR subject
        if company_lower in sender_domain.replace('.', '').replace('-', '') or \
           company_lower in subject_lower.replace('-', '').replace('_', ''):
            return True

    return False
