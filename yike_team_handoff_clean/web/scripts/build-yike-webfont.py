"""Build the OFL-licensed Yike web subset from the official LXGW source font."""

from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILES = [ROOT / "app/page.tsx", ROOT / "app/layout.tsx"]


def supported_text() -> str:
    chars = {chr(codepoint) for codepoint in range(0x20, 0x250)}
    chars.update("　，。！？：；、“”‘’（）【】《》〈〉…—·￥～✓◇✦⌂●＋×")

    # GB2312 covers the common simplified-Chinese characters expected in user input.
    for lead in range(0xA1, 0xF8):
        for trail in range(0xA1, 0xFF):
            try:
                chars.update(bytes((lead, trail)).decode("gb2312"))
            except UnicodeDecodeError:
                pass

    for path in SOURCE_FILES:
        chars.update(path.read_text(encoding="utf-8"))
    return "".join(sorted(chars))


def rename_font(font: TTFont) -> None:
    replacements = {
        1: "Yike Handwriting Web",
        2: "Regular",
        3: "Yike Handwriting Web 1.522",
        4: "Yike Handwriting Web Regular",
        6: "YikeHandwritingWeb-Regular",
    }
    for record in font["name"].names:
        if record.nameID in replacements:
            record.string = replacements[record.nameID].encode(
                "utf-16-be" if record.isUnicode() else "latin-1"
            )


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: build-yike-webfont.py SOURCE_TTF OUTPUT_WOFF2")

    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)

    font = TTFont(source)
    rename_font(font)

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=supported_text())
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(output)


if __name__ == "__main__":
    main()
