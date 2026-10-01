#!/usr/bin/env python3
"""
Builds the submission PDFs from the Markdown docs (docs/submission/*.pdf).

Markdown -> styled HTML (python-markdown) -> PDF via headless Chromium's --print-to-pdf
(page numbers via CSS page-margin boxes). Relative repo links are rewritten to GitHub URLs.

Usage: python3 scripts/build-submission-pdfs.py <chrome-headless-binary>
"""
import html, os, re, subprocess, sys, tempfile
from datetime import date

import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'submission')
REPO = 'https://github.com/sunkaramahesh09/warehouse-agent'
LIVE = 'https://app-production-fd3e.up.railway.app'
TITLE = 'Warehouse Ops — Order Exception Resolver + Shift Planner'

PDFS = [
    ('01_Phase0_Design.pdf', 'Phase 0 Design Document', ['docs/PHASE_0_DESIGN.md']),
    ('02_Project_Deliverable.pdf', 'Project Deliverable', [
        ('Overview, setup and how to run (README)', 'README.md', False),
        ('PRD requirements traceability', 'docs/PRD_ANALYSIS.md', False),
        ('Architecture', 'docs/ARCHITECTURE.md', False),
        ('Mock environment: data model and seeded dataset', 'docs/DATA_MODEL.md', False),
        ('Scenarios', 'docs/SCENARIOS.md', False),
        ('Failure modes', 'docs/FAILURE_MODES.md', False),
        ('Optional features', 'docs/OPTIONAL_FEATURES.md', False),
        ('Demo script', 'docs/DEMO_SCRIPT.md', False),
        ('Appendix A — Evaluation report (deterministic)', 'docs/results/eval-report.md'),
        ('Appendix B — Evaluation report (Gemini)', 'docs/results/eval-report-llm.md'),
        ('Appendix C — Audit log example', 'docs/results/audit-log-example.md'),
        ('Appendix D — Scenario results (Gemini)', 'docs/results/scenario-results-llm.md'),
        ('Appendix E — Scenario results (deterministic)', 'docs/results/scenario-results.md'),
    ]),
    ('03_Policy_SOP_Set.pdf', 'Policy / SOP Set', ['docs/POLICIES.md']),
    ('04_Reflection.pdf', 'Reflection', ['docs/REFLECTION.md']),
    ('05_AI_Tools.pdf', 'AI Tools Used', ['docs/AI_TOOLS.md']),
]

CSS = """
@page { size: A4; margin: 16mm 14mm 18mm 14mm;
  @bottom-left { content: "__FOOTER__"; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 7.5pt; color: #64748b; }
  @bottom-right { content: counter(page) " / " counter(pages); font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 7.5pt; color: #64748b; } }
@page :first { @bottom-left { content: none; } @bottom-right { content: none; } }
* { box-sizing: border-box; }
body { font-family: -apple-system, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif; color: #1f2937; font-size: 10.5pt; line-height: 1.5; }
h1, h2, h3, h4 { color: #0f1b35; line-height: 1.25; page-break-after: avoid; }
h1 { font-size: 20pt; border-bottom: 2px solid #115e59; padding-bottom: 6px; margin-top: 0; }
h2 { font-size: 14pt; margin-top: 20px; border-bottom: 1px solid #e3e8ef; padding-bottom: 3px; }
h3 { font-size: 12pt; margin-top: 16px; }
a { color: #0f766e; text-decoration: none; word-break: break-word; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.8pt; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
pre { background: #f8fafc; border: 1px solid #e3e8ef; border-radius: 8px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.3pt; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 8.6pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #dbe3ee; padding: 4px 6px; text-align: left; vertical-align: top; word-break: normal; overflow-wrap: break-word; }
td code, th code { overflow-wrap: anywhere; word-break: normal; }
th { background: #eef6f5; color: #0f1b35; }
blockquote { margin: 10px 0; padding: 8px 12px; background: #fffbeb; border-left: 4px solid #f59e0b; color: #78350f; }
.section { page-break-before: always; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover .kicker { color: #0f766e; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; font-size: 10pt; }
.cover h1 { font-size: 30pt; border: none; margin: 8px 0 6px; }
.cover .sub { font-size: 13pt; color: #475569; margin-bottom: 26px; }
.cover table { width: auto; font-size: 10pt; }
.cover td { border: none; padding: 3px 14px 3px 0; }
.cover .note { margin-top: 28px; font-size: 9pt; color: #64748b; }
.toc li { margin: 2px 0; }
"""

