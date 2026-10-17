// Download the current diagram as SVG or PNG (rendered in the browser, at 2x for PNG).

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvg(svg: string, name: string): void {
  download(new Blob([svg], { type: "image/svg+xml" }), `${name}.svg`);
}

export async function exportPng(svg: string, name: string, scale = 2): Promise<void> {
  const w = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 800);
  const h = Number(/height="([\d.]+)"/.exec(svg)?.[1] ?? 600);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not rasterize the SVG"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) download(blob, `${name}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
