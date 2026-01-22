#!/usr/bin/env python3
"""
ATS Resume Optimizer

Extracts keywords from job descriptions and generates an optimized resume
tailored to pass Applicant Tracking Systems (ATS).

Usage:
    python3 ats_optimizer.py                    # Interactive mode
    python3 ats_optimizer.py "job description"  # Direct mode
    python3 ats_optimizer.py --file job.txt     # From file
"""

import re
import sys
from pathlib import Path
from collections import Counter

# Path to applicant config
APPLICANT_YAML = Path(__file__).parent.parent / "applicant.yaml"

# Common PM keywords to look for in job descriptions
PM_KEYWORDS = {
    # Seniority signals
    "senior", "staff", "principal", "lead", "director",

    # Core PM skills
    "product management", "product manager", "product strategy", "product vision",
    "roadmap", "backlog", "prioritization", "requirements", "PRD", "specs",
    "discovery", "delivery", "execution", "launch", "GTM", "go-to-market",

    # Technical
    "technical", "API", "platform", "infrastructure", "architecture",
    "AI", "ML", "machine learning", "data", "analytics",
    "mobile", "web", "cloud", "SaaS", "B2B", "B2C",

    # Methodologies
    "agile", "scrum", "kanban", "lean", "OKRs", "KPIs",
    "A/B testing", "experimentation", "user research", "customer discovery",

    # Collaboration
    "cross-functional", "engineering", "design", "stakeholder",
    "leadership", "influence", "communication",

    # Domain-specific
    "marketplace", "payments", "fintech", "security", "enterprise",
    "consumer", "growth", "engagement", "retention", "monetization",
    "automation", "workflow", "integration", "developer",
}


def load_applicant_config() -> dict:
    """Load applicant configuration from YAML file."""
    if not APPLICANT_YAML.exists():
        print(f"Error: applicant.yaml not found at {APPLICANT_YAML}")
        print("Run setup first - see CLAUDE.md for instructions.")
        sys.exit(1)

    try:
        import yaml
        with open(APPLICANT_YAML) as f:
            return yaml.safe_load(f)
    except ImportError:
        # Fallback: simple YAML parsing for basic fields
        config = {}
        with open(APPLICANT_YAML) as f:
            content = f.read()

        # Extract resume_text (multiline)
        resume_match = re.search(r'resume_text:\s*\|\s*\n((?:[ \t]+.+\n)+)', content)
        if resume_match:
            lines = resume_match.group(1).split('\n')
            config['resume_text'] = '\n'.join(line.strip() for line in lines if line.strip())

        # Extract simple fields
        for field in ['name', 'linkedin', 'location']:
            match = re.search(rf'^{field}:\s*["\']?(.+?)["\']?\s*$', content, re.MULTILINE)
            if match:
                config[field] = match.group(1).strip()

        return config


def get_base_resume(config: dict) -> str:
    """Get base resume text from config."""
    resume_text = config.get('resume_text', '')

    # Clean up the resume text
    if resume_text:
        # Remove comment lines
        lines = [l for l in resume_text.split('\n') if not l.strip().startswith('#')]
        resume_text = '\n'.join(lines).strip()

    if not resume_text:
        print("Warning: No resume_text found in applicant.yaml")
        print("Add your resume text to applicant.yaml before running this script.")
        return ""

    return resume_text


def extract_skills_from_resume(resume_text: str) -> set:
    """Extract skills/keywords from resume text."""
    skills = set()
    resume_lower = resume_text.lower()

    # Add any PM keywords found in resume
    for keyword in PM_KEYWORDS:
        if keyword.lower() in resume_lower:
            skills.add(keyword)

    # Extract capitalized terms (tools/technologies)
    capitalized = re.findall(r'\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b', resume_text)
    for term in capitalized:
        if len(term) > 2 and term not in {"The", "This", "You", "We", "Our", "About", "What", "How", "Why"}:
            skills.add(term)

    return skills


def extract_keywords(job_description: str, applicant_skills: set) -> dict:
    """Extract relevant keywords from job description."""
    job_lower = job_description.lower()

    found_keywords = {
        "matched": [],      # Keywords applicant has
        "missing": [],      # Keywords in JD but not in applicant skills
        "all": []           # All keywords found
    }

    # Find all PM-related keywords in the job description
    for keyword in PM_KEYWORDS:
        if keyword.lower() in job_lower:
            found_keywords["all"].append(keyword)
            if keyword.lower() in {s.lower() for s in applicant_skills}:
                found_keywords["matched"].append(keyword)
            else:
                found_keywords["missing"].append(keyword)

    # Also extract capitalized terms (likely tools/technologies)
    capitalized = re.findall(r'\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b', job_description)
    tools = [t for t in capitalized if len(t) > 2 and t not in {"The", "This", "You", "We", "Our", "About", "What", "How", "Why"}]

    # Count frequency
    word_freq = Counter(tools)
    found_keywords["tools"] = [word for word, count in word_freq.most_common(10)]

    return found_keywords


