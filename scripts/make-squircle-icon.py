"""生成 macOS 标准形状图标：824px 大圆角内容居中于 1024 画布，四周透明（Apple 官方模板规格）。"""
from PIL import Image, ImageDraw

CANVAS = 1024
CONTENT = 824                       # Apple 图标内容区
RADIUS = int(CONTENT * 0.2237)      # 官方圆角比例
SS = 4                              # 超采样倍率，保证边缘平滑

img = Image.open('build/icon.png').convert('RGBA')

# 超采样画布上画圆角矩形 mask
big = CANVAS * SS
mask = Image.new('L', (big, big), 0)
offset = (CANVAS - CONTENT) // 2 * SS
ImageDraw.Draw(mask).rounded_rectangle(
    [offset, offset, offset + CONTENT * SS, offset + CONTENT * SS],
    radius=RADIUS * SS,
    fill=255,
)
mask = mask.resize((CANVAS, CANVAS), Image.LANCZOS)

out = img.copy()
out.putalpha(mask)
out.save('build/icon_squircle.png')
print('ok: build/icon_squircle.png')
