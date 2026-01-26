#!/usr/bin/env python3
"""
Data migration script for unified job tracker.
Transforms existing jobs.json to new unified schema with zero data loss.
"""

import json
import shutil
from datetime import datetime
from pathlib import Path

TRACKER_DIR = Path(__file__).parent
JOBS_FILE = TRACKER_DIR / 'jobs.json'
BACKUP_FILE = TRACKER_DIR / 'jobs.json.pre-migration'


def backup_current_data():
    """Create backup of current jobs.json."""
    if not JOBS_FILE.exists():
        raise FileNotFoundError(f"jobs.json not found at {JOBS_FILE}")

    shutil.copy(JOBS_FILE, BACKUP_FILE)
    print(f"✅ Backup created: {BACKUP_FILE}")


def load_jobs():
    """Load existing jobs data."""
    with open(JOBS_FILE) as f:
        return json.load(f)


def transform_job(job):
    """Transform a single job to unified schema."""
    # Map old interview statuses to unified schema
    if job['status'] in ['recruiter_screen', 'hiring_manager', 'panel_onsite']:
        job['interview_stage'] = job['status']
        job['status'] = 'interviewing'
    else:
        job['interview_stage'] = None

    # Add applied_at ISO timestamp (convert from dateApplied YYYY-MM-DD)
    date_applied = job.get('dateApplied', datetime.utcnow().strftime('%Y-%m-%d'))
    job['applied_at'] = date_applied + 'T00:00:00Z'

    # Add new fields with defaults
    job['browser_use_task_id'] = None
    job['browser_use_status'] = None
    job['audit_trail'] = []
    job['synced'] = True

    # Add created_at and updated_at timestamps
    job['created_at'] = date_applied + 'T00:00:00Z'
    last_activity = job.get('lastActivityDate', date_applied)
    job['updated_at'] = last_activity + 'T00:00:00Z'

    # Add email_verified field (default False, AgentMail will set to True)
    job['email_verified'] = False

    # Check if job has AgentMail confirmation note
    notes = job.get('notes', '')
    if 'Auto-added from AgentMail' in notes or 'Email verified' in notes:
        job['email_verified'] = True

    # Preserve ALL existing fields - no data deletion
    return job


def migrate_data():
    """Perform the migration."""
    print("Starting migration...")

    # Load current data
    data = load_jobs()
    original_count = len(data.get('jobs', []))
    print(f"Found {original_count} jobs to migrate")

    # Ensure settings has active_tasks
    if 'settings' not in data:
        data['settings'] = {}
    data['settings']['active_tasks'] = data['settings'].get('active_tasks', {})

    # Transform each job
    for i, job in enumerate(data['jobs'], 1):
        data['jobs'][i-1] = transform_job(job)
        if i % 10 == 0:
            print(f"  Processed {i}/{original_count} jobs...")

    # Save migrated data
    with open(JOBS_FILE, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"✅ Migration complete: {original_count} jobs migrated")

    return original_count


def validate_migration(expected_count):
    """Validate migration was successful."""
    data = load_jobs()
    actual_count = len(data.get('jobs', []))

    if actual_count != expected_count:
        raise ValueError(f"Job count mismatch! Expected {expected_count}, got {actual_count}")

    # Validate schema on first 5 jobs
    required_fields = [
        'interview_stage', 'applied_at', 'browser_use_task_id',
        'browser_use_status', 'audit_trail', 'synced',
        'created_at', 'updated_at', 'email_verified'
    ]

    for i, job in enumerate(data['jobs'][:5], 1):
        for field in required_fields:
            if field not in job:
                raise ValueError(f"Job {i} missing field: {field}")

    # Check status mapping
    interviewing_count = sum(1 for j in data['jobs'] if j['status'] == 'interviewing')
    if interviewing_count > 0:
        print(f"  Found {interviewing_count} jobs in interviewing status")
        # Check first interviewing job has interview_stage
        interviewing_job = next(j for j in data['jobs'] if j['status'] == 'interviewing')
        if interviewing_job['interview_stage'] not in ['recruiter_screen', 'hiring_manager', 'panel_onsite']:
            raise ValueError("Interviewing job missing valid interview_stage")

    print(f"✅ Validation passed: {actual_count} jobs with correct schema")


def main():
    """Run migration with validation."""
    try:
        # 1. Backup
        backup_current_data()

        # 2. Migrate
        original_count = migrate_data()

        # 3. Validate
        validate_migration(original_count)

        print("\n" + "="*50)
        print("✅ MIGRATION SUCCESSFUL")
        print(f"   Jobs migrated: {original_count}")
        print(f"   Backup saved: {BACKUP_FILE}")
        print("="*50)

    except Exception as e:
        print(f"\n❌ MIGRATION FAILED: {e}")
        if BACKUP_FILE.exists():
            print(f"   Restore backup with: cp {BACKUP_FILE} {JOBS_FILE}")
        raise


if __name__ == '__main__':
    main()
