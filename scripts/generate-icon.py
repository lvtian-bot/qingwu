import os
from PIL import Image, ImageDraw


os.makedirs('build', exist_ok=True)

RENDER_SIZE = 1024
badge_color = (20, 184, 166, 255)  # teal-500
ring_color = (94, 234, 212, 255)  # teal-300
tree_color = (255, 255, 255, 255)


def cubic(p0, p1, p2, p3, steps=16):
    points = []
    for index in range(steps):
        t = index / steps
        u = 1 - t
        points.append(
            (
                u**3 * p0[0]
                + 3 * u**2 * t * p1[0]
                + 3 * u * t**2 * p2[0]
                + t**3 * p3[0],
                u**3 * p0[1]
                + 3 * u**2 * t * p1[1]
                + 3 * u * t**2 * p2[1]
                + t**3 * p3[1],
            )
        )
    return points


def path_points(commands):
    points = []
    current = None
    for command, values in commands:
        if command == 'M':
            current = values
            points.append(current)
        else:
            p1 = values[0:2]
            p2 = values[2:4]
            p3 = values[4:6]
            points.extend(cubic(current, p1, p2, p3))
            current = p3
    return points


def sprout_shapes():
    """One straight stem with two simple cotyledon leaves."""
    stem = path_points([
        ('M', (494, 776)),
        ('C', (496, 716, 496, 648, 500, 584)),
        ('C', (500, 552, 500, 526, 500, 500)),
        ('C', (500, 492, 524, 492, 524, 500)),
        ('C', (524, 526, 524, 552, 524, 584)),
        ('C', (528, 648, 528, 716, 530, 776)),
        ('C', (530, 790, 522, 798, 512, 800)),
        ('C', (502, 798, 494, 790, 494, 776)),
    ])

    left_leaf = path_points([
        ('M', (506, 524)),
        ('C', (454, 518, 400, 490, 364, 446)),
        ('C', (330, 404, 334, 342, 340, 278)),
        ('C', (400, 298, 458, 332, 492, 390)),
        ('C', (518, 434, 520, 486, 506, 524)),
    ])

    right_leaf = path_points([
        ('M', (518, 524)),
        ('C', (570, 518, 624, 490, 660, 446)),
        ('C', (694, 404, 690, 342, 684, 278)),
        ('C', (624, 298, 566, 332, 532, 390)),
        ('C', (506, 434, 504, 486, 518, 524)),
    ])

    return [stem, left_leaf, right_leaf]


def generate_icon():
    image = Image.new('RGBA', (RENDER_SIZE, RENDER_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.ellipse([0, 0, RENDER_SIZE, RENDER_SIZE], fill=badge_color)
    draw.ellipse([28, 28, RENDER_SIZE - 28, RENDER_SIZE - 28], outline=ring_color, width=20)
    for shape in sprout_shapes():
        draw.polygon(shape, fill=tree_color)

    icon = image.resize((512, 512), Image.Resampling.LANCZOS)
    icon.save('build/icon.png', 'PNG')
    icon.save(
        'build/icon.ico',
        format='ICO',
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print('Generated the simplified two-leaf sprout icon successfully!')


if __name__ == '__main__':
    generate_icon()
