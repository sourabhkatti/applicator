#!/usr/bin/env python3
"""
Flask API server for Peebo Chrome Extension
Wraps the browser-applicator apply.py script
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import asyncio
import logging
from pathlib import Path
import sys
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from apply import apply_to_job, load_applicant_config

app = Flask(__name__)
CORS(app, origins=["chrome-extension://*"])  # Allow Chrome extension

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Store active tasks
active_tasks = {}

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "ok", "timestamp": datetime.utcnow().isoformat()})

@app.route('/api/apply', methods=['POST'])
def start_application():
    """
    Start a job application

    Request body:
    {
        "job_url": "https://...",
        "resume_text": "optional custom resume text"
    }

    Returns:
    {
        "task_id": "unique-task-id",
        "status": "started"
    }
    """
    try:
        data = request.json
        job_url = data.get('job_url')

        if not job_url:
            return jsonify({"error": "job_url is required"}), 400

        # Generate task ID
        task_id = f"task_{datetime.utcnow().timestamp()}"

        # Load applicant config
        try:
            applicant = load_applicant_config()
        except Exception as e:
            logger.error(f"Failed to load applicant config: {e}")
            return jsonify({"error": "Applicant configuration not found. Run onboarding first."}), 400

        # Start application in background
        asyncio.create_task(run_application(task_id, job_url, applicant))

        # Store task status
        active_tasks[task_id] = {
            "status": "running",
            "progress": 0,
            "job_url": job_url,
            "started_at": datetime.utcnow().isoformat()
        }

        return jsonify({
            "success": True,
            "task_id": task_id,
            "status": "started"
        })

    except Exception as e:
        logger.error(f"Error starting application: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/status/<task_id>', methods=['GET'])
def get_status(task_id):
    """
    Get status of a running task

    Returns:
    {
        "status": "running" | "completed" | "failed",
        "progress": 0-100,
        "error": "error message if failed",
        "result": {...} if completed
    }
    """
    if task_id not in active_tasks:
        return jsonify({"error": "Task not found"}), 404

    task = active_tasks[task_id]
    return jsonify(task)

async def run_application(task_id, job_url, applicant):
    """Run the application process in background"""
    try:
        # Update progress
        active_tasks[task_id]["progress"] = 10
        active_tasks[task_id]["status"] = "running"

        # Run the application
        result = await apply_to_job(job_url)

        # Update task with result
        active_tasks[task_id]["progress"] = 100
        active_tasks[task_id]["status"] = "completed" if result.get("success") else "failed"
        active_tasks[task_id]["result"] = result
        active_tasks[task_id]["completed_at"] = datetime.utcnow().isoformat()

        if not result.get("success"):
            active_tasks[task_id]["error"] = result.get("error", "Unknown error")

    except Exception as e:
        logger.error(f"Application failed for task {task_id}: {e}")
        active_tasks[task_id]["status"] = "failed"
        active_tasks[task_id]["error"] = str(e)
        active_tasks[task_id]["progress"] = 0

@app.route('/api/applicant', methods=['GET'])
def get_applicant():
    """Get applicant configuration"""
    try:
        applicant = load_applicant_config()
        # Don't send full resume text, just metadata
        return jsonify({
            "name": applicant.get("name"),
            "email": applicant.get("email"),
            "phone": applicant.get("phone"),
            "location": applicant.get("location"),
            "has_resume": bool(applicant.get("resume_text"))
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 404

if __name__ == '__main__':
    print("🐦 Peebo API Server starting...")
    print("📍 Listening on http://localhost:5001")
    print("🔗 Extension should point to this URL")
    print()

    # Run with async support
    from hypercorn.config import Config
    from hypercorn.asyncio import serve

    config = Config()
    config.bind = ["localhost:5001"]

    asyncio.run(serve(app, config))
