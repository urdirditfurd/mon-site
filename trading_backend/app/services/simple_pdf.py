"""Générateur PDF minimaliste sans dépendance externe."""

from __future__ import annotations


def _escape_pdf_text(value: str) -> str:
    """Échappe les caractères réservés du format PDF."""

    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_text_pdf(lines: list[str]) -> bytes:
    """Construit un PDF simple (1 page) à partir d'une liste de lignes."""

    # Limite simple pour rester sur une seule page A4.
    visible_lines = lines[:48]

    content_ops: list[str] = [
        "BT",
        "/F1 11 Tf",
        "40 800 Td",
    ]
    for index, line in enumerate(visible_lines):
        if index > 0:
            content_ops.append("0 -15 Td")
        content_ops.append(f"({_escape_pdf_text(line[:180])}) Tj")
    content_ops.append("ET")
    stream_data = "\n".join(content_ops).encode("latin-1", errors="replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R "
            b"/MediaBox [0 0 595 842] "
            b"/Resources << /Font << /F1 4 0 R >> >> "
            b"/Contents 5 0 R >>"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream_data)).encode("ascii") + b" >>\nstream\n" + stream_data + b"\nendstream",
    ]

    pdf = bytearray()
    pdf.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")

    offsets: list[int] = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        if not obj.endswith(b"\n"):
            pdf.extend(b"\n")
        pdf.extend(b"endobj\n")

    xref_position = len(pdf)
    total_objects = len(objects) + 1
    pdf.extend(f"xref\n0 {total_objects}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(f"trailer\n<< /Size {total_objects} /Root 1 0 R >>\n".encode("ascii"))
    pdf.extend(f"startxref\n{xref_position}\n%%EOF\n".encode("ascii"))
    return bytes(pdf)
