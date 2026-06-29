import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import {
  type PatientProfile,
  type PrescriptionRecord,
  createPdfFileName,
  formatDate,
  getPrescriptionText,
} from "./prescription";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_X = 72;
const CONTENT_WIDTH = PAGE_WIDTH - CONTENT_X * 2;
const HEADER_IMAGE_PATH = path.join(
  process.cwd(),
  "public",
  "duran-caballero-header.png",
);

const TEXT: [number, number, number] = [0.12, 0.11, 0.11];
const MUTED: [number, number, number] = [0.36, 0.33, 0.34];
const BRAND: [number, number, number] = [0.62, 0.18, 0.39];
const ACCENT: [number, number, number] = [0.85, 0.54, 0.58];

type FontName = "F1" | "F2" | "F3";

type PdfTextOptions = {
  font?: FontName;
  size?: number;
  maxWidth?: number;
  lineHeight?: number;
  color?: [number, number, number];
};

type PdfImageResource = {
  name: string;
  width: number;
  height: number;
  bitsPerComponent: 8;
  colorSpace: "/DeviceRGB";
  data: Buffer;
};

type PdfPage = {
  content: string;
  images: PdfImageResource[];
};

let cachedHeaderImage: PdfImageResource | null | undefined;

const signatureLines = [
  "EN CORIA A 20/06/2026",
  "Fdo : Dra Durán Caballero, María del Sol",
  "Especialista en Ginecología y Obstetricia",
  "Col: 06/4993",
  "76012671V",
];

export function createPrescriptionPdf(
  record: PrescriptionRecord,
  verificationUrl: string,
) {
  void verificationUrl;

  const page = new PdfCanvas();

  drawPrescriptionPage(page, record);

  return {
    fileName: createPdfFileName(record.payload),
    buffer: buildPdf([{ content: page.content, images: page.images }]),
  };
}

function drawPrescriptionPage(page: PdfCanvas, record: PrescriptionRecord) {
  page.fillColor(1, 1, 1);
  page.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "f");

  drawLetterhead(page);
  drawPatientBlock(page, record.payload.patient);
  drawPrescriptionText(page, getPrescriptionText(record.payload.prescription));
  drawSignature(page);
  drawFooter(page);
}

function drawLetterhead(page: PdfCanvas) {
  const headerImage = getHeaderImage();

  if (headerImage) {
    page.addImage(headerImage);

    const width = 170;
    const height = width * (headerImage.height / headerImage.width);
    page.drawImage(headerImage.name, (PAGE_WIDTH - width) / 2, 675, width, height);
    page.textCentered(PAGE_WIDTH / 2, 646, "Número de Colegiada  06/4993", {
      size: 7.5,
      color: TEXT,
    });
    return;
  }

  drawLogoMark(page, PAGE_WIDTH / 2, 742);
  page.textCentered(PAGE_WIDTH / 2, 688, "Dra. Durán Caballero", {
    size: 27,
    color: BRAND,
  });
  page.textCentered(PAGE_WIDTH / 2, 658, "Ginecología y Obstetricia", {
    size: 17,
    color: ACCENT,
  });
  page.textCentered(PAGE_WIDTH / 2, 632, "Número de Colegiada  06/4993", {
    size: 7.5,
    color: TEXT,
  });
}

function drawPatientBlock(page: PdfCanvas, patient: PatientProfile) {
  const x = CONTENT_X + 24;
  let y = 560;
  const lines: Array<[string, string]> = [
    ["Paciente:", patient.name || "No informado"],
    ["DNI/NIE:", patient.documentId || "No informado"],
    [
      "Fecha de nacimiento:",
      patient.birthDate ? formatDate(patient.birthDate) : "No informado",
    ],
    ["Email:", patient.email || "No informado"],
  ];

  lines.forEach(([label, value]) => {
    page.text(x, y, label, {
      size: 9.5,
      color: MUTED,
      maxWidth: 130,
    });
    page.text(x + 140, y, value, {
      size: 9.5,
      color: TEXT,
      maxWidth: CONTENT_WIDTH - 190,
      lineHeight: 12,
    });
    y -= 18;
  });
}

