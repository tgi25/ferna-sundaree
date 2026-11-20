# Builds build/icon.ico from the PNGs made by make-icons.js — each size from its own PNG, so
# 16–32 px use the small-size drawing — and copies the in-app logo.
from PIL import Image
import os, shutil
d = os.path.join(os.path.dirname(__file__), '..', 'build')
sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [Image.open(os.path.join(d, f'icon-{s}.png')).convert('RGBA') for s in sizes]
imgs[-1].save(os.path.join(d, 'icon.ico'), format='ICO', sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
shutil.copy(os.path.join(d, 'icon-128.png'), os.path.join(d, '..', 'src', 'pages', '_shared', 'logo.png'))
# The small mark shown as the tab icon of Sundaree's own pages
shutil.copy(os.path.join(d, 'icon-32.png'), os.path.join(d, '..', 'src', 'pages', '_shared', 'mark.png'))
print('icon.ico written')
