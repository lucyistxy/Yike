#!/usr/bin/env python3
"""Prepare transparent, tightly cropped Yike illustration assets for the web app."""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


WEB_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = WEB_ROOT.parent
SOURCE_ROOT = PROJECT_ROOT / "design-assets" / "yike-handdrawn-v1"
OUT_ROOT = WEB_ROOT / "public" / "art" / "yike"


def remove_connected_white(image: Image.Image, threshold: int = 38) -> Image.Image:
    """Remove only white pixels connected to the canvas edge, preserving interior highlights."""
    rgba = image.convert("RGBA")
    rgb = rgba.convert("RGB")
    marker = (1, 254, 1)
    flood = rgb.copy()
    width, height = flood.size
    for seed in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        ImageDraw.floodfill(flood, seed, marker, thresh=threshold)

    background = Image.new("L", flood.size, 0)
    background.putdata([255 if pixel == marker else 0 for pixel in flood.getdata()])
    subject = ImageChops.invert(background)

    # Give antialiased edge pixels a soft alpha based on their distance from white.
    edge_zone = ImageChops.subtract(background.filter(ImageFilter.MaxFilter(9)), background)
    edge_alpha = Image.new("L", rgb.size, 255)
    edge_values: list[int] = []
    for pixel, edge in zip(rgb.getdata(), edge_zone.getdata()):
        if edge:
            distance = max(255 - pixel[0], 255 - pixel[1], 255 - pixel[2])
            edge_values.append(max(0, min(255, distance * 10)))
        else:
            edge_values.append(255)
    edge_alpha.putdata(edge_values)
    alpha = ImageChops.multiply(subject, edge_alpha).filter(ImageFilter.GaussianBlur(0.45))

    result = rgba.copy()
    result.putalpha(alpha)
    return result


def erase_calendar_labels(image: Image.Image) -> Image.Image:
    """Erase source weekday glyphs; the app renders accessible HTML labels instead."""
    cleaned = image.convert("RGBA")
    draw = ImageDraw.Draw(cleaned)
    draw.rectangle((350, 475, 1750, 625), fill=(255, 255, 255, 255))
    return cleaned


def tight_crop(image: Image.Image, padding: int = 24) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if not bbox:
        return image
    left, top, right, bottom = bbox
    return image.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(image.width, right + padding),
            min(image.height, bottom + padding),
        )
    )


def contain(image: Image.Image, max_size: int) -> Image.Image:
    if max(image.size) <= max_size:
        return image
    resized = image.copy()
    resized.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    return resized


def keep_largest_alpha_component(image: Image.Image) -> Image.Image:
    """Drop disconnected neighboring artwork left inside a sheet crop."""
    result = image.convert("RGBA")
    alpha = result.getchannel("A")
    width, height = alpha.size
    alpha_values = list(alpha.getdata())
    foreground = bytearray(value > 8 for value in alpha_values)
    visited = bytearray(width * height)
    largest: list[int] = []

    for start in range(width * height):
        if not foreground[start] or visited[start]:
            continue
        component: list[int] = []
        queue = deque([start])
        visited[start] = 1
        while queue:
            index = queue.popleft()
            component.append(index)
            x, y = index % width, index // width
            for neighbor_y in range(max(0, y - 1), min(height, y + 2)):
                row = neighbor_y * width
                for neighbor_x in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row + neighbor_x
                    if foreground[neighbor] and not visited[neighbor]:
                        visited[neighbor] = 1
                        queue.append(neighbor)
        if len(component) > len(largest):
            largest = component

    keep = bytearray(width * height)
    for index in largest:
        keep[index] = 1
    cleaned_alpha = Image.new("L", (width, height))
    cleaned_alpha.putdata([value if keep[index] else 0 for index, value in enumerate(alpha_values)])
    result.putalpha(cleaned_alpha)
    return result


def save_webp(image: Image.Image, filename: str, max_size: int, padding: int = 24) -> None:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    prepared = contain(tight_crop(image, padding), max_size)
    prepared.save(OUT_ROOT / filename, "WEBP", quality=92, method=6)


