"""Read exported PDF structure and glyph/font evidence independently of Chromium.

Used by the floor driver; requires pypdf in PDF_TEST_PYTHON (default python3).
This is automated file inspection, not a visual PDF viewer check.
"""
import json
import sys

from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
outline = []


def walk(items, depth=0):
    for item in items:
        if isinstance(item, list):
            walk(item, depth + 1)
        else:
            outline.append({"depth": depth, "title": item.title,
                            "page": reader.get_destination_page_number(item)})


walk(reader.outline)
embedded = []
for page in reader.pages:
    for ref in page["/Resources"]["/Font"].get_object().values():
        font = ref.get_object()
        descendant = font.get("/DescendantFonts", [font])[0].get_object()
        descriptor = descendant.get("/FontDescriptor")
        if descriptor is None:
            continue
        descriptor = descriptor.get_object()
        # Check real font program bytes, not just a font-family declaration.
        if any(key in descriptor and len(descriptor[key].get_object().get_data()) > 0
               for key in ["/FontFile", "/FontFile2", "/FontFile3"]):
            embedded.append(str(font.get("/BaseFont", "")))

print(json.dumps({"outline": outline, "embedded": sorted(set(embedded)),
                  "text": "\n".join(page.extract_text() for page in reader.pages)}))
