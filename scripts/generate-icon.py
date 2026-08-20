import os
from PIL import Image, ImageDraw

os.makedirs('build', exist_ok=True)
size = 512
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# No dark background plate: the blue badge is the icon itself.

# Inner circle badge
badge_color = (20, 184, 166, 255)  # teal-500 #14B8A6
draw.ellipse([80, 80, size - 80, size - 80], fill=badge_color)

# Secondary ring
ring_color = (94, 234, 212, 255)  # teal-300 #5EEAD4
draw.ellipse([96, 96, size - 96, size - 96], outline=ring_color, width=8)

# Stylized tree / wing motif
draw.pieslice([130, 130, 370, 370], 180, 270, fill=(255, 255, 255, 255))
draw.pieslice([142, 130, 382, 370], 270, 360, fill=(153, 246, 228, 255))  # teal-200 #99F6E4
draw.polygon([(256, 150), (276, 360), (236, 360)], fill=(255, 255, 255, 255))
draw.rounded_rectangle([170, 350, 342, 372], radius=10, fill=(255, 255, 255, 255))

img.save('build/icon.png', 'PNG')
img.save('build/icon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])
print('Icons generated successfully!')
