"""Check every rendered PDF page and create visual QA contact sheets."""
from pathlib import Path
import json
import zipfile
import xml.etree.ElementTree as ET
import subprocess
import pdfplumber
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'tmp' / 'template-qa'
thumbs = []
results = []
assert len(list(root.glob('*.pdf'))) == 28, 'Expected all 14 templates in both test variants'
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
for file in sorted(root.glob('*.pdf')):
    with pdfplumber.open(file) as pdf:
        for index, page in enumerate(pdf.pages):
            words = page.extract_words()
            assert words, f'{file.name}: blank page {index + 1}'
            # 28 CSS pixels are the minimum margins; tolerate glyph descenders.
            bad = [w['text'] for w in words if w['x0'] < 18 or w['x1'] > page.width - 18 or w['top'] < 18 or w['bottom'] > page.height - 18]
            assert not bad, f'{file.name} page {index + 1}: clipped text {bad}'
            assert any(r['width'] > page.width * .7 and r['height'] > page.height * .7 for r in page.rects), f'{file.name}: missing frame on page {index + 1}'
            if file.stem.startswith(('creative-clean-', 'consulting-')):
                assert any(4 <= r['width'] <= 8 and r['height'] > page.height * .7 for r in page.rects), f'{file.name}: missing side accent on page {index + 1}'
        results.append({'file': file.name, 'pages': len(pdf.pages), 'text_bounds': 'pass', 'page_frames': 'pass'})
    poppler = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe'
    subprocess.run([str(poppler), '-scale-to', '600', '-png', str(file), str(root / f'{file.stem}-page')], check=True, capture_output=True)
    for index, rendered in enumerate(sorted(root.glob(f'{file.stem}-page-*.png'))):
        image = Image.open(rendered).convert('RGB')
        image.thumbnail((300, 420))
        tile = Image.new('RGB', (320, 455), '#eef1f5')
        tile.paste(image, ((320-image.width)//2, 25))
        ImageDraw.Draw(tile).text((8, 5), f'{file.stem} / {index+1}', fill='black')
        thumbs.append(tile)
    with zipfile.ZipFile(file.with_suffix('.docx')) as archive:
        xml = ET.fromstring(archive.read('word/document.xml'))
        assert xml.find('.//w:pgBorders', ns) is not None, f'{file.name}: DOCX border missing'
        size = xml.find('.//w:pgSz', ns)
        expected = '11906' if file.stem.endswith('-long') else '12240'
        assert size.get(f"{{{ns['w']}}}w") == expected, f'{file.name}: wrong DOCX paper size'
for start in range(0, len(thumbs), 12):
    batch = thumbs[start:start+12]
    sheet = Image.new('RGB', (1280, 455*((len(batch)+3)//4)), 'white')
    for index, tile in enumerate(batch):
        sheet.paste(tile, ((index%4)*320, (index//4)*455))
    sheet.save(root / f'contact-sheet-{start//12+1}.png')
(root / 'pdf-results.json').write_text(json.dumps(results, indent=2))
print(f'PASS: {len(results)} PDFs, {len(thumbs)} pages, and matching DOCX structures')