def generate_optimized_resume(job_description: str, base_resume: str, config: dict, applicant_skills: set) -> str:
    """Generate an ATS-optimized resume based on job description."""
    keywords = extract_keywords(job_description, applicant_skills)

    # Start with the base resume
    optimized = base_resume

    # Get name and linkedin from config for header
    name = config.get('name', '')
    linkedin = config.get('linkedin', '')

    # Build optimized resume parts
    parts = []

    # Add matched keywords as a skills section if not already present
    matched = keywords["matched"]
    skills_to_add = []

    if any(k in matched for k in ["AI", "ML", "machine learning", "AI/ML"]):
        skills_to_add.append("AI/ML")

    if any(k in matched for k in ["platform", "infrastructure", "API"]):
        skills_to_add.append("platform products")

    if any(k in matched for k in ["enterprise", "B2B"]):
        skills_to_add.append("enterprise B2B")

    if any(k in matched for k in ["data", "analytics", "metrics"]):
        skills_to_add.append("data-driven")

    if any(k in matched for k in ["cross-functional", "stakeholder"]):
        skills_to_add.append("cross-functional leadership")

    # Prepend matched skills if resume doesn't already contain them
    if skills_to_add:
        skills_line = "Key strengths: " + ", ".join(skills_to_add) + ".\n\n"
        if skills_line.lower() not in optimized.lower():
            optimized = skills_line + optimized

    # Ensure name and linkedin are at the top if provided
    header = ""
    if name and name not in optimized:
        header += name + "\n"
    if linkedin and linkedin not in optimized:
        header += linkedin + "\n"
    if header:
        optimized = header + "\n" + optimized

    return optimized.strip()


def analyze_job(job_description: str, applicant_skills: set) -> None:
    """Print analysis of job description keywords."""
    keywords = extract_keywords(job_description, applicant_skills)

    print("\n" + "="*60)
    print("ATS KEYWORD ANALYSIS")
    print("="*60)

    print(f"\n✅ MATCHED KEYWORDS ({len(keywords['matched'])}):")
    print("   These are in both the JD and your resume:")
    for kw in sorted(set(keywords["matched"])):
        print(f"   • {kw}")

    print(f"\n⚠️  MISSING KEYWORDS ({len(keywords['missing'])}):")
    print("   These are in the JD but not in your resume:")
    for kw in sorted(set(keywords["missing"])):
        print(f"   • {kw}")

    print(f"\n🔧 TOOLS/TECHNOLOGIES MENTIONED:")
    for tool in keywords.get("tools", []):
        print(f"   • {tool}")

    print("\n" + "="*60)


def main():
    script_dir = Path(__file__).parent
    output_file = script_dir / "resume_optimized.txt"

    # Load applicant config
    config = load_applicant_config()
    base_resume = get_base_resume(config)

    if not base_resume:
        sys.exit(1)

    # Extract skills from resume
    applicant_skills = extract_skills_from_resume(base_resume)

    # Get job description
    if len(sys.argv) > 1:
        if sys.argv[1] == "--file" and len(sys.argv) > 2:
            with open(sys.argv[2]) as f:
                job_description = f.read()
        else:
            job_description = " ".join(sys.argv[1:])
    else:
        print("Paste the job description (press Ctrl+D or Ctrl+Z when done):")
        print("-" * 40)
        try:
            job_description = sys.stdin.read()
        except KeyboardInterrupt:
            print("\nCancelled.")
            sys.exit(0)

    if not job_description.strip():
        print("No job description provided.")
        sys.exit(1)

    # Analyze keywords
    analyze_job(job_description, applicant_skills)

    # Generate optimized resume
    optimized = generate_optimized_resume(job_description, base_resume, config, applicant_skills)

    print("\n📄 OPTIMIZED RESUME:")
    print("-" * 60)
    print(optimized)
    print("-" * 60)

    # Save to file
    with open(output_file, "w") as f:
        f.write(optimized)

    print(f"\n✅ Saved to: {output_file}")
    print("   Copy this text and paste into the application form.")


if __name__ == "__main__":
    main()
