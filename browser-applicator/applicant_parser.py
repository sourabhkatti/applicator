"""
Parse applicant information from applicant.yaml configuration file.
"""

from pathlib import Path
from typing import Optional


def get_applicant_info(config: dict) -> dict:
    """
    Extract applicant information from configuration.

    Returns dict with:
        - name: str
        - email: str
        - phone: str
        - location: str
        - linkedin: str
    """
    applicant_info = {
        'name': config.get('name'),
        'email': config.get('email'),
        'phone': config.get('phone'),
        'location': config.get('location'),
        'linkedin': config.get('linkedin'),
    }

    # Validate required fields
    required = ['name', 'email', 'phone', 'location', 'linkedin']
    missing = [f for f in required if not applicant_info.get(f)]
    if missing:
        raise ValueError(f"Missing required fields in applicant.yaml: {missing}")

    return applicant_info


def get_applicant_context(config: dict) -> str:
    """
    Return detailed context about the applicant for LLM to use when answering custom questions.
    Built from applicant.yaml configuration.
    """
    name = config.get('name', 'Applicant')
    background_summary = config.get('background_summary', '').strip()
    key_achievements = config.get('key_achievements', [])
    target_roles = config.get('target_roles', [])
    industries = config.get('industries', [])
    location_preference = config.get('location_preference', 'hybrid')
    authorized_us = config.get('authorized_to_work_us', True)
    requires_sponsorship = config.get('requires_sponsorship', False)

    # Build context string
    context_parts = []

    context_parts.append("## Professional Background\n")

    if background_summary:
        context_parts.append(background_summary)
        context_parts.append("")

    if key_achievements and any(key_achievements):
        context_parts.append("### Key Achievements:")
        for achievement in key_achievements:
            if achievement:
                context_parts.append(f"- {achievement}")
        context_parts.append("")

    context_parts.append("### Job Preferences:")
    if target_roles:
        context_parts.append(f"- Seeking: {', '.join(target_roles)}")
    context_parts.append(f"- Location preference: {location_preference}")
    if industries:
        context_parts.append(f"- Industries of interest: {', '.join(industries)}")
    context_parts.append("")

    context_parts.append("### Answering Guidelines:")
    context_parts.append("- For \"Why interested in this company?\": Connect the company's mission to relevant experience")
    context_parts.append("- For \"Describe a product you built\": Use a key achievement from above")
    context_parts.append(f"- For work authorization: {'Legally authorized to work in US' if authorized_us else 'Not authorized to work in US'}, {'requires sponsorship' if requires_sponsorship else 'no sponsorship needed'}")
    context_parts.append("- For demographic questions: Decline to self-identify")

    return "\n".join(context_parts)


# Keep backward compatibility with old function names
def parse_claude_md(claude_md_path: Optional[str] = None) -> dict:
    """
    Deprecated: Use get_applicant_info(config) instead.
    This function is kept for backward compatibility.
    """
    import yaml

    # Try to load from applicant.yaml
    config_path = Path(__file__).parent.parent / "applicant.yaml"
    if config_path.exists():
        with open(config_path) as f:
            config = yaml.safe_load(f)
        return get_applicant_info(config)

    raise FileNotFoundError(
        "applicant.yaml not found. Run setup first or copy applicant.yaml.example to applicant.yaml"
    )


if __name__ == "__main__":
    import yaml

    # Test parsing
    config_path = Path(__file__).parent.parent / "applicant.yaml"
    if config_path.exists():
        with open(config_path) as f:
            config = yaml.safe_load(f)
        info = get_applicant_info(config)
        print("Parsed applicant info:")
        for key, value in info.items():
            print(f"  {key}: {value}")
        print("\nApplicant context:")
        print(get_applicant_context(config))
    else:
        print(f"Config file not found: {config_path}")
        print("Copy applicant.yaml.example to applicant.yaml and fill in your details.")