def prepare_white_source(
    source_name: str,
    output_name: str,
    max_size: int,
    crop: tuple[int, int, int, int] | None = None,
    calendar: bool = False,
    largest_component: bool = False,
) -> None:
    image = Image.open(SOURCE_ROOT / "source" / source_name).convert("RGBA")
    if calendar:
        image = erase_calendar_labels(image)
    if crop:
        image = image.crop(crop)
    prepared = remove_connected_white(image)
    if largest_component:
        prepared = keep_largest_alpha_component(prepared)
    save_webp(prepared, output_name, max_size)


def prepare_transparent_source(source_name: str, output_name: str, max_size: int) -> None:
    image = Image.open(SOURCE_ROOT / "generated-transparent" / source_name).convert("RGBA")
    save_webp(image, output_name, max_size)


def crop_to_ink_bounds(image: Image.Image, padding: int = 4) -> Image.Image:
    """Crop pale generated canvas margins to the outer pencil outline."""
    grayscale = image.convert("L")
    ink = grayscale.point(lambda value: 255 if value < 205 else 0)
    bbox = ink.getbbox()
    if not bbox:
        return image
    left, top, right, bottom = bbox
    return image.crop((
        max(0, left - padding),
        max(0, top - padding),
        min(image.width, right + padding),
        min(image.height, bottom + padding),
    ))


def prepare_scene_source(
    source_name: str,
    output_name: str,
    max_size: int,
    crop_ink: bool = False,
) -> None:
    image = Image.open(SOURCE_ROOT / "generated-scenes" / source_name).convert("RGB")
    if crop_ink:
        image = crop_to_ink_bounds(image)
    if max(image.size) > max_size:
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    image.save(OUT_ROOT / output_name, "WEBP", quality=88, method=6)


def prepare_journal_reference(source_name: str, output_name: str, max_size: int) -> None:
    image = Image.open(SOURCE_ROOT / "source" / source_name).convert("RGB")
    # Remove the clipped heading above the book while preserving the complete page edges.
    image = image.crop((0, 38, image.width, image.height))
    if max(image.size) > max_size:
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    image.save(OUT_ROOT / output_name, "WEBP", quality=90, method=6)


def main() -> None:
    prepare_white_source("logo-source.png", "logo-yike.webp", 420)
    prepare_white_source("otter-hold-source.png", "otter-hold-shell.webp", 920)
    prepare_white_source("otter-lift-source.png", "otter-lift-shell.webp", 920)
    prepare_white_source("otter-companion-source.png", "otter-companion.webp", 760)
    prepare_white_source("pearl-card-source.png", "pearl-card.webp", 640)
    prepare_white_source("calendar-shell-source.png", "calendar-shell-frame.webp", 1500, calendar=True)
    prepare_scene_source("home-evening-valley.png", "home-evening-valley.webp", 1400)
    prepare_scene_source("home-journal-approved-v2.png", "home-journal-reference.webp", 1600, crop_ink=True)
    prepare_transparent_source("home-journal-dynamic-v3.png", "home-journal-dynamic.webp", 1800)

    # Sheet A: pink scallop, spiral conch, open pearl shell.
    prepare_white_source("shell-sheet-a-source.png", "shell-scallop.webp", 520, (20, 215, 505, 845), largest_component=True)
    prepare_white_source("shell-sheet-a-source.png", "shell-spiral-conch.webp", 520, (450, 150, 970, 900), largest_component=True)
    prepare_white_source("shell-sheet-a-source.png", "shell-pearl.webp", 520, (880, 180, 1448, 900), largest_component=True)

    # Sheet B: cream conch, cowrie, blue nautilus.
    prepare_white_source("shell-sheet-b-source.png", "shell-cream-conch.webp", 520, (55, 210, 505, 860), largest_component=True)
    prepare_white_source("shell-sheet-b-source.png", "shell-cowrie.webp", 520, (475, 235, 960, 820), largest_component=True)
    prepare_white_source("shell-sheet-b-source.png", "shell-nautilus.webp", 520, (920, 210, 1448, 850), largest_component=True)

    prepare_transparent_source("shell-sand-dollar.png", "shell-sand-dollar.webp", 520)
    prepare_transparent_source("shell-limpet.png", "shell-limpet.webp", 520)
    prepare_transparent_source("shell-murex.png", "shell-murex.webp", 520)

    print(f"Prepared Yike assets in {OUT_ROOT}")


if __name__ == "__main__":
    main()
