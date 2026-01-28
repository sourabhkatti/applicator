#!/usr/bin/env python3
"""
Apply to a batch of jobs with tailored resumes.
Simple, sequential approach.
"""

import json
import subprocess
import sys
import time
from pathlib import Path


def get_job_description_simple(url: str) -> str:
    """Fetch job description using curl and extract text."""
    try:
        result = subprocess.run(
            ['curl', '-s', '-L', url],
            capture_output=True,
            text=True,
            timeout=30
        )
        # Simple HTML to text conversion
        html = result.stdout
        # Extract text between body tags (simplified)
        text = html.replace('<', ' <').replace('>', '> ')
        return text[:8000]  # Limit for ATS optimizer
    except Exception as e:
        print(f"  Error fetching job description: {e}")
        return None


def apply_to_job_with_tailored_resume(job_url: str, job_num: int, total: int) -> dict:
    """Apply to a single job with tailored resume."""
    print(f"\n{'='*70}")
    print(f"JOB #{job_num}/{total}: {job_url[:60]}...")
    print(f"{'='*70}")

    # Step 1: Get job description
    print("[1/3] Fetching job description...")
    job_desc = get_job_description_simple(job_url)

    if not job_desc or len(job_desc) < 100:
        print(f"  ✗ Failed to fetch job description")
        return {'success': False, 'error': 'Failed to fetch job description', 'url': job_url}

    print(f"  ✓ Got {len(job_desc)} chars")

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
            print(f"  ✗ ATS optimizer failed: {result.stderr[:200]}")
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
            try:
                # Extract JSON from end of output (after all log messages)
                # Look for last continuous JSON block (might span multiple lines)
                lines = result.stdout.strip().split('\n')

                # Find the start of JSON block (line starting with '{')
                json_start_idx = None
                for i in range(len(lines) - 1, -1, -1):
                    if lines[i].strip().startswith('{'):
                        json_start_idx = i
                        break

                if json_start_idx is not None:
                    # Join all lines from JSON start to end
                    json_text = '\n'.join(lines[json_start_idx:])
                    app_result = json.loads(json_text)
                else:
                    app_result = {'success': False, 'error': 'No JSON output found'}
            except json.JSONDecodeError as e:
                print(f"  Debug: Failed to parse JSON. Last 5 lines of stdout:")
                for line in lines[-5:]:
                    print(f"    {repr(line)}")
                app_result = {'success': False, 'error': f'JSON parse error: {str(e)}'}

            if app_result.get('success'):
                print(f"  ✓✓✓ APPLICATION SUCCESSFUL ✓✓✓")
                return {**app_result, 'url': job_url}
            else:
                error = app_result.get('error', 'Unknown error')
                print(f"  ✗ Application failed: {error[:100]}")
                return {**app_result, 'url': job_url}
        else:
            print(f"  ✗ No output from browser-applicator")
            print(f"  stderr: {result.stderr[:200]}")
            return {'success': False, 'error': 'No output', 'url': job_url}

    except subprocess.TimeoutExpired:
        print(f"  ✗ Application timed out after 5 minutes")
        return {'success': False, 'error': 'Timeout', 'url': job_url}
    except Exception as e:
        print(f"  ✗ Application error: {e}")
        return {'success': False, 'error': str(e), 'url': job_url}


def main():
    if len(sys.argv) < 2:
        print("Usage: python apply_batch.py <job_urls_file> [target_count]")
        print("  job_urls_file: Text file with one job URL per line")
        print("  target_count: Number of successful applications to achieve (default: 20)")
        sys.exit(1)

    urls_file = sys.argv[1]
    target = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    # Read URLs
    urls_path = Path(urls_file)
    if not urls_path.exists():
        print(f"Error: File not found: {urls_file}")
        sys.exit(1)

    with open(urls_path) as f:
        job_urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]

    print(f"\n{'='*70}")
    print(f"BATCH JOB APPLICATION")
    print(f"Target: {target} successful applications")
    print(f"Job URLs loaded: {len(job_urls)}")
    print(f"{'='*70}\n")

    if len(job_urls) < target:
        print(f"Warning: Only {len(job_urls)} URLs provided but target is {target}")

    # Apply to jobs
    successful = []
    failed = []

    for i, url in enumerate(job_urls, 1):
        if len(successful) >= target:
            print(f"\n\n🎉 REACHED TARGET: {target} successful applications! 🎉")
            break

        result = apply_to_job_with_tailored_resume(url, i, len(job_urls))

        if result.get('success'):
            successful.append(result)
            print(f"\n✓ SUCCESS COUNT: {len(successful)}/{target}")
        else:
            failed.append(result)
            print(f"\n✗ FAILED: {result.get('error', 'Unknown')[:50]}")

        # Progress update
        print(f"\n[PROGRESS: {len(successful)} successful, {len(failed)} failed, {len(job_urls) - i} remaining]")

        # Small delay between applications
        if i < len(job_urls) and len(successful) < target:
            print("\nWaiting 5 seconds before next application...")
            time.sleep(5)

    # Final summary
    print(f"\n\n{'='*70}")
    print(f"FINAL SUMMARY")
    print(f"{'='*70}")
    print(f"✓ Successful applications: {len(successful)}")
    print(f"✗ Failed applications: {len(failed)}")
    print(f"\nSuccessful applications:")
    for i, app in enumerate(successful, 1):
        company = app.get('company', 'Unknown')
        role = app.get('role', 'Unknown')
        print(f"  {i}. {company} - {role}")

    if len(successful) < target:
        print(f"\n⚠️  Only reached {len(successful)}/{target} successful applications")
    else:
        print(f"\n🎉 Successfully completed {len(successful)} applications!")

    print(f"{'='*70}\n")

    # Email verification phase
    print("\n⏳ Waiting 2 minutes for confirmation emails to arrive...")
    time.sleep(120)

    print("\nRunning email verification...")
    try:
        result = subprocess.run(
            ['python3', 'browser-applicator/verify_applications.py'],
            timeout=60
        )
        if result.returncode == 0:
            print("\n✓ Email verification complete")
        else:
            print("\n⚠️  Email verification completed with warnings")
    except Exception as e:
        print(f"\n✗ Email verification failed: {e}")


if __name__ == '__main__':
    main()
