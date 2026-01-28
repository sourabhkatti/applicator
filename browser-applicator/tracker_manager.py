#!/usr/bin/env python3
"""
Tracker manager for browser-applicator.
Implements pending/active job tracking similar to Peebo Chrome extension.
"""
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

TRACKER_DIR = Path(__file__).parent.parent / "tracker"
TRACKER_FILE = TRACKER_DIR / "jobs.json"
ACTIVE_JOBS_FILE = Path(__file__).parent / "active_jobs.json"
PENDING_JOBS_FILE = Path(__file__).parent.parent / "pending_jobs.txt"


class TrackerManager:
    """Manages job tracking across pending, active, and completed states."""

    def __init__(self):
        self.tracker_dir = TRACKER_DIR
        self.tracker_file = TRACKER_FILE
        self.active_jobs_file = ACTIVE_JOBS_FILE
        self.pending_jobs_file = PENDING_JOBS_FILE

    def get_pending_jobs(self) -> List[str]:
        """Get list of pending job URLs."""
        if not self.pending_jobs_file.exists():
            return []

        with open(self.pending_jobs_file, 'r') as f:
            lines = f.readlines()

        # Filter out comments and empty lines
        jobs = []
        for line in lines:
            line = line.strip()
            if line and not line.startswith('#') and line.startswith('http'):
                jobs.append(line)

        return jobs

    def remove_pending_job(self, job_url: str):
        """Remove a job URL from pending list."""
        pending = self.get_pending_jobs()

        # Read all lines to preserve comments
        with open(self.pending_jobs_file, 'r') as f:
            lines = f.readlines()

        # Remove the specific URL
        with open(self.pending_jobs_file, 'w') as f:
            for line in lines:
                if job_url not in line:
                    f.write(line)

    def add_active_job(self, job_url: str, company: str, task_id: Optional[str] = None):
        """Add job to active tracking."""
        active_jobs = self._load_active_jobs()

        active_jobs[job_url] = {
            "company": company,
            "job_url": job_url,
            "task_id": task_id,
            "started_at": datetime.utcnow().isoformat() + "Z",
            "status": "running"
        }

        self._save_active_jobs(active_jobs)

    def update_active_job(self, job_url: str, status: str, result: Optional[Dict] = None):
        """Update active job status."""
        active_jobs = self._load_active_jobs()

        if job_url in active_jobs:
            active_jobs[job_url]["status"] = status
            active_jobs[job_url]["updated_at"] = datetime.utcnow().isoformat() + "Z"

            if result:
                active_jobs[job_url]["result"] = result

            self._save_active_jobs(active_jobs)

    def remove_active_job(self, job_url: str):
        """Remove job from active tracking."""
        active_jobs = self._load_active_jobs()

        if job_url in active_jobs:
            del active_jobs[job_url]
            self._save_active_jobs(active_jobs)

    def get_active_jobs(self) -> Dict:
        """Get all active jobs."""
        return self._load_active_jobs()

    def is_job_applied(self, job_url: str) -> bool:
        """Check if job already exists in tracker."""
        try:
            with open(self.tracker_file, 'r') as f:
                tracker_data = json.load(f)

            for job in tracker_data.get("jobs", []):
                if job.get("url") == job_url:
                    return True

            return False
        except (FileNotFoundError, json.JSONDecodeError):
            return False

    def _load_active_jobs(self) -> Dict:
        """Load active jobs from JSON file."""
        if not self.active_jobs_file.exists():
            return {}

        try:
            with open(self.active_jobs_file, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}

    def _save_active_jobs(self, active_jobs: Dict):
        """Save active jobs to JSON file."""
        with open(self.active_jobs_file, 'w') as f:
            json.dump(active_jobs, f, indent=2)


def get_next_pending_job() -> Optional[str]:
    """Get next pending job URL that hasn't been applied to."""
    manager = TrackerManager()
    pending_jobs = manager.get_pending_jobs()

    for job_url in pending_jobs:
        # Skip if already applied
        if manager.is_job_applied(job_url):
            continue

        # Skip if currently active
        active_jobs = manager.get_active_jobs()
        if job_url in active_jobs:
            continue

        return job_url

    return None


def start_job_application(job_url: str, company: str, task_id: Optional[str] = None):
    """Mark job as started in active tracking."""
    manager = TrackerManager()
    manager.remove_pending_job(job_url)
    manager.add_active_job(job_url, company, task_id)


def complete_job_application(job_url: str, success: bool, result: Optional[Dict] = None):
    """Mark job as completed and remove from active tracking."""
    manager = TrackerManager()

    if success:
        manager.update_active_job(job_url, "completed", result)
    else:
        manager.update_active_job(job_url, "failed", result)

    # Remove from active after a short delay to allow viewing
    # In production, you might want to keep failed ones for debugging
    if not success:
        # Keep failed jobs in active for review
        pass
    else:
        # Remove successful applications from active
        manager.remove_active_job(job_url)
