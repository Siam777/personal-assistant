# Phase 4 Context: OCR Lens Module

**Phase:** 04 — OCR Lens Module
**Goal:** Enable users to extract text from images, clipboard screenshots, or live camera feeds and copy/edit the extracted text in an intuitive Google Lens-style UI.
**Requirements:** `OCR-01`, `OCR-02`, `OCR-03`, `OCR-04`

---

## 1. Domain Boundary & Scope

1. **Client-Side Processing Only:**
   - Text recognition must run entirely in the browser using `tesseract.js` (WebAssembly & Web Worker).
   - Zero image data or extracted text is transmitted over the network to any server or cloud API.
   - Preserves privacy: confidential screenshots, receipts, codes, or credentials scanned via Lens never leave the local browser environment.

2. **Decoupled Architecture:**
   - The OCR Lens module operates independently of vault encryption/session state.
   - Users can use Lens even if the vault is locked or uninitialized.
   - When the vault is unlocked, extracted text can optionally be saved as a secure note or copied.

3. **Ingestion Modalities:**
   - File upload (dialog).
   - Drag and drop (image files).
   - Clipboard paste (`Ctrl+V` / `Cmd+V` image paste).
   - Live camera stream via `navigator.mediaDevices.getUserMedia` with video frame snapshot capture.

4. **Review & Output:**
   - Optical character recognition is inherently probabilistic. Misread characters must be easily spotted and corrected.
   - Interactive preview displaying:
     - The source image with zoom/pan or fitted view.
     - Recognition progress bar (% completed) during extraction.
     - Confidence metric indicator (0-100%).
     - Editable multiline text editor containing the OCR result.
     - 1-Action Copy button with visual confirmation.

---

## 2. Key Decisions

- **D-01 (Engine):** Use `tesseract.js` in a reusable Web Worker with standard English language trained data, loaded on demand to prevent blocking initial app startup.
- **D-02 (Downscaling & Canvas Limits):** High-resolution smartphone camera captures (12MP-48MP) are downscaled using offscreen HTMLCanvas to a max dimension of 2048px before OCR recognition to prevent WebAssembly heap exhaustion and ensure fast recognition (< 3s).
- **D-03 (Hardware Teardown):** Camera video stream tracks (`stream.getTracks()`) must be immediately stopped whenever the camera is closed, paused, or unmounted.
- **D-04 (Clipboard Integration):** Text copy from OCR preview uses the standard 1-action copy workflow.
