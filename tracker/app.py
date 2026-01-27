#!/usr/bin/env python3
"""
Flask server for the job tracker.

Serves the static tracker UI and provides API endpoints for configuration.
"""

import json
import webbrowser
from pathlib import Path

import yaml
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='.')

# Paths
TRACKER_DIR = Path(__file__).parent
ROOT_DIR = TRACKER_DIR.parent
CONFIG_PATH = ROOT_DIR / "applicant.yaml"
JOBS_PATH = TRACKER_DIR / "jobs.json"


@app.route('/')
def index():
    """Serve the main tracker page."""
    return send_from_directory(TRACKER_DIR, 'index.html')


@app.route('/design-system.css')
def design_system():
    """Serve the Peebo design system CSS."""
    return send_from_directory(TRACKER_DIR, 'design-system.css')


@app.route('/tracker.css')
def tracker_css():
    """Serve the tracker CSS."""
    return send_from_directory(TRACKER_DIR, 'tracker.css')


@app.route('/tracker.js')
def tracker_js():
    """Serve the tracker JavaScript."""
    return send_from_directory(TRACKER_DIR, 'tracker.js')


@app.route('/storage-adapter.js')
def storage_adapter():
    """Serve the storage adapter JavaScript."""
    return send_from_directory(TRACKER_DIR, 'storage-adapter.js')


@app.route('/assets/<path:filename>')
def serve_assets(filename):
    """Serve mascot and other assets."""
    return send_from_directory(TRACKER_DIR / 'assets', filename)


@app.route('/jobs.json')
def jobs():
    """Serve the jobs data."""
    return send_from_directory(TRACKER_DIR, 'jobs.json')


@app.route('/api/config', methods=['GET'])
def get_config():
    """Get the applicant configuration."""
    if not CONFIG_PATH.exists():
        return jsonify({"error": "Configuration not found", "setup_required": True}), 404

    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)

    # Return only non-sensitive fields for the UI
    return jsonify({
        "setup_required": False,
        "name": config.get("name", ""),
        "target_roles": config.get("target_roles", []),
        "location_preference": config.get("location_preference", ""),
        "industries": config.get("industries", []),
    })


@app.route('/api/config', methods=['POST'])
def save_config():
    """Save the applicant configuration."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # If config exists, merge with existing
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            existing = yaml.safe_load(f) or {}
        existing.update(data)
        data = existing

    with open(CONFIG_PATH, 'w') as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)

    return jsonify({"success": True})


@app.route('/api/jobs', methods=['GET'])
def get_jobs():
    """Get all jobs."""
    if not JOBS_PATH.exists():
        return jsonify({"jobs": []})

    with open(JOBS_PATH) as f:
        data = json.load(f)

    return jsonify(data)


@app.route('/api/jobs', methods=['POST'])
def save_jobs():
    """Save jobs data."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    with open(JOBS_PATH, 'w') as f:
        json.dump(data, f, indent=2)

    return jsonify({"success": True})


@app.route('/api/cancel_task', methods=['POST'])
def cancel_task():
    """Cancel a running application task."""
    data = request.get_json()
    if not data or 'task_id' not in data:
        return jsonify({"error": "task_id required"}), 400

    task_id = data['task_id']

    # Load jobs.json and update task status
    if not JOBS_PATH.exists():
        return jsonify({"error": "No jobs data found"}), 404

    try:
        with open(JOBS_PATH, 'r') as f:
            jobs_data = json.load(f)

        active_tasks = jobs_data.get('settings', {}).get('active_tasks', {})

        if task_id not in active_tasks:
            return jsonify({"error": "Task not found"}), 404

        # Mark as cancelled
        from datetime import datetime
        active_tasks[task_id].update({
            'status': 'cancelled',
            'error_message': 'Task cancelled by user',
            'updated_at': datetime.now().isoformat() + 'Z'
        })

        with open(JOBS_PATH, 'w') as f:
            json.dump(jobs_data, f, indent=2)

        return jsonify({"success": True, "message": f"Task {task_id} cancelled"})

    except (json.JSONDecodeError, IOError) as e:
        return jsonify({"error": f"Failed to update: {str(e)}"}), 500


