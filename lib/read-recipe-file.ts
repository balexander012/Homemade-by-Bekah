import type { Worker } from "tesseract.js";

export const sourceFileTypes = ".txt,.md,.csv,.json,.html,.htm,.pdf,.docx,.png,.jpg,.jpeg,.webp";

async function recognizeImage(file: File, onProgress: (text: string) => void) {
  const { createWorker } = await import("tesseract.js");
  let worker: Worker | undefined;
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Text recognition timed out. Try a smaller, clearer image.")), 90000);
  });
  const ocr = async () => {
    worker = await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js", corePath: "/ocr", langPath: "/ocr",
      workerBlobURL: false, cacheMethod: "none",
      logger: ({ status, progress }) => {
        if (!stopped && status === "recognizing text") onProgress(`Reading image · ${Math.round(progress * 100)}%`);
      },
      errorHandler: () => {},
    });
    if (stopped) { await worker.terminate(); throw new Error("Text recognition stopped."); }
    const response = await worker.recognize(file);
    return response.data.text;
  };
  try { return await Promise.race([ocr(), deadline]); }
  finally {
    stopped = true;
    clearTimeout(timeout);
    await worker?.terminate();
  }
}

export async function readRecipeFile(file: File, onProgress: (text: string) => void): Promise<string> {
  const ext = file.name.toLowerCase().split(".").at(-1);
  if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error("Choose a source file up to 10 MB.");
  let text: string;
  if (ext === "pdf") {
    const { getDocument } = await import("unpdf/pdfjs");
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), stopAtErrors: true, disableFontFace: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 25) throw new Error("Choose a PDF with 25 pages or fewer.");
      const pages: string[] = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
      }
      text = pages.join("\n\n");
    } finally { await task.destroy(); }
  } else if (ext === "docx") {
    const { extractRawText } = await import("mammoth");
    text = (await extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else if (ext && ["png", "jpg", "jpeg", "webp"].includes(ext)) {
    text = await recognizeImage(file, onProgress);
  } else if (ext && ["txt", "md", "csv", "json", "html", "htm"].includes(ext)) {
    text = await file.text();
  } else throw new Error("Choose a PDF, Word document, text file, HTML, JSON, or screenshot.");
  if (!text.trim()) throw new Error("No text was found. A scanned PDF can be imported as a screenshot.");
  return text.trim().slice(0, 1024 * 1024);
}
