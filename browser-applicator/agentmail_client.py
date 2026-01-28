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

    # AgentMail API endpoint - try without the /v1 prefix
    url = f"https://api.agentmail.to/inboxes/{inbox_id}/messages"

    headers = {
        "X-API-Key": api_key,
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

        # Transform to simplified format
        emails = []
        for msg in data.get('messages', []):
            emails.append({
                'sender': msg.get('from', ''),
                'subject': msg.get('subject', ''),
                'received_at': msg.get('created_at', ''),
                'body_preview': msg.get('text', '')[:200]  # First 200 chars
            })

        return emails

    except requests.exceptions.RequestException as e:
        print(f"Warning: Failed to fetch emails from AgentMail: {e}")
        return []


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
