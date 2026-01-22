"""
Resume file handling - use existing PDF or convert text to PDF.
"""

import shutil
from pathlib import Path
from typing import Optional

from fpdf import FPDF


class ResumePDF(FPDF):
    """Custom PDF class for resume generation."""

    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=15)

    def header(self):
        pass  # No header needed

    def footer(self):
        pass  # No footer needed


def text_to_pdf(text_content: str, output_path: str) -> str:
    """
    Convert text content to PDF format.

    Args:
        text_content: Resume text content
        output_path: Path where the PDF should be saved

    Returns:
        Path to the generated PDF
    """
    output_path = Path(output_path)

    pdf = ResumePDF()
    pdf.add_page()

    # Use a clean font
    pdf.set_font("Helvetica", size=10)

    # Process content line by line
    for line in text_content.split('\n'):
        # Handle headers (lines that look like section titles)
        if line.strip() and line.strip().isupper():
            pdf.set_font("Helvetica", style="B", size=11)
            pdf.cell(0, 8, line.strip(), ln=True)
            pdf.set_font("Helvetica", size=10)
        elif line.startswith('# '):
            # Markdown-style headers
            pdf.set_font("Helvetica", style="B", size=14)
            pdf.cell(0, 10, line[2:].strip(), ln=True)
            pdf.set_font("Helvetica", size=10)
        elif line.startswith('## '):
            pdf.set_font("Helvetica", style="B", size=12)
            pdf.cell(0, 8, line[3:].strip(), ln=True)
            pdf.set_font("Helvetica", size=10)
        elif line.startswith('- ') or line.startswith('* '):
            # Bullet points
            pdf.cell(5)  # Indent
            pdf.multi_cell(0, 5, f"  {line.strip()}")
        else:
            pdf.multi_cell(0, 5, line)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))

    return str(output_path)


def prepare_resume(
    resume_path: str,
    config: Optional[dict] = None,
    output_dir: Optional[str] = None
) -> str:
    """
    Prepare resume for upload - either use existing PDF or convert text to PDF.

    Args:
        resume_path: Path to resume file (PDF or text)
        config: Optional config dict with resume_text for inline resume
        output_dir: Directory for generated files (default: ./output)

    Returns:
        Path to the PDF file ready for upload
    """
    if output_dir is None:
        output_dir = Path(__file__).parent / "output"
    else:
        output_dir = Path(output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "resume.pdf"

    # If resume_path is provided and exists, use it
    if resume_path:
        resume_path = Path(resume_path)
        if resume_path.exists():
            # If already a PDF, copy to output directory
            if resume_path.suffix.lower() == '.pdf':
                shutil.copy(resume_path, output_path)
                return str(output_path)

            # Otherwise it's a text file - convert to PDF
            content = resume_path.read_text(encoding='utf-8')
            return text_to_pdf(content, str(output_path))

    # If no file path or file doesn't exist, try resume_text from config
    if config and config.get('resume_text'):
        resume_text = config['resume_text'].strip()
        if resume_text:
            return text_to_pdf(resume_text, str(output_path))

    raise FileNotFoundError(
        f"Resume not found at '{resume_path}' and no resume_text in config.\n"
        "Provide a resume_path in applicant.yaml or paste your resume in resume_text."
    )


def get_default_resume_path() -> str:
    """
    Get the default resume path - check common locations.
    Returns empty string if no default found (caller should use resume_text).
    """
    # Check common PDF locations
    common_paths = [
        Path.home() / "Documents" / "resume.pdf",
        Path.home() / "Desktop" / "resume.pdf",
        Path.home() / "resume.pdf",
    ]

    for path in common_paths:
        if path.exists():
            return str(path)

    # No default found - caller should use resume_text from config
    return ""


if __name__ == "__main__":
    # Test PDF generation
    default_resume = get_default_resume_path()
    if default_resume:
        print(f"Default resume: {default_resume}")
        output = prepare_resume(default_resume)
        print(f"Prepared resume at: {output}")
    else:
        print("No default resume found. Set resume_path in applicant.yaml or use resume_text.")
