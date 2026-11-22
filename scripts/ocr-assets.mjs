import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const tesseract = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(createRequire(join(tesseract, "package.json")).resolve("tesseract.js-core/package.json"));
const english = dirname(require.resolve("@tesseract.js-data/eng/package.json"));
const output = new URL("../public/ocr/", import.meta.url);
await mkdir(output, { recursive: true });
const sources = [
  [join(tesseract, "dist/worker.min.js"), "worker.min.js"],
  [join(tesseract, "dist/worker.min.js.LICENSE.txt"), "worker.min.js.LICENSE.txt"],
  [join(core, "LICENSE"), "core-LICENSE.txt"],
  [join(english, "4.0.0_best_int/eng.traineddata.gz"), "eng.traineddata.gz"],
  ...["lstm", "simd-lstm", "relaxedsimd-lstm"].map((variant) => {
    const name = `tesseract-core-${variant}.wasm.js`;
    return [join(core, name), name];
  }),
];
await Promise.all(sources.map(([from, to]) => copyFile(from, new URL(to, output))));
