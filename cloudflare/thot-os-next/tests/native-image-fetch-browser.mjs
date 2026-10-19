import { fileURLToPath } from "node:url";
import { runNativeImageFetchBrowserRegression } from "./helpers/native-image-fetch-browser.mjs";

const sourcePath = fileURLToPath(new URL("../src/components/native-media-uploader.tsx", import.meta.url));

try {
  const result = await runNativeImageFetchBrowserRegression({ sourcePath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Native image browser regression failed: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