@app.route('/api/remove_task', methods=['POST'])
def remove_task():
    """Remove a task from active_tasks (cleanup after cancel/error)."""
    data = request.get_json()
    if not data or 'task_id' not in data:
        return jsonify({"error": "task_id required"}), 400

    task_id = data['task_id']

    if not JOBS_PATH.exists():
        return jsonify({"error": "No jobs data found"}), 404

    try:
        with open(JOBS_PATH, 'r') as f:
            jobs_data = json.load(f)

        active_tasks = jobs_data.get('settings', {}).get('active_tasks', {})

        if task_id in active_tasks:
            del active_tasks[task_id]
            with open(JOBS_PATH, 'w') as f:
                json.dump(jobs_data, f, indent=2)
            return jsonify({"success": True, "message": f"Task {task_id} removed"})

        return jsonify({"error": "Task not found"}), 404

    except (json.JSONDecodeError, IOError) as e:
        return jsonify({"error": f"Failed to update: {str(e)}"}), 500


@app.route('/api/batch_apply', methods=['POST'])
def batch_apply():
    """Start a batch job application process."""
    import subprocess
    import tempfile
    import uuid
    from datetime import datetime

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    target = data.get('target', 10)
    urls = data.get('urls', [])

    # Validate target
    if not isinstance(target, int) or target < 1 or target > 50:
        return jsonify({"error": "Target must be between 1 and 50"}), 400

    # Check if URLs provided or need to search
    if not urls:
        return jsonify({"error": "No job URLs provided. LinkedIn search not yet implemented - please provide URLs."}), 400

    try:
        # Write URLs to temp file
        urls_file = ROOT_DIR / "temp_batch_urls.txt"
        with open(urls_file, 'w') as f:
            for url in urls:
                f.write(url + '\n')

        # Create batch task entry in jobs.json
        batch_id = str(uuid.uuid4())
        with open(JOBS_PATH, 'r') as f:
            jobs_data = json.load(f)

        if 'settings' not in jobs_data:
            jobs_data['settings'] = {}
        if 'active_tasks' not in jobs_data['settings']:
            jobs_data['settings']['active_tasks'] = {}

        jobs_data['settings']['active_tasks'][batch_id] = {
            'task_id': batch_id,
            'type': 'batch',
            'company': f'Batch Application',
            'role': f'{target} jobs',
            'job_url': None,
            'started_at': datetime.now().isoformat() + 'Z',
            'status': 'running',
            'progress': 0,
            'current_step': f'Starting batch: 0/{target} complete',
            'target': target,
            'completed': 0,
            'failed': 0,
            'cost': 0.0
        }

        with open(JOBS_PATH, 'w') as f:
            json.dump(jobs_data, f, indent=2)

        # Spawn apply_batch.py as background process
        apply_batch_path = ROOT_DIR / "apply_batch.py"
        subprocess.Popen(
            ['python3', str(apply_batch_path), str(urls_file), str(target)],
            cwd=str(ROOT_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )

        return jsonify({
            "success": True,
            "batch_id": batch_id,
            "target": target,
            "urls_count": len(urls),
            "message": f"Batch started: applying to {target} jobs from {len(urls)} URLs"
        })

    except Exception as e:
        return jsonify({"error": f"Failed to start batch: {str(e)}"}), 500


def main():
    """Run the server and open the browser."""
    port = 8080
    url = f"http://localhost:{port}"

    print(f"Starting Job Tracker at {url}")
    print("Press Ctrl+C to stop")

    # Open browser after a short delay
    import threading
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    # Run Flask (disable reloader to prevent double browser open)
    app.run(host='localhost', port=port, debug=False)


if __name__ == '__main__':
    main()
