#!/usr/bin/env python3
"""Gera dist/asafe.html: o Asafe inteiro (CSS, JS e logos) em um arquivo só."""
import base64, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/style.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="css/style.css" />', '<style>\n' + css + '\n</style>')

def inline_js(m):
    code = (root / m.group(1)).read_text(encoding='utf-8').replace('</script>', '<\\/script>')
    return '<script>\n' + code + '\n</script>'

html = re.sub(r'<script src="((?:js|sdk)/[^"]+)"></script>', inline_js, html)
for img in (root / 'assets').glob('*.png'):
    uri = 'data:image/png;base64,' + base64.b64encode(img.read_bytes()).decode()
    html = html.replace('assets/' + img.name, uri)
assert 'src="js/' not in html and 'src="sdk/' not in html and 'assets/' not in html
out = root / 'dist/asafe.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'{out.relative_to(root)}: {len(html) // 1024} KB')