function drawPrescriptionText(page: PdfCanvas, prescriptionText: string) {
  page.text(CONTENT_X, 455, "RECETA MÉDICA PARA ASISTENCIA SANITARIA PRIVADA", {
    font: "F2",
    size: 11,
    color: TEXT,
    maxWidth: CONTENT_WIDTH,
  });
  page.textBlock(CONTENT_X + 16, 418, prescriptionText, {
    size: 12.5,
    color: TEXT,
    maxWidth: CONTENT_WIDTH - 32,
    lineHeight: 18,
  });
}

function drawSignature(page: PdfCanvas) {
  let y = 178;
  signatureLines.forEach((line) => {
    page.textCentered(PAGE_WIDTH / 2, y, line, {
      size: 10.5,
      color: TEXT,
    });
    y -= 15;
  });
}

function drawFooter(page: PdfCanvas) {
  page.textCentered(
    PAGE_WIDTH / 2,
    57,
    "C: / Cáceres, 2 | Cita Previa: 623 190 797 | 10800 Coria",
    {
      size: 10,
      color: BRAND,
    },
  );
  page.textCentered(
    PAGE_WIDTH / 2,
    39,
    "info@duranginecologia.com | www.duranginecologia.com",
    {
      size: 10,
      color: BRAND,
    },
  );
}

function drawLogoMark(page: PdfCanvas, centerX: number, baselineY: number) {
  page.lineCap(1);

  page.strokeColor(...BRAND);
  page.strokeWidth(7);
  page.moveTo(centerX - 6, baselineY + 48);
  page.curveTo(
    centerX - 22,
    baselineY + 18,
    centerX - 12,
    baselineY - 8,
    centerX - 32,
    baselineY - 12,
  );
  page.curveTo(
    centerX - 48,
    baselineY - 16,
    centerX - 52,
    baselineY + 6,
    centerX - 42,
    baselineY + 15,
  );
  page.stroke();

  page.strokeColor(...ACCENT);
  page.strokeWidth(9);
  page.moveTo(centerX + 8, baselineY + 42);
  page.curveTo(
    centerX + 39,
    baselineY + 32,
    centerX + 38,
    baselineY - 2,
    centerX + 9,
    baselineY - 15,
  );
  page.stroke();

  page.strokeColor(...BRAND);
  page.strokeWidth(5);
  page.moveTo(centerX - 42, baselineY + 10);
  page.curveTo(
    centerX - 34,
    baselineY - 10,
    centerX - 12,
    baselineY - 12,
    centerX - 3,
    baselineY + 2,
  );
  page.stroke();

  page.fillColor(...BRAND);
  page.ellipse(centerX - 11, baselineY + 57, 12, 12, "f");
}