def rewrite_links(md_text, src_rel):
    base = os.path.dirname(src_rel)
    def fix(m):
        label, target = m.group(1), m.group(2)
        if re.match(r'^(https?:|mailto:|#)', target):
            return m.group(0)
        path, _, anchor = target.partition('#')
        full = os.path.normpath(os.path.join(base, path)) if path else src_rel
        kind = 'tree' if os.path.isdir(os.path.join(ROOT, full)) else 'blob'
        return f'[{label}]({REPO}/{kind}/main/{full}' + (f'#{anchor}' if anchor else '') + ')'
    return re.sub(r'\[([^\]]*)\]\(([^)\s]+)\)', fix, md_text)

def md_to_html(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        text = rewrite_links(f.read(), rel)
    return markdown.markdown(text, extensions=['tables', 'fenced_code', 'sane_lists'])

def build_html(doc_title, parts):
    norm = [(None, p, False) if isinstance(p, str) else (p[0], p[1], p[2] if len(p) > 2 else True) for p in parts]
    sources = [p[1] for p in norm]
    cover = f"""<div class="cover">
  <div class="kicker">Agentic AI Solutions Engineer — Warehouse Automation</div>
  <h1>{html.escape(doc_title)}</h1>
  <div class="sub">{html.escape(TITLE)}</div>
  <table>
    <tr><td><b>Repository</b></td><td><a href="{REPO}">{REPO}</a></td></tr>
    <tr><td><b>Live app</b></td><td><a href="{LIVE}">{LIVE}</a></td></tr>
    <tr><td><b>Source</b></td><td>{'<code>' + html.escape(sources[0]) + '</code>' if len(sources) == 1 else f'{len(sources)} documents from the repository (see Contents)'}</td></tr>
    <tr><td><b>Generated</b></td><td>{date.today().isoformat()}</td></tr>
  </table>
  <div class="note">Simulated prototype: all data is fictional; nothing connects to a real warehouse, carrier or customer system.</div>
</div>"""
    body = [cover]
    if len(parts) > 1:
        items = ''.join(f'<li>{html.escape(label or path)}</li>' for label, path, _ in norm)
        body.append(f'<div class="section"><h1>Contents</h1><ol class="toc">{items}</ol></div>')
    for label, rel, add_heading in norm:
        inner = md_to_html(rel)
        if add_heading:
            inner = f'<h1>{html.escape(label)}</h1>' + re.sub(r'<h1>', '<h2>', re.sub(r'</h1>', '</h2>', inner))
        body.append(f'<div class="section">{inner}</div>')
    css = CSS.replace('__FOOTER__', f'{doc_title} · {TITLE}'.replace('"', ''))
    return f'<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(doc_title)}</title><style>{css}</style></head><body>{"".join(body)}</body></html>'

def main():
    chrome = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp()
    for fname, title, parts in PDFS:
        page = os.path.join(tmp, fname.replace('.pdf', '.html'))
        with open(page, 'w', encoding='utf-8') as f: f.write(build_html(title, parts))
        out = os.path.join(OUT, fname)
        subprocess.run([chrome, '--headless', '--disable-gpu', '--no-pdf-header-footer', f'--user-data-dir={tmp}/prof',
                        f'--print-to-pdf={out}', 'file://' + page], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        print(f'{fname:32} {os.path.getsize(out)/1024:7.1f} KB')

if __name__ == '__main__':
    main()
