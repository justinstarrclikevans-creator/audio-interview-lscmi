import os
from pypdf import PdfReader

pdf_dir = '../'
out_dir = './manuals'
os.makedirs(out_dir, exist_ok=True)

files = [
    'Case Brief Template.pdf',
    'Interview Guide.pdf',
    'Scoring Form.pdf',
    'Scoring Manual.pdf'
]

for file in files:
    path = os.path.join(pdf_dir, file)
    if os.path.exists(path):
        reader = PdfReader(path)
        text = ''
        for page in reader.pages:
            text += page.extract_text() + '\n'
        with open(os.path.join(out_dir, file.replace('.pdf', '.txt')), 'w', encoding='utf-8') as f:
            f.write(text)
        print(f"Parsed {file}")
    else:
        print(f"Missing {file}")