function buildPdf(pages: PdfPage[]) {
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontRegular = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fontBold = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const fontItalic = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>",
  );

  const pageImageRefs = pages.map((page) => {
    const refs = new Map<string, number>();

    page.images.forEach((image) => {
      refs.set(image.name, addObject(buildImageObject(image)));
    });

    return refs;
  });
  const contentIds = pages.map((page) =>
    addObject(
      `<< /Length ${Buffer.byteLength(page.content, "latin1")} >>\nstream\n${page.content}\nendstream`,
    ),
  );
  const pageIds = pages.map((_, index) => objects.length + index + 1);
  const pagesObjectId = objects.length + pages.length + 1;

  pages.forEach((_, index) => {
    const imageResources = Array.from(pageImageRefs[index])
      .map(([name, objectId]) => `/${name} ${objectId} 0 R`)
      .join(" ");
    const xObjects = imageResources ? `/XObject << ${imageResources} >>` : "";

    addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${fontItalic} 0 R >> ${xObjects} >> /Contents ${contentIds[index]} 0 R >>`,
    );
  });

  const pagesObject = addObject(
    `<< /Type /Pages /Kids [${pageIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] /Count ${pages.length} >>`,
  );
  const catalogObject = addObject(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);

  const parts = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(parts.join(""), "latin1"));
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });

  const xrefOffset = Buffer.byteLength(parts.join(""), "latin1");
  parts.push(`xref\n0 ${objects.length + 1}\n`);
  parts.push("0000000000 65535 f \n");

  for (let index = 1; index < offsets.length; index += 1) {
    parts.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }

  parts.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return Buffer.from(parts.join(""), "latin1");
}

function buildImageObject(image: PdfImageResource) {
  const stream = image.data.toString("latin1");

  return `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.colorSpace} /BitsPerComponent ${image.bitsPerComponent} /Filter /FlateDecode /Length ${image.data.length} >>\nstream\n${stream}\nendstream`;
}

function getHeaderImage() {
  if (cachedHeaderImage !== undefined) {
    return cachedHeaderImage;
  }

  if (!existsSync(HEADER_IMAGE_PATH)) {
    cachedHeaderImage = null;
    return cachedHeaderImage;
  }

  try {
    cachedHeaderImage = decodePngForPdf(
      readFileSync(HEADER_IMAGE_PATH),
      "ImHeader",
    );
  } catch {
    cachedHeaderImage = null;
  }

  return cachedHeaderImage;
}

function decodePngForPdf(buffer: Buffer, name: string): PdfImageResource {
  const pngSignature = "89504e470d0a1a0a";

  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("Unsupported image format");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    }

    if (type === "IDAT") {
      idatChunks.push(chunk);
    }

    offset += length + 12;

    if (type === "IEND") {
      break;
    }
  }

  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error("Unsupported PNG encoding");
  }

  const channels = colorType === 6 ? 4 : 3;
  const scanlineLength = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rgb = Buffer.alloc(width * height * 3);
  let sourceOffset = 0;
  let targetOffset = 0;
  let previous = Buffer.alloc(scanlineLength);

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.alloc(scanlineLength);

    for (let index = 0; index < scanlineLength; index += 1) {
      const raw = inflated[sourceOffset];
      const left = index >= channels ? row[index - channels] : 0;
      const up = previous[index] || 0;
      const upLeft = index >= channels ? previous[index - channels] || 0 : 0;

      sourceOffset += 1;
      row[index] = applyPngFilter(filter, raw, left, up, upLeft);
    }

    for (let index = 0; index < scanlineLength; index += channels) {
      const red = row[index];
      const green = row[index + 1];
      const blue = row[index + 2];
      const alpha = colorType === 6 ? row[index + 3] : 255;

      rgb[targetOffset] = flattenOnWhite(red, alpha);
      rgb[targetOffset + 1] = flattenOnWhite(green, alpha);
      rgb[targetOffset + 2] = flattenOnWhite(blue, alpha);
      targetOffset += 3;
    }

    previous = row;
  }

  return {
    name,
    width,
    height,
    bitsPerComponent: 8,
    colorSpace: "/DeviceRGB",
    data: deflateSync(rgb),
  };
}

function applyPngFilter(
  filter: number,
  raw: number,
  left: number,
  up: number,
  upLeft: number,
) {
  if (filter === 0) {
    return raw;
  }

  if (filter === 1) {
    return (raw + left) & 255;
  }

  if (filter === 2) {
    return (raw + up) & 255;
  }

  if (filter === 3) {
    return (raw + Math.floor((left + up) / 2)) & 255;
  }

  if (filter === 4) {
    return (raw + paethPredictor(left, up, upLeft)) & 255;
  }

  throw new Error("Unsupported PNG filter");
}

function paethPredictor(left: number, up: number, upLeft: number) {
  const initial = left + up - upLeft;
  const leftDistance = Math.abs(initial - left);
  const upDistance = Math.abs(initial - up);
  const upLeftDistance = Math.abs(initial - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }

  if (upDistance <= upLeftDistance) {
    return up;
  }

  return upLeft;
}

function flattenOnWhite(value: number, alpha: number) {
  if (alpha === 255) {
    return value;
  }

  return Math.round(value * (alpha / 255) + 255 * (1 - alpha / 255));
}

class PdfCanvas {
  content = "";
  images: PdfImageResource[] = [];

  addImage(image: PdfImageResource) {
    if (!this.images.some((current) => current.name === image.name)) {
      this.images.push(image);
    }
  }

  drawImage(
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    this.content += `q\n${fixed(width)} 0 0 ${fixed(height)} ${fixed(x)} ${fixed(
      y,
    )} cm\n/${name} Do\nQ\n`;
  }

  text(x: number, y: number, value: string, options: PdfTextOptions = {}) {
    const font = options.font || "F1";
    const size = options.size || 10;
    const color = options.color || TEXT;
    const lines = wrapText(value || "", options.maxWidth, size);
    const lineHeight = options.lineHeight || size + 3;

    lines.forEach((line, index) => {
      this.content += `${fixed(color[0])} ${fixed(color[1])} ${fixed(
        color[2],
      )} rg\nBT /${font} ${size} Tf ${fixed(x)} ${fixed(
        y - index * lineHeight,
      )} Td ${pdfString(line)} Tj ET\n`;
    });

    return y - (lines.length - 1) * lineHeight;
  }

  textCentered(
    x: number,
    y: number,
    value: string,
    options: PdfTextOptions = {},
  ) {
    const size = options.size || 10;
    const textX = x - measureText(value, size) / 2;

    return this.text(textX, y, value, options);
  }

  textBlock(x: number, y: number, value: string, options: PdfTextOptions = {}) {
    const font = options.font || "F1";
    const size = options.size || 10;
    const color = options.color || TEXT;
    const lines = wrapText(value || "", options.maxWidth, size);
    const lineHeight = options.lineHeight || size + 3;

    lines.forEach((line, index) => {
      this.content += `${fixed(color[0])} ${fixed(color[1])} ${fixed(
        color[2],
      )} rg\nBT /${font} ${size} Tf ${fixed(x)} ${fixed(
        y - index * lineHeight,
      )} Td ${pdfString(line)} Tj ET\n`;
    });

    return y - lines.length * lineHeight;
  }

  rect(x: number, y: number, width: number, height: number, mode: "S" | "f") {
    this.content += `${fixed(x)} ${fixed(y)} ${fixed(width)} ${fixed(
      height,
    )} re ${mode}\n`;
  }

  ellipse(x: number, y: number, width: number, height: number, mode: "S" | "f") {
    const k = 0.5522847498;
    const ox = (width / 2) * k;
    const oy = (height / 2) * k;
    const xe = x + width;
    const ye = y + height;
    const xm = x + width / 2;
    const ym = y + height / 2;

    this.content += `${fixed(xm)} ${fixed(y)} m\n`;
    this.content += `${fixed(xm + ox)} ${fixed(y)} ${fixed(xe)} ${fixed(
      ym - oy,
    )} ${fixed(xe)} ${fixed(ym)} c\n`;
    this.content += `${fixed(xe)} ${fixed(ym + oy)} ${fixed(xm + ox)} ${fixed(
      ye,
    )} ${fixed(xm)} ${fixed(ye)} c\n`;
    this.content += `${fixed(xm - ox)} ${fixed(ye)} ${fixed(x)} ${fixed(
      ym + oy,
    )} ${fixed(x)} ${fixed(ym)} c\n`;
    this.content += `${fixed(x)} ${fixed(ym - oy)} ${fixed(xm - ox)} ${fixed(
      y,
    )} ${fixed(xm)} ${fixed(y)} c\n${mode}\n`;
  }

  fillColor(r: number, g: number, b: number) {
    this.content += `${fixed(r)} ${fixed(g)} ${fixed(b)} rg\n`;
  }

  strokeColor(r: number, g: number, b: number) {
    this.content += `${fixed(r)} ${fixed(g)} ${fixed(b)} RG\n`;
  }

  strokeWidth(value: number) {
    this.content += `${fixed(value)} w\n`;
  }

  lineCap(value: 0 | 1 | 2) {
    this.content += `${value} J\n`;
  }

  moveTo(x: number, y: number) {
    this.content += `${fixed(x)} ${fixed(y)} m\n`;
  }

  curveTo(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ) {
    this.content += `${fixed(x1)} ${fixed(y1)} ${fixed(x2)} ${fixed(
      y2,
    )} ${fixed(x3)} ${fixed(y3)} c\n`;
  }

  stroke() {
    this.content += "S\n";
  }
}

function wrapText(text: string, maxWidth = 999, size = 10) {
  const maxChars = Math.max(12, Math.floor(maxWidth / (size * 0.48)));

  return text
    .split(/\r?\n/)
    .flatMap((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);

      if (words.length === 0) {
        return [""];
      }

      const lines: string[] = [];
      let line = "";

      words.forEach((word) => {
        if (`${line} ${word}`.trim().length <= maxChars) {
          line = `${line} ${word}`.trim();
          return;
        }

        if (line) {
          lines.push(line);
        }

        line = word;
      });

      if (line) {
        lines.push(line);
      }

      return lines;
    });
}

function pdfString(value: string) {
  return `(${toWinAnsi(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")})`;
}

function toWinAnsi(value: string) {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\x00-\xFF]/g, (char) =>
      char.normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "?",
    );
}

function measureText(value: string, size: number) {
  return toWinAnsi(value).length * size * 0.5;
}

function fixed(value: number) {
  return Number(value.toFixed(2)).toString();
}
