"""Draw the application and tray icons with Pillow so no binary assets are needed."""

from __future__ import annotations

from PIL import Image, ImageDraw


COLORS = {
    "ok": (22, 129, 92),
    "update": (187, 120, 22),
    "error": (164, 65, 75),
    "starting": (94, 112, 133),
}
BRAND = (0, 68, 141)


def app_image(size: int = 256, status: str | None = None) -> Image.Image:
    """Rounded brand square with a desk grid; optional status dot in the corner."""
    scale = 4
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    radius = canvas * 0.22
    draw.rounded_rectangle((0, 0, canvas - 1, canvas - 1), radius=radius, fill=BRAND + (255,))
    margin = canvas * 0.2
    gap = canvas * 0.07
    cell = (canvas - 2 * margin - gap) / 2
    for row in range(2):
        for column in range(2):
            x = margin + column * (cell + gap)
            y = margin + row * (cell + gap)
            draw.rounded_rectangle((x, y, x + cell, y + cell), radius=cell * 0.22, fill=(255, 255, 255, 235))
            draw.rounded_rectangle((x + cell * 0.18, y + cell * 0.62, x + cell * 0.82, y + cell * 0.8), radius=cell * 0.08, fill=BRAND + (120,))
    if status:
        dot = canvas * 0.3
        x0, y0 = canvas - dot - canvas * 0.02, canvas - dot - canvas * 0.02
        draw.ellipse((x0 - canvas * 0.03, y0 - canvas * 0.03, x0 + dot + canvas * 0.03, y0 + dot + canvas * 0.03), fill=(255, 255, 255, 255))
        draw.ellipse((x0, y0, x0 + dot, y0 + dot), fill=COLORS.get(status, COLORS["ok"]) + (255,))
    return image.resize((size, size), Image.LANCZOS)


def tray_image(status: str = "ok") -> Image.Image:
    return app_image(64, status)


def save_ico(path, sizes=(16, 24, 32, 48, 64, 128, 256)) -> None:
    base = app_image(256)
    base.save(path, format="ICO", sizes=[(size, size) for size in sizes])
