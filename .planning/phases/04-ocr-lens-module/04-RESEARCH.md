# Phase 4 Research: Tesseract.js & Camera Stream Architecture

## 1. Tesseract.js in Vite / React 19

### Worker Lifecycle
`tesseract.js` v5+ provides a high-level `createWorker('eng', 1, { logger: ... })` API.
- The worker executes inside a browser Web Worker thread.
- Memory and network usage:
  - Worker code (~150KB) + Core WASM binary (~2.5MB) + Traineddata (`eng.traineddata.gz` ~4MB).
  - Tesseract.js caches the traineddata in IndexedDB automatically after first load.
- Reusing a single worker instance across recognitions prevents repetitive WASM initialization overhead (~800ms saved per scan).
- A helper wrapper `recognizeImage(imageSource, onProgress)` manages worker creation, execution, and error handling.

### Image Downscaling & Pre-processing
Camera photos or 4K screenshots can easily reach 4000x3000 (12MP) or higher. Processing an unscaled 12MP image in Tesseract WASM takes 8-15 seconds and can exhaust browser memory limits.
- Optimal OCR resolution is typically 150-300 DPI, corresponding to ~1200px - 2048px maximum dimension.
- Pre-processing function `downscaleImage(source: HTMLImageElement | HTMLCanvasElement | Blob, maxDimension = 2048)`:
  - Draws image onto an offscreen canvas with bilinear smoothing.
  - Returns a blob or canvas element ready for Tesseract.
  - Typical recognition time reduces from ~12s to ~1.2s - 2.5s.

---

## 2. Camera Capture via `getUserMedia`

### MediaDevices API
- Video constraint:
  ```ts
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment", // Back camera on mobile/tablet, default on desktop
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  ```
- Video playback:
  - Set `videoElement.srcObject = stream; videoElement.play();`.
  - Add `playsInline` attribute for iOS/Safari compatibility.
- Snapshot capture:
  - Create canvas with `video.videoWidth` and `video.videoHeight`.
  - `ctx.drawImage(video, 0, 0, width, height)`.
  - Extract blob via `canvas.toBlob(...)`.
- Stream Cleanup:
  - Must call `track.stop()` on each track in `stream.getTracks()` when user closes the camera or navigates away.

---

## 3. UI/UX Contract & Interaction Flow

1. **Lens Landing State:**
   - Drag-and-drop dropzone with prominent icons.
   - Buttons: "Upload Image", "Open Camera", "Paste Screenshot".
2. **Recognition Progress State:**
   - Smooth progress bar (0% -> 100%) with status labels ("Initializing OCR engine...", "Analyzing text lines...", "Recognizing characters...").
3. **Lens Result State (Split View):**
   - Left panel: Scanned image with zoom / reset controls.
   - Right panel:
     - OCR Header: Confidence badge (e.g. `95% Confidence`), Word count, Character count.
     - Text Area: Full height, editable, monospace/sans toggle.
     - Actions: "Copy All" (1-action copy), "Scan Another Image", "Save to Vault Note" (if vault unlocked).
