
import os
import math
from PIL import Image, ImageDraw

os.makedirs('build', exist_ok=True)
render_size = 1024
badge_color = (20, 184, 166, 255)  # teal-500 #14B8A6
ring_color = (94, 234, 212, 255)   # teal-300 #5EEAD4
ring_inset = 28.0

# -------------------------------------------------------------
# Young Tree 1: 雏桐初成 · 舒展幼树 (Fresh, Lively Young Sapling)
# A slender, energetic young trunk branching into 5 clean, distinct young leaves
# -------------------------------------------------------------
img1 = Image.new('RGBA', (render_size, render_size), (0, 0, 0, 0))
draw1 = ImageDraw.Draw(img1)
draw1.ellipse([0, 0, render_size, render_size], fill=badge_color)
draw1.ellipse([ring_inset, ring_inset, render_size - ring_inset, render_size - ring_inset], outline=ring_color, width=20)

# Ground base
draw1.rounded_rectangle([410, 770, 614, 794], radius=12, fill=(255, 255, 255, 255))

# Young slender trunk (挺拔轻盈的小树干)
draw1.polygon([(504, 460), (496, 780), (528, 780), (520, 460)], fill=(255, 255, 255, 255))

# Graceful upward-curving young branches (小树的嫩枝)
draw1.line([(512, 600), (400, 470)], fill=(255, 255, 255, 255), width=16)
draw1.line([(512, 600), (624, 470)], fill=(255, 255, 255, 255), width=16)
draw1.line([(512, 480), (350, 360)], fill=(255, 255, 255, 255), width=16)
draw1.line([(512, 480), (674, 360)], fill=(255, 255, 255, 255), width=16)
draw1.line([(512, 460), (512, 280)], fill=(255, 255, 255, 255), width=16)

# 5 distinct, elegant, clean young leaves (5片初长成的舒展嫩叶)
# Top central leaf
draw1.pieslice([462, 190, 562, 330], 180, 360, fill=(255, 255, 255, 255))
draw1.polygon([(462, 260), (512, 170), (562, 260)], fill=(255, 255, 255, 255))

# Upper Left leaf
draw1.ellipse([270, 300, 390, 400], fill=(255, 255, 255, 255))
# Upper Right leaf
draw1.ellipse([634, 300, 754, 400], fill=(255, 255, 255, 255))

# Lower Left leaf
draw1.ellipse([330, 420, 440, 510], fill=(255, 255, 255, 255))
# Lower Right leaf
draw1.ellipse([584, 420, 694, 510], fill=(255, 255, 255, 255))

img1_512 = img1.resize((512, 512), Image.Resampling.LANCZOS)
img1_512.save('build/icon-young-tree-1.png', 'PNG')

# -------------------------------------------------------------
# Young Tree 2: 亭亭幼木 · 极简三叶 (Minimalist 3-Branch Sapling)
# Super clean, pure, elegant sapling with three upward-reaching leaf branches
# -------------------------------------------------------------
img2 = Image.new('RGBA', (render_size, render_size), (0, 0, 0, 0))
draw2 = ImageDraw.Draw(img2)
draw2.ellipse([0, 0, render_size, render_size], fill=badge_color)
draw2.ellipse([ring_inset, ring_inset, render_size - ring_inset, render_size - ring_inset], outline=ring_color, width=20)

# Ground
draw2.line([(420, 780), (604, 780)], fill=(255, 255, 255, 255), width=16)

# Slender young trunk
draw2.line([(512, 780), (512, 440)], fill=(255, 255, 255, 255), width=20)

# Left & Right young branch arcs
draw2.arc([360, 320, 664, 620], 90, 180, fill=(255, 255, 255, 255), width=16)
draw2.arc([360, 320, 664, 620], 0, 90, fill=(255, 255, 255, 255), width=16)

# Branch tips: 3 clean pointed parasol sapling leaves
# Center Top Leaf
draw2.polygon([(512, 200), (470, 320), (554, 320)], fill=(255, 255, 255, 255))
draw2.ellipse([470, 270, 554, 350], fill=(255, 255, 255, 255))

# Left Leaf (curving upward-outward)
draw2.polygon([(320, 280), (410, 370), (340, 420)], fill=(255, 255, 255, 255))
draw2.ellipse([320, 330, 420, 420], fill=(255, 255, 255, 255))

# Right Leaf
draw2.polygon([(704, 280), (684, 420), (614, 370)], fill=(255, 255, 255, 255))
draw2.ellipse([604, 330, 704, 420], fill=(255, 255, 255, 255))

img2_512 = img2.resize((512, 512), Image.Resampling.LANCZOS)
img2_512.save('build/icon-young-tree-2.png', 'PNG')

# -------------------------------------------------------------
# Young Tree 3: 生机新桐 · 自然舒展 (Natural Sprouting Young Parasol Tree)
# A young tree just coming into full life, light, graceful, breathing
# -------------------------------------------------------------
img3 = Image.new('RGBA', (render_size, render_size), (0, 0, 0, 0))
draw3 = ImageDraw.Draw(img3)
draw3.ellipse([0, 0, render_size, render_size], fill=badge_color)
draw3.ellipse([ring_inset, ring_inset, render_size - ring_inset, render_size - ring_inset], outline=ring_color, width=20)

# Base mound
draw3.ellipse([400, 760, 624, 794], fill=(255, 255, 255, 255))

# Trunk
draw3.polygon([(504, 460), (496, 770), (528, 770), (520, 460)], fill=(255, 255, 255, 255))

# Spreading young boughs
draw3.line([(512, 580), (370, 460)], fill=(255, 255, 255, 255), width=16)
draw3.line([(512, 580), (654, 460)], fill=(255, 255, 255, 255), width=16)
draw3.line([(512, 460), (512, 320)], fill=(255, 255, 255, 255), width=16)

# Three light, modest, scalloped leaf clusters at branch terminals
# Top crown
draw3.ellipse([432, 220, 592, 350], fill=(255, 255, 255, 255))
# Left
draw3.ellipse([280, 390, 420, 500], fill=(255, 255, 255, 255))
# Right
draw3.ellipse([604, 390, 744, 500], fill=(255, 255, 255, 255))

img3_512 = img3.resize((512, 512), Image.Resampling.LANCZOS)
img3_512.save('build/icon-young-tree-3.png', 'PNG')

print('Generated young tree icons successfully!')

