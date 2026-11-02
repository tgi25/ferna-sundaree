# Builds build/icon.ico (16–256 px) from the PNGs made by make-icons.js, and the in-app logo.
from PIL import Image
import os, shutil
d = os.path.join(os.path.dirname(__file__), '..', 'build')
img = Image.open(os.path.join(d, 'icon-256.png')).convert('RGBA')
img.save(os.path.join(d, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
shutil.copy(os.path.join(d, 'icon-128.png'), os.path.join(d, '..', 'src', 'pages', '_shared', 'logo.png'))
print('icon.ico written')
